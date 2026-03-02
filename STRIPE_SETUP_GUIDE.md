# Stripe Integration Guide: Step-by-Step Setup
## Project: Biophlx Marketplace (Trainer Onboarding & Payments)

This guide provides a simple, non-technical explanation of how the Stripe payment system was set up. It includes steps for the AWS Backend, the Stripe Dashboard, and the Mobile App.

---

### **Part 1: Stripe Dashboard Setup (The "Bank")**
Before the app can process money, you must configure the Stripe Portal.

1.  **Get your API Keys:**
    - Log in to your [Stripe Dashboard](https://dashboard.stripe.com/).
    - Switch to **Test Mode** (toggle on the top right).
    - Go to **Developers > API Keys**.
    - Copy the **Secret Key** (starts with `sk_test_...`). You will need this for the AWS Lambda setup.

2.  **Enable Connect for Trainers:**
    - Go to the **Connect** section in Stripe.
    - Follow the prompts to enable "Express" accounts. This allows trainers to have their own mini-Stripe accounts linked to your platform.

3.  **Set up the Webhook (The "Messenger"):**
    - Go to **Developers > Webhooks**.
    - **Crucial:** Use the **"Connect"** tab for Trainer events and the **"Endpoints"** tab for Checkout events (or create one that listens to both by selecting "Connected and v2 accounts").
    - **Endpoint URL:** `https://xzbzq4nhyascddpoy4bhqvooti0cpcxx.lambda-url.us-east-2.on.aws/`
    - **Select Events:** Choose `checkout.session.completed` and `v2.core.account.updated` (or `account.updated`).
    - Click **Add endpoint**.
    - Copy the **Webhook Signing Secret** (starts with `whsec_...`). This is needed to keep payments secure.

---

### **Part 2: AWS Backend Setup (The "Brain")**
This is where the logic lives. We used two "Lambda" functions to talk to Stripe.

#### **Step 1: The Payment Handler (`biophlx-stripe-handler`)**
This function handles requests when a trainer wants to join or a customer wants to buy.
1.  **Code:** Paste the provided `index.mjs` code into the Lambda editor.
2.  **Layers (The Library):** Because AWS doesn't know what "Stripe" is, we created a "Layer" containing the Stripe library and attached it to the bottom of the Lambda page.
3.  **Environment Variables (The Secrets):** Under **Configuration > Environment Variables**, we added:
    - `STRIPE_SECRET_KEY`: Your key from Stripe.
    - `TRAINER_TABLE`: The name of your database table (`Biophlx-Trainer`).
4.  **Permissions:** We gave the Lambda "Power User" access to DynamoDB so it can save the Trainer's Stripe ID.
5.  **Timeout:** We increased the timeout to **30 seconds** because talking to Stripe can take a moment.

#### **Step 2: The Webhook Receiver (`biophlx-stripe-webhook`)**
This function waits for Stripe to say "The payment was successful!"
1.  **Code:** Paste the updated webhook `index.mjs` code that handles both Snapshot and Thin payloads.
2.  **Security:** Add two Environment Variables:
    - `STRIPE_WEBHOOK_SECRET_THIN`: The secret for your "Account V2" events.
    - `STRIPE_WEBHOOK_SECRET_SNAPSHOT`: The secret for your "Checkout" events.
    This ensures all event types are verified correctly.

---

### **Part 3: Database Configuration (The "Memory")**
DynamoDB is very strict. We had to ensure the "Address" of our data was perfect.
- **Partition Key:** `trainer_id` (String)
- **Sort Key:** `user_id` (String)
- **Important:** If the table has a Sort Key, the code *must* provide both. We updated the AppSync Resolver to automatically grab the logged-in user's ID and send it to the Lambda.

---

### **Part 4: Mobile App Flow (The "User Experience")**

#### **For Trainers (Onboarding):**
1.  Trainer goes to the **Monetization Screen**.
2.  Clicks **"Enable Payouts"**.
3.  The app calls AWS, which asks Stripe for a special link.
4.  The app opens a secure browser window using `expo-web-browser`.
5.  **Status Sync:** A popup will appear in the app. **Do not close it.** Once you finish your details in the browser and return to the app, click **"OK"** on that popup to instantly update your status to "Active".
6.  **Testing Tip:** Use `000-000` for the phone code and click "Use Test Account" for bank details.

#### **For Customers (Purchasing):**
1.  Customer goes to a **Trainer's Profile**.
2.  Clicks **"Purchase"** on a workout or service.
3.  A secure Stripe Checkout page opens.
4.  Once paid, Stripe tells our Webhook, and the Webhook automatically grants the customer permission to view the workout in the database.

---

### **Part 5: Moving from Sandbox to Production**
When you are ready to move from testing to real payments, follow these steps to ensure everything stays secure and functional.

#### **1. Re-create the Webhooks in Live Mode**
You must have **TWO** separate webhook endpoints in your Stripe Live Dashboard pointing to the same Lambda URL. This is because "Connect" events and "Platform" events are handled slightly differently by Stripe's security.

*   **Webhook A: The "Onboarding" Webhook (Connect)**
    *   **Events from**: Select **"Connected and v2 accounts"**.
    *   **Events to listen to**: `account.updated`.
    *   **Endpoint URL**: Your Lambda URL.
    *   **Signing Secret**: Save this as `STRIPE_WEBHOOK_SECRET_THIN` in Lambda.
    *   **Why?**: This tells the app when a trainer has finished their bank details so they can start selling.

*   **Webhook B: The "Checkout" Webhook (Platform)**
    *   **Events from**: Select **"Your account"** (NOT "Connected").
    *   **Events to listen to**: `checkout.session.completed`.
    *   **Endpoint URL**: Your Lambda URL.
    *   **Payload Style**: Select **"Snapshot"** (Default).
    *   **Signing Secret**: Save this as `STRIPE_WEBHOOK_SECRET_SNAPSHOT` in Lambda.
    *   **Why?**: This tells the app when a customer has paid so it can unlock the workout for them.

#### **2. Update Lambda Environment Variables**
In your AWS Lambda console, update these keys to their **Live** versions. **Caution:** Do not mix up the webhook secrets!

| Variable Name | Value Type | Description |
| :--- | :--- | :--- |
| `STRIPE_SECRET_KEY` | `sk_live_...` | Your main Stripe Live Secret Key. |
| `STRIPE_WEBHOOK_SECRET_SNAPSHOT` | `whsec_...` | The secret from **Webhook B** (Checkout). |
| `STRIPE_WEBHOOK_SECRET_THIN` | `whsec_...` | The secret from **Webhook A** (Onboarding). |
| `BYPASS_SIGNATURE` | `false` | **CRITICAL:** Must be set to `false` for real payments. |
| `PERMISSIONS_TABLE` | `Biophlx-Permissions` | The name of your permissions table. |
| `TRAINER_TABLE` | `Biophlx-Trainer` | The name of your trainer table. |

#### **3. Stripe Dashboard Connect Settings**
1.  **Branding**: Go to **Settings > Connect > Branding**. Upload your logo and brand color. This is the first thing trainers see.
2.  **Payouts**: Ensure you have linked your own business bank account to your platform Stripe account so you can receive the platform fees.
3.  **Terms of Service**: Update your platform's terms of service URL in Stripe settings.

#### **4. Final Production Checklist**
1.  **Switch to Live Mode**: Ensure both Stripe and your AWS environment variables are using `live` keys.
2.  **Verify Signature Verification**: Ensure `BYPASS_SIGNATURE` is `false`. The webhook will now reject any request that doesn't come directly from Stripe.
3.  **Perform a "Penny Test"**: Create a test product for $1.00 and purchase it with a real card. Verify:
    - The customer is charged $1.00.
    - The Trainer's connected account balance increases by $0.90 (90%).
    - Your Platform account balance increases by $0.10 (10% fee).
    - The workout appears in the customer's "Workout Library" immediately.

---

### **Troubleshooting Checklist**
- **Stuck on "Loading" in Stripe?** Click "Enter test bank account credentials instead".
- **Error "Cannot find package 'stripe'"?** Ensure the Lambda Layer is attached.
- **Error "Not Authorized"?** Ensure the IAM Role has `AmazonDynamoDBFullAccess`.
- **Error "Key element does not match"?** Ensure you are providing both `trainer_id` and `user_id` to the database call.
