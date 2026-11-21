import { Router } from "express";
import { env } from "../config/env.js";
import { transactions, users } from "../config/db.js";
import { stripe } from "../config/stripe.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { HttpError, asyncHandler, isPremium, toId } from "../utils/helpers.js";

const router = Router();

router.post("/checkout", authenticate, requireRole("vendor"), asyncHandler(async (req, res) => {
  if (isPremium(req.user)) throw new HttpError(409, "You are already on the Premium plan");
  const vendorId = String(req.user._id);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer_email: req.user.email,
    client_reference_id: vendorId,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: env.premiumPriceCents,
          recurring: { interval: "month" },
          product_data: { name: "WedPlan Premium Vendor", description: "Unlimited active services and Premium badge" },
        },
      },
    ],
    metadata: { vendorId },
    subscription_data: { metadata: { vendorId } },
    success_url: `${env.clientUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.clientUrl}/payment/cancel`,
  });
  res.json({ success: true, data: { url: session.url } });
}));

router.get("/session/:sessionId", authenticate, requireRole("vendor"), asyncHandler(async (req, res) => {
  const tx = await transactions().findOne({ stripeSessionId: req.params.sessionId, vendorId: req.user._id });
  res.json({
    success: true,
    data: {
      confirmed: !!tx && tx.status === "paid",
      transaction: tx ? { amount: tx.amount, currency: tx.currency, status: tx.status, plan: tx.plan, createdAt: tx.createdAt } : null,
      plan: isPremium(req.user) ? "premium" : "free",
    },
  });
}));

router.post("/cancel", authenticate, requireRole("vendor"), asyncHandler(async (req, res) => {
  if (!isPremium(req.user)) throw new HttpError(400, "You do not have an active Premium plan");
  const tx = await transactions().findOne(
    { vendorId: req.user._id, status: "paid", stripeSubscriptionId: { $ne: null } },
    { sort: { createdAt: -1 } },
  );
  if (!tx) throw new HttpError(404, "No subscription found");
  await stripe.subscriptions.update(tx.stripeSubscriptionId, { cancel_at_period_end: true });
  res.json({ success: true, message: "Subscription will end at the close of the current billing period" });
}));

const periodEnd = (sub) => {
  const seconds = sub.items?.data?.[0]?.current_period_end ?? sub.current_period_end;
  return seconds ? new Date(seconds * 1000) : null;
};

async function activate(vendorId, subscriptionId) {
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  await users().updateOne(
    { _id: vendorId },
    { $set: { subscriptionPlan: "premium", subscriptionExpiresAt: periodEnd(sub) } },
  );
}

async function vendorFromSubscription(subscriptionId) {
  const tx = await transactions().findOne({ stripeSubscriptionId: subscriptionId }, { sort: { createdAt: -1 } });
  return tx?.vendorId || null;
}

export const stripeWebhook = asyncHandler(async (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], env.stripeWebhookSecret);
  } catch {
    return res.status(400).send("Invalid webhook signature");
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const vendorId = toId(session.metadata?.vendorId);
      if (!vendorId || session.mode !== "subscription") break;
      const paid = session.payment_status === "paid";
      await transactions().updateOne(
        { stripeSessionId: session.id },
        {
          $set: { status: paid ? "paid" : "failed" },
          $setOnInsert: {
            vendorId,
            plan: "premium",
            amount: (session.amount_total || 0) / 100,
            currency: session.currency,
            stripeSessionId: session.id,
            stripeSubscriptionId: session.subscription || null,
            createdAt: new Date(),
          },
        },
        { upsert: true },
      );
      if (paid && session.subscription) await activate(vendorId, session.subscription);
      break;
    }
    case "invoice.paid": {
      const invoice = event.data.object;
      const subscriptionId = invoice.subscription || invoice.parent?.subscription_details?.subscription;
      if (!subscriptionId || invoice.billing_reason === "subscription_create") break;
      const vendorId = await vendorFromSubscription(subscriptionId);
      if (vendorId) await activate(vendorId, subscriptionId);
      break;
    }
    case "customer.subscription.deleted": {
      const vendorId = await vendorFromSubscription(event.data.object.id);
      if (vendorId) {
        await users().updateOne({ _id: vendorId }, { $set: { subscriptionPlan: "free", subscriptionExpiresAt: null } });
      }
      break;
    }
    default:
      break;
  }
  res.json({ received: true });
});

export default router;
