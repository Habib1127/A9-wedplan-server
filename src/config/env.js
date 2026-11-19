export const env = {
  port: Number(process.env.PORT) || 5000,
  mongoUri: process.env.MONGODB_URI,
  dbName: process.env.DB_NAME || "wedplan",
  clientUrl: (process.env.CLIENT_URL || "http://localhost:3000").replace(/\/$/, ""),
  stripeKey: process.env.STRIPE_SECRET_KEY || "sk_test_missing",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  premiumPriceCents: Number(process.env.PREMIUM_PRICE_CENTS) || 1900,
};
