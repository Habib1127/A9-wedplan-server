<div align="center">
  <h1><strong>WedPlan - Server</strong></h1>
  <p>
    <strong>Live Website Link:</strong> <a href="https://a9-wedplan-client.vercel.app/">Click Here</a><br>
    <strong>Client Repository:</strong> <a href="https://github.com/Habib1127/A9-wedplan-client">CLIENT_REPO_LINK</a><br>
   
  </p>
</div>

## About
Express.js API for WedPlan, a wedding planning platform with customer, vendor and admin roles.

## Important Features

- JWT verification on every protected route (tokens issued by Better Auth on the client app and checked through its JWKS endpoint)
- Role middleware for admin, vendor and customer. Roles and blocked status are read from the database, never from the client
- Ownership checks on every update and delete
- Services with approval flow (pending, approved, rejected) and availability switch
- Free plan limit: 3 active services. Premium: unlimited
- Booking rules: no booking own service, no duplicate active request for the same service and date, pending-only accept/reject/cancel
- Stripe Checkout subscription session created on the server for the logged-in vendor only
- Stripe webhook (signature verified) saves the transaction and activates or removes Premium. The success page alone never activates Premium
- Advanced search, category and location filters, price sorting, pagination
- Zod request validation and clear 400, 401, 403, 404, 409 responses

## Technology Stack

- Node.js
- Express.js 
- MongoDB (native driver)
- jose (JWT) 
- Stripe
- Zod

## Collections

`users` (managed by Better Auth, with role, isBlocked, businessName, subscriptionPlan, subscriptionExpiresAt), `services`, `bookings`, `transactions`.

## Installation

```bash
npm install
cp .env
```

| Variable | What it is |
| --- | --- |
| PORT | Server port (default 5000) |
| MONGODB_URI | MongoDB connection string |
| DB_NAME | Database name (same as the client) |
| CLIENT_URL | Exact URL of the client, used for CORS and JWT checks |
| STRIPE_SECRET_KEY | Stripe test secret key |
| STRIPE_WEBHOOK_SECRET | Stripe webhook signing secret |
| PREMIUM_PRICE_CENTS | Premium price per month in cents (default 1900) |

## How to Run Locally

```bash
npm run dev
```

Forward Stripe events while developing:

```bash
stripe listen --forward-to localhost:5000/api/webhooks/stripe
```

Copy the `whsec_...` value it prints into `STRIPE_WEBHOOK_SECRET`. In production add a webhook endpoint `https://<server-url>/api/webhooks/stripe` with these events: `checkout.session.completed`, `invoice.paid`, `customer.subscription.deleted`.

## Creating the admin account

Sign up on the client first, then:

```bash
npm run node --env-file=.env src/scripts/makeAdmin.js email@example.com 
```

## Main endpoints

| Area | Endpoints |
| --- | --- |
| Public | GET /api/services, /api/services/categories, /api/services/locations |
| Any user | GET /api/services/:id, GET and PATCH /api/me |
| Vendor | /api/vendor/services, /api/vendor/bookings, /api/vendor/overview, POST /api/payments/checkout, POST /api/payments/cancel |
| Customer | /api/customer/bookings (create, list, overview, cancel) |
| Admin | /api/admin/overview, /users, /services, /transactions |
| Stripe | POST /api/webhooks/stripe |