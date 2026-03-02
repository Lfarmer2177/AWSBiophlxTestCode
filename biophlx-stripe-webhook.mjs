import Stripe from 'stripe';
import { DynamoDBClient, UpdateItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const ddb = new DynamoDBClient({});

export const handler = async (event) => {
  const headers = event.headers || {};
  const userAgent = headers['User-Agent'] || headers['user-agent'] || 'unknown';
  const isStripeTrigger = userAgent.includes('Stripe');

  console.log('--- WEBHOOK INVOCATION START ---');
  console.log('Source:', isStripeTrigger ? 'REAL STRIPE TRIGGER' : (event.isTest ? 'MANUAL LAMBDA TEST' : 'OTHER'));
  console.log('Event Type:', event.type || 'unknown');
  console.log('Is Base64 Encoded:', event.isBase64Encoded || false);
  console.log('Bypass Signature Env:', process.env.BYPASS_SIGNATURE);

  // Decode body if it's base64 encoded by Lambda/API Gateway
  const rawBody = event.isBase64Encoded 
    ? Buffer.from(event.body, 'base64').toString('utf8') 
    : event.body;
  
  console.log('Raw Body Preview (first 50 chars):', rawBody?.substring(0, 50));
  
  let stripeEvent;
  const sig = headers['stripe-signature'] || headers['Stripe-Signature'];
  console.log('Signature Header Present:', !!sig);

  if (!sig) {
    console.error('MISSING SIGNATURE: No stripe-signature header found.');
    if (event.isTest || process.env.BYPASS_SIGNATURE === 'true') {
      console.log('BYPASSING SIGNATURE for testing purposes...');
      stripeEvent = typeof event.body === 'string' ? JSON.parse(rawBody) : event;
    } else {
      return { statusCode: 400, body: 'Webhook Error: No signature' };
    }
  } else {
    try {
      // Try Snapshot secret (V1)
      console.log('Attempting V1 Signature Verification...');
      stripeEvent = stripe.webhooks.constructEvent(
        rawBody,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET_SNAPSHOT
      );
      console.log('V1 Verification Success');
    } catch (err1) {
      console.log('V1 Verification Failed, trying V2...');
      
      // If we are in sandbox/test mode and verification fails, we can optionally bypass
      if (process.env.BYPASS_SIGNATURE === 'true') {
        console.warn('SIGNATURE VERIFICATION FAILED but BYPASS_SIGNATURE is enabled. Proceeding with raw body.');
        stripeEvent = JSON.parse(rawBody);
      } else {
        try {
          // Try Thin secret (V2)
          stripeEvent = stripe.webhooks.constructEvent(
            rawBody,
            sig,
            process.env.STRIPE_WEBHOOK_SECRET_THIN || process.env.STRIPE_WEBHOOK_SECRET
          );
          console.log('V2 Verification Success');
        } catch (err2) {
          console.error('CRITICAL: Signature verification failed for both V1 and V2.');
          console.error('V1 Error:', err1.message);
          console.error('V2 Error:', err2.message);
          return { statusCode: 400, body: `Webhook Error: ${err1.message}` };
        }
      }
    }
  }

  const eventType = stripeEvent.type;
  const connectedAccountId = stripeEvent.account || 'Platform Account';
  console.log(`Processing Event: ${eventType} (ID: ${stripeEvent.id})`);
  console.log(`From Connected Account: ${connectedAccountId}`);

  try {
    switch (eventType) {
      case 'checkout.session.completed': {
        const session = stripeEvent.data.object;
        
        // Only fulfill if the payment is actually successful
        if (session.payment_status !== 'paid') {
          console.log(`Checkout session ${session.id} not paid yet (Status: ${session.payment_status}). Skipping fulfillment.`);
          break;
        }

        // Retrieve metadata from session or fallback to PaymentIntent
        let metadata = session.metadata || {};
        
        if (!metadata.user_id && session.payment_intent) {
          console.log(`Metadata missing from session, attempting retrieval from PI: ${session.payment_intent} (Account: ${connectedAccountId})`);
          try {
            // First attempt: use the account ID if provided
            const retrieveOptions = connectedAccountId !== 'Platform Account' 
              ? { stripeAccount: connectedAccountId } 
              : {};
              
            try {
              const pi = await stripe.paymentIntents.retrieve(session.payment_intent, retrieveOptions);
              metadata = pi.metadata || {};
              console.log('PaymentIntent retrieved successfully with options:', JSON.stringify(retrieveOptions));
            } catch (firstErr) {
              // Fallback: if retrieval fails and we used a connected account ID, try the platform account
              if (connectedAccountId !== 'Platform Account') {
                console.warn(`Retrieval from connected account ${connectedAccountId} failed: ${firstErr.message}. Falling back to Platform account...`);
                const piFallback = await stripe.paymentIntents.retrieve(session.payment_intent);
                metadata = piFallback.metadata || {};
                console.log('PaymentIntent retrieved successfully from Platform account fallback.');
              } else {
                throw firstErr; // Re-throw if it was already a platform retrieval
              }
            }
          } catch (piErr) {
            console.warn(`Could not retrieve PaymentIntent ${session.payment_intent} from any source. Error: ${piErr.message}`);
          }
        }

        const { user_id, product_id, product_type, trainer_id } = metadata;

        console.log('Fulfilling order for session:', session.id, { user_id, product_id, product_type, trainer_id });

        if (!user_id || !product_id) {
          console.error('CRITICAL: Missing fulfillment metadata in session or PI', { session_id: session.id, metadata });
          return { statusCode: 400, body: 'Missing fulfillment metadata' };
        }

        try {
          await ddb.send(new UpdateItemCommand({
            TableName: process.env.PERMISSIONS_TABLE || 'Biophlx-Permissions',
            Key: {
              user_id: { S: user_id },
              resource_id: { S: product_id }
            },
            UpdateExpression: 'SET product_type = :pt, trainer_id = :tid, purchased_at = :pa, #s = :s',
            ExpressionAttributeNames: {
              '#s': 'status'
            },
            ExpressionAttributeValues: {
              ':pt': { S: product_type || 'workout' },
              ':tid': { S: trainer_id || 'unknown' },
              ':pa': { S: new Date().toISOString() },
              ':s': { S: 'active' }
            }
          }));
          console.log(`SUCCESS: Permission granted for User ${user_id} -> Resource ${product_id}`);

          // --- UPDATE TRAINER STATS ---
          if (trainer_id) {
            try {
              const amountPaid = session.amount_total / 100;
              const isService = product_type === 'service';
              
              // Find trainer record by trainer_id to get the user_id (required for composite key)
              const trainerQuery = await ddb.send(new QueryCommand({
                TableName: process.env.TRAINER_TABLE || 'Biophlx-Trainer',
                KeyConditionExpression: 'trainer_id = :tid',
                ExpressionAttributeValues: { ':tid': { S: trainer_id } }
              }));

              const trainerRecord = trainerQuery.Items?.[0];
              if (trainerRecord) {
                const trainerUserId = trainerRecord.user_id.S;
                
                // Use ADD for atomic increments (Safe for concurrent purchases)
                await ddb.send(new UpdateItemCommand({
                  TableName: process.env.TRAINER_TABLE || 'Biophlx-Trainer',
                  Key: {
                    trainer_id: { S: trainer_id },
                    user_id: { S: trainerUserId }
                  },
                  UpdateExpression: 'ADD total_revenue :rev, total_clients :one, ' + 
                                   (isService ? 'services_sold :one' : 'workouts_sold :one'),
                  ExpressionAttributeValues: {
                    ':rev': { N: amountPaid.toString() },
                    ':one': { N: '1' }
                  }
                }));
                console.log(`SUCCESS: Trainer ${trainer_id} stats updated (+ $${amountPaid} Revenue)`);
              } else {
                console.warn(`WARNING: Trainer ${trainer_id} not found in DB. Stats not updated.`);
              }
            } catch (statErr) {
              console.error('FAILED to update trainer stats:', statErr);
            }
          }
        } catch (dbErr) {
          console.error('DATABASE ERROR: Failed to grant permission', dbErr);
          throw dbErr;
        }
        break;
      }

      case 'account.updated':
      case 'v2.core.account.updated': {
        const account = stripeEvent.data.object;
        const { trainer_id, user_id } = account.metadata || {};

        console.log(`Processing account update for trainer: ${trainer_id}, User: ${user_id}`);
        
        // Check if onboarding is complete and charges/payouts are enabled
        const isReady = account.details_submitted && account.charges_enabled && account.payouts_enabled;

        if (trainer_id && user_id) {
          console.log(`Trainer ${trainer_id} Ready Status: ${isReady} (Details: ${account.details_submitted}, Charges: ${account.charges_enabled}, Payouts: ${account.payouts_enabled})`);
          
          await ddb.send(new UpdateItemCommand({
            TableName: process.env.TRAINER_TABLE || 'Biophlx-Trainer',
            Key: {
              trainer_id: { S: trainer_id },
              user_id: { S: user_id }
            },
            UpdateExpression: 'SET stripe_onboarded = :so, stripe_payouts_enabled = :spe, stripe_charges_enabled = :sce',
            ExpressionAttributeValues: {
              ':so': { BOOL: account.details_submitted },
              ':spe': { BOOL: account.payouts_enabled },
              ':sce': { BOOL: account.charges_enabled }
            }
          }));
          console.log(`Trainer ${trainer_id} status updated in DynamoDB.`);
        } else {
          console.log(`Account update received for ${account.id} but missing trainer_id/user_id metadata. Skipping DB update.`);
        }
        break;
      }

      default:
        console.log(`Unhandled event type: ${eventType}`);
    }

    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (err) {
    console.error('Error processing webhook:', err);
    return { statusCode: 500, body: `Internal Server Error: ${err.message}` };
  }
};
