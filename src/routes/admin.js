import { Router } from "express";
import { z } from "zod";
import { bookings, services, transactions, users } from "../config/db.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { CATEGORIES, HttpError, asyncHandler, escapeRegex, parse, publicUser, requireId } from "../utils/helpers.js";

const router = Router();
router.use(authenticate, requireRole("admin"));

router.get("/overview", asyncHandler(async (_req, res) => {
  const [totalUsers, totalVendors, totalCustomers, totalServices, pendingServices, totalTransactions] = await Promise.all([
    users().countDocuments({}),
    users().countDocuments({ role: "vendor" }),
    users().countDocuments({ role: "customer" }),
    services().countDocuments({}),
    services().countDocuments({ status: "pending" }),
    transactions().countDocuments({}),
  ]);
  res.json({ success: true, data: { totalUsers, totalVendors, totalCustomers, totalServices, pendingServices, totalTransactions } });
}));

router.get("/users", asyncHandler(async (req, res) => {
  const { search = "", role = "" } = req.query;
  const filter = {};
  if (["admin", "vendor", "customer"].includes(role)) filter.role = role;
  const q = String(search).trim();
  if (q) {
    const rx = { $regex: escapeRegex(q), $options: "i" };
    filter.$or = [{ name: rx }, { email: rx }];
  }
  const list = await users().find(filter).sort({ createdAt: -1 }).limit(500).toArray();
  res.json({ success: true, data: list.map(publicUser) });
}));

router.get("/users/:id", asyncHandler(async (req, res) => {
  const id = requireId(req.params.id, "user ID");
  const user = await users().findOne({ _id: id });
  if (!user) throw new HttpError(404, "User not found");
  const [serviceCount, bookingCount] = await Promise.all([
    services().countDocuments({ vendorId: id }),
    bookings().countDocuments({ $or: [{ customerId: id }, { vendorId: id }] }),
  ]);
  res.json({ success: true, data: { ...publicUser(user), serviceCount, bookingCount } });
}));

router.patch("/users/:id/block", asyncHandler(async (req, res) => {
  const id = requireId(req.params.id, "user ID");
  const { isBlocked } = parse(z.object({ isBlocked: z.boolean() }), req.body);
  const user = await users().findOne({ _id: id });
  if (!user) throw new HttpError(404, "User not found");
  if (user.role === "admin") throw new HttpError(403, "Admin accounts cannot be blocked");
  await users().updateOne({ _id: id }, { $set: { isBlocked } });
  res.json({ success: true, message: isBlocked ? "User blocked" : "User unblocked" });
}));

router.get("/services", asyncHandler(async (req, res) => {
  const { search = "", status = "", category = "" } = req.query;
  const filter = {};
  if (["pending", "approved", "rejected"].includes(status)) filter.status = status;
  if (CATEGORIES.includes(category)) filter.category = category;
  const q = String(search).trim();
  if (q) filter.serviceName = { $regex: escapeRegex(q), $options: "i" };
  const list = await services()
    .aggregate([
      { $match: filter },
      { $sort: { createdAt: -1 } },
      { $limit: 500 },
      { $lookup: { from: "users", localField: "vendorId", foreignField: "_id", as: "vendor" } },
      { $unwind: { path: "$vendor", preserveNullAndEmptyArrays: true } },
      { $project: { serviceName: 1, category: 1, price: 1, location: 1, images: 1, status: 1, isActive: 1, createdAt: 1, "vendor.name": 1, "vendor.email": 1 } },
    ])
    .toArray();
  res.json({ success: true, data: list });
}));

router.patch("/services/:id/status", asyncHandler(async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(["pending", "approved", "rejected"]) }), req.body);
  const result = await services().updateOne({ _id: requireId(req.params.id, "service ID") }, { $set: { status } });
  if (!result.matchedCount) throw new HttpError(404, "Service not found");
  res.json({ success: true, message: `Service ${status}` });
}));

router.delete("/services/:id", asyncHandler(async (req, res) => {
  const id = requireId(req.params.id, "service ID");
  const result = await services().deleteOne({ _id: id });
  if (!result.deletedCount) throw new HttpError(404, "Service not found");
  await bookings().updateMany({ serviceId: id, status: "pending" }, { $set: { status: "cancelled" } });
  res.json({ success: true, message: "Service deleted" });
}));

router.get("/transactions", asyncHandler(async (_req, res) => {
  const list = await transactions()
    .aggregate([
      { $sort: { createdAt: -1 } },
      { $limit: 500 },
      { $lookup: { from: "users", localField: "vendorId", foreignField: "_id", as: "vendor" } },
      { $unwind: { path: "$vendor", preserveNullAndEmptyArrays: true } },
      { $project: { plan: 1, amount: 1, currency: 1, status: 1, createdAt: 1, stripeSessionId: 1, "vendor.name": 1, "vendor.email": 1 } },
    ])
    .toArray();
  res.json({ success: true, data: list });
}));

export default router;
