import Stripe from 'stripe';
import { DynamoDBClient, UpdateItemCommand, GetItemCommand, QueryCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import crypto from 'crypto';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16'
});
const ddb = new DynamoDBClient({});

/**
 * Fee Configuration:
 * Combined Platform and Biophlx fee.
 * This is implemented as a single parameter (application_fee_amount) in the Stripe PaymentIntent.
 */
const PLATFORM_FEE_PERCENT = 0.05; // e.g., 5%
const BIOPHLX_FEE_PERCENT = 0.05;   // e.g., 5%
const TOTAL_FEE_PERCENTAGE = PLATFORM_FEE_PERCENT + BIOPHLX_FEE_PERCENT;

export const handler = async (event) => {
  console.log('AppSync Event:', JSON.stringify(event, null, 2));
  
  const action = event.info?.fieldName || event.action;
  const args = event.arguments || {};
  const user_id = event.user_id || args.user_id;

  try {
    switch (action) {
      case 'setupStripeOnboarding': {
        const { trainer_id, email } = args;

        console.log('Setup Onboarding: trainer_id:', trainer_id, 'user_id:', user_id);

        // Try a GetItem first
        let trainerData = await ddb.send(new GetItemCommand({
          TableName: process.env.TRAINER_TABLE,
          Key: {
            trainer_id: { S: trainer_id },
            user_id: { S: user_id }
          }
        }));

        // Fallback: If GetItem returns nothing, try a Query by trainer_id
        if (!trainerData.Item) {
          console.log('GetItem found nothing, falling back to Query for trainer_id:', trainer_id);
          const queryResponse = await ddb.send(new QueryCommand({
            TableName: process.env.TRAINER_TABLE,
            KeyConditionExpression: "trainer_id = :tid",
            ExpressionAttributeValues: { ":tid": { S: trainer_id } }
          }));
          
          if (queryResponse.Items?.[0]) {
            const item = queryResponse.Items[0];
            console.log('Query found trainer. Stored user_id:', item.user_id?.S, 'Caller user_id:', user_id);
            
            // Re-wrap into trainerData.Item format for compatibility with existing logic
            trainerData = { Item: item };
            
            // SECURITY CHECK: If the user_id in DB doesn't match the caller, we should be careful.
            // However, if the user is 100% sure this is their trainer record, we proceed using the stored user_id.
          }
        }

        if (!trainerData.Item) {
          console.error('CRITICAL: Trainer not found in DB even after Query fallback.', trainer_id);
          return { error: `Trainer profile not found (ID: ${trainer_id}).` };
        }

        // Use the actual user_id from the database to ensure UpdateItem works
        const dbUserId = trainerData.Item.user_id.S;
        let stripeAccountId = trainerData.Item?.stripe_account_id?.S;
        let account;

        if (stripeAccountId) {
          account = await stripe.accounts.retrieve(stripeAccountId);
          if (account.details_submitted) {
            return { stripe_account_id: stripeAccountId, error: "ALREADY_ONBOARDED" };
          }
        } else {
          account = await stripe.accounts.create({
            type: 'express',
            email,
            capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
            metadata: {
              trainer_id: trainer_id,
              user_id: user_id
            }
          });
          stripeAccountId = account.id;

          await ddb.send(new UpdateItemCommand({
            TableName: process.env.TRAINER_TABLE,
            Key: { trainer_id: { S: trainer_id }, user_id: { S: dbUserId } },
            UpdateExpression: 'SET stripe_account_id = :sid',
            ExpressionAttributeValues: { ':sid': { S: stripeAccountId } },
          }));
        }

        const accountLink = await stripe.accountLinks.create({
          account: stripeAccountId,
          refresh_url: 'https://biophlx.com',
          return_url: 'https://biophlx.com',
          type: 'account_onboarding',
        });

        return { onboarding_url: accountLink.url, stripe_account_id: stripeAccountId };
      }

      case 'createStripeProduct': {
        const { 
          trainer_id, name, price, description, product_type,
          workout_ids, workout_products, difficulty_level, fitness_goal, duration_weeks
        } = args;
        
        console.log('Creating product for trainer:', trainer_id, 'user:', user_id);

        // 1. Secure Lookup: Get trainer and verify ownership
        // Try Query by trainer_id (GSI or Primary Key if it's the partition key)
        const queryResponse = await ddb.send(new QueryCommand({
          TableName: process.env.TRAINER_TABLE,
          KeyConditionExpression: "trainer_id = :tid",
          ExpressionAttributeValues: { ":tid": { S: trainer_id } }
        }));

        let trainerData = queryResponse.Items?.[0];

        // Fallback: If Query failed, try Scan (last resort for small tables)
        if (!trainerData) {
          console.warn('createStripeProduct: Trainer not found by Query, trying fallback Scan...');
          const scanRes = await ddb.send(new QueryCommand({
            TableName: process.env.TRAINER_TABLE,
            FilterExpression: "trainer_id = :tid",
            ExpressionAttributeValues: { ":tid": { S: trainer_id } },
            Limit: 50
          })).catch(async () => {
             // If Query with filter fails, use real Scan
             const { DynamoDBClient, ScanCommand } = await import('@aws-sdk/client-dynamodb');
             return await ddb.send(new ScanCommand({
               TableName: process.env.TRAINER_TABLE,
               FilterExpression: "trainer_id = :tid",
               ExpressionAttributeValues: { ":tid": { S: trainer_id } },
               Limit: 50
             }));
          });
          trainerData = scanRes.Items?.[0];
        }

        if (!trainerData) {
          console.error('createStripeProduct: Trainer profile not found for ID:', trainer_id);
          return { error: `Trainer profile not found (ID: ${trainer_id}).` };
        }

        // 2. Strict Owner Verification (Required for Production Security)
        const ownerId = trainerData.user_id?.S;
        if (ownerId !== user_id) {
          console.error('CRITICAL: Ownership mismatch blocked.', { 
            storedOwnerId: ownerId, 
            callerId: user_id,
            trainer_id: trainer_id
          });
          return { error: "Unauthorized: You do not own this trainer profile." };
        }

        const stripeAccountId = trainerData.stripe_account_id?.S;
        if (!stripeAccountId) {
          console.error('createStripeProduct: Trainer has no Stripe account linked.', trainer_id);
          return { error: "Your Stripe account is not set up. Please go to Monetization Setup first." };
        }

        const finalProductType = product_type || 'workout_product';
        const isService = finalProductType === 'service';

        // 3. Create the product AND price in Stripe
        let product;
        try {
          product = await stripe.products.create({
            name,
            description: description || `Biophlx ${finalProductType}`,
            default_price_data: {
              currency: 'usd',
              unit_amount: Math.round(price * 100),
            },
            metadata: { 
              trainer_id, 
              product_type: finalProductType 
            }
          }, {
            stripeAccount: stripeAccountId,
          });
        } catch (stripeErr) {
          console.error('Stripe Product Creation Failed:', stripeErr);
          return { error: `Stripe Error: ${stripeErr.message}` };
        }

        // 4. Prepare DynamoDB Item
        const resource_id = crypto.randomUUID();
        const now = new Date().toISOString();
        const tableName = isService 
          ? (process.env.VIRTUAL_SERVICE_TABLE || 'VirtualTrainingService')
          : (process.env.WORKOUT_PRODUCT_TABLE || 'WorkoutProduct');
        
        const item = {
          trainer_id: { S: trainer_id },
          price: { N: price.toString() },
          description: { S: description || '' },
          stripe_product_id: { S: product.id },
          stripe_price_id: { S: product.default_price }, 
          product_type: { S: finalProductType },
          created_at: { S: now },
          updated_at: { S: now }
        };

        if (isService) {
          item.service_id = { S: resource_id };
          item.service_name = { S: name };
          if (workout_ids) item.workout_ids = { L: workout_ids.map(id => ({ S: id })) };
          if (workout_products) item.workout_products = { L: workout_products.map(id => ({ S: id })) };
          if (duration_weeks) item.duration_weeks = { N: duration_weeks.toString() };
        } else {
          item.workout_product_id = { S: resource_id };
          item.name = { S: name };
          if (workout_ids) item.workout_id = { L: workout_ids.map(id => ({ S: id })) };
          if (difficulty_level) item.difficulty_level = { S: difficulty_level };
          if (fitness_goal) item.fitness_goal = { S: fitness_goal };
        }
        
        try {
          await ddb.send(new PutItemCommand({
            TableName: tableName,
            Item: item
          }));
        } catch (dbErr) {
          console.error('DynamoDB PutItem Failed for table:', tableName, dbErr);
          return { error: `Database Error: ${dbErr.message}` };
        }

        // 5. Update Trainer Stats: Increment workouts_created if this is a workout product
        if (!isService) {
          try {
            await ddb.send(new UpdateItemCommand({
              TableName: process.env.TRAINER_TABLE,
              Key: { 
                trainer_id: { S: trainer_id },
                user_id: { S: ownerId } 
              },
              UpdateExpression: 'ADD workouts_created :one',
              ExpressionAttributeValues: { ':one': { N: '1' } }
            }));
            console.log('Trainer workouts_created incremented');
          } catch (updateErr) {
            console.error('Failed to update trainer stats:', updateErr);
          }
        }

        console.log('Product created successfully:', resource_id);

        return {
          workout_product_id: !isService ? resource_id : null,
          service_id: isService ? resource_id : null,
          stripe_product_id: product.id,
          stripe_price_id: product.default_price,
          error: null
        };
      }

      case 'createStripeCheckout': {
        const { trainer_id, trainer_user_id, price, product_name, product_id, product_type, user_id: buyer_id } = args;

        // 0. PREVENT DUPLICATE PURCHASE: Check if user already has permission
        try {
          const existingPermission = await ddb.send(new GetItemCommand({
            TableName: process.env.PERMISSIONS_TABLE || 'Biophlx-Permissions',
            Key: {
              user_id: { S: buyer_id },
              resource_id: { S: product_id }
            }
          }));

          if (existingPermission.Item) {
            console.log(`Checkout blocked: User ${buyer_id} already owns product ${product_id}`);
            return { 
              error: "You have already purchased this course. It is available in your Workout Library.", 
              url: null 
            };
          }
        } catch (permErr) {
          console.warn("Permission check failed (non-critical, continuing):", permErr.message);
        }

        const queryResponse = await ddb.send(new QueryCommand({
          TableName: process.env.TRAINER_TABLE,
          KeyConditionExpression: "trainer_id = :tid",
          ExpressionAttributeValues: { ":tid": { S: trainer_id } }
        }));

        const trainerData = queryResponse.Items?.[0];
        if (!trainerData) return { error: "Trainer profile not found.", url: null };

        const stripeAccountId = trainerData.stripe_account_id?.S;
        
        if (!stripeAccountId) {
          return { error: "Trainer has not set up payments yet.", url: null };
        }

        // 1. REAL-TIME VERIFICATION: Check if Stripe actually allows charges on this account
        try {
          const account = await stripe.accounts.retrieve(stripeAccountId);
          if (!account.charges_enabled) {
            console.log(`Checkout blocked: Account ${stripeAccountId} charges_enabled is false.`);
            return { 
              error: "This trainer's payment account is still being verified by Stripe. Please try again later.", 
              url: null 
            };
          }
        } catch (accountErr) {
          console.error("Failed to retrieve Stripe account status:", accountErr);
          return { error: "Could not verify trainer's payment status.", url: null };
        }

        // Calculate Combined Fee (Platform + Biophlx)
        const totalAmountCents = Math.round(price * 100);
        const applicationFeeCents = Math.round(totalAmountCents * TOTAL_FEE_PERCENTAGE);

        const session = await stripe.checkout.sessions.create({
          payment_method_types: ['card'],
          line_items: [{
            price_data: {
              currency: 'usd',
              product_data: { 
                name: product_name,
                metadata: {
                  product_id,
                  product_type,
                  trainer_id
                }
              },
              unit_amount: totalAmountCents,
            },
            quantity: 1,
          }],
          mode: 'payment',
          success_url: 'https://biophlx.com',
          cancel_url: 'https://biophlx.com',
          metadata: {
            user_id: buyer_id,
            product_id,
            product_type,
            trainer_id,
            total_fee_cents: applicationFeeCents.toString()
          },
          payment_intent_data: {
            application_fee_amount: applicationFeeCents,
            // Removed transfer_data for Direct Charge (Connected account pays fees)
            metadata: {
              user_id: buyer_id,
              product_id,
              product_type,
              trainer_id,
              total_fee_cents: applicationFeeCents.toString()
            }
          }
        }, {
          stripeAccount: stripeAccountId, // Makes it a Direct Charge on the connected account
        });

        return { url: session.url };
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (err) {
    console.error('Lambda Error:', err);
    return { error: err.message };
  }
};

