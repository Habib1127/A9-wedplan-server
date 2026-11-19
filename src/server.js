import express from "express";
import cors from "cors";
import { env } from "./config/env.js";
import { connectDb } from "./config/db.js";
import { errorHandler, notFound } from "./middleware/error.js";
import { asyncHandler } from "./utils/helpers.js";
import servicesRouter, { vendorServices } from "./routes/services.js";
import { customerBookings, vendorBookings, vendorOverview } from "./routes/bookings.js";
import adminRouter from "./routes/admin.js";
import profileRouter from "./routes/profile.js";
import paymentsRouter, { stripeWebhook } from "./routes/payments.js";

const app = express();

app.use(cors({ origin: env.clientUrl.split(","), credentials: true, methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"] }));
app.use(asyncHandler(async (_req, _res, next) => {
  await connectDb();
  next();
}));

app.post("/api/webhooks/stripe", express.raw({ type: "application/json" }), stripeWebhook);

app.use(express.json({ limit: "1mb" }));

app.get("/", (_req, res) => res.json({ success: true, message: "WedPlan API is running" }));
app.use("/api/services", servicesRouter);
app.use("/api/vendor/services", vendorServices);
app.use("/api/vendor/bookings", vendorBookings);
app.use("/api/vendor/overview", vendorOverview);
app.use("/api/customer/bookings", customerBookings);
app.use("/api/admin", adminRouter);
app.use("/api/me", profileRouter);
app.use("/api/payments", paymentsRouter);

app.use(notFound);
app.use(errorHandler);

if (!process.env.VERCEL) {
  app.listen(env.port, () => console.log(`WedPlan API listening on port ${env.port}`));
}

export default app;
