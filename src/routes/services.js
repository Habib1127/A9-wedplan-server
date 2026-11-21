import { Router } from "express";
import { z } from "zod";
import { services, users } from "../config/db.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import {
  CATEGORIES, FREE_SERVICE_LIMIT, HttpError, asyncHandler, escapeRegex, isPremium, parse, requireId,
} from "../utils/helpers.js";

const router = Router();

const vendorLookup = [
  { $lookup: { from: "users", localField: "vendorId", foreignField: "_id", as: "vendor" } },
  { $unwind: { path: "$vendor", preserveNullAndEmptyArrays: true } },
  {
    $project: {
      serviceName: 1, category: 1, description: 1, price: 1, location: 1, images: 1,
      status: 1, isActive: 1, createdAt: 1, vendorId: 1,
      "vendor.name": 1, "vendor.image": 1, "vendor.businessName": 1,
      "vendor.subscriptionPlan": 1, "vendor.subscriptionExpiresAt": 1,
    },
  },
];

const withVendorBadge = (s) => ({
  ...s,
  vendor: s.vendor
    ? {
        name: s.vendor.name,
        image: s.vendor.image || null,
        businessName: s.vendor.businessName || "",
        isPremium: isPremium(s.vendor),
      }
    : null,
});

const serviceSchema = z.object({
  serviceName: z.string().trim().min(3, "Service name must be at least 3 characters").max(120),
  category: z.enum(CATEGORIES, { errorMap: () => ({ message: "Choose a valid category" }) }),
  description: z.string().trim().min(20, "Description must be at least 20 characters").max(3000),
  price: z.coerce.number({ invalid_type_error: "Price must be a number" }).positive("Price must be greater than 0").max(10000000),
  location: z.string().trim().min(2, "Location is required").max(120),
  images: z.array(z.string().url("Image must be a valid URL")).min(1, "Upload at least one image").max(6),
});

router.get("/", asyncHandler(async (req, res) => {
  const { search = "", category = "", location = "", sort = "newest" } = req.query;
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 12, 1), 48);

  const match = { status: "approved", isActive: true };
  if (category && CATEGORIES.includes(category)) match.category = category;
  if (location) match.location = { $regex: escapeRegex(String(location).trim()), $options: "i" };

  const terms = String(search).trim().split(/\s+/).filter(Boolean).slice(0, 6);
  if (terms.length) {
    match.$and = terms.map((t) => {
      const rx = { $regex: escapeRegex(t), $options: "i" };
      return { $or: [{ serviceName: rx }, { description: rx }, { category: rx }, { location: rx }] };
    });
  }

  const sortStage =
    sort === "price_asc" ? { price: 1, _id: -1 } : sort === "price_desc" ? { price: -1, _id: -1 } : { createdAt: -1 };

  const [items, total] = await Promise.all([
    services()
      .aggregate([{ $match: match }, { $sort: sortStage }, { $skip: (page - 1) * limit }, { $limit: limit }, ...vendorLookup])
      .toArray(),
    services().countDocuments(match),
  ]);

  res.json({
    success: true,
    data: items.map(withVendorBadge),
    pagination: { page, limit, total, pages: Math.max(Math.ceil(total / limit), 1) },
  });
}));

router.get("/categories", asyncHandler(async (_req, res) => {
  const counts = await services()
    .aggregate([{ $match: { status: "approved", isActive: true } }, { $group: { _id: "$category", count: { $sum: 1 } } }])
    .toArray();
  const map = Object.fromEntries(counts.map((c) => [c._id, c.count]));
  res.json({ success: true, data: CATEGORIES.map((name) => ({ name, count: map[name] || 0 })) });
}));

router.get("/locations", asyncHandler(async (_req, res) => {
  const list = await services().distinct("location", { status: "approved", isActive: true });
  res.json({ success: true, data: list.sort() });
}));

router.get("/:id", authenticate, asyncHandler(async (req, res) => {
  const id = requireId(req.params.id, "service ID");
  const [service] = await services().aggregate([{ $match: { _id: id } }, ...vendorLookup]).toArray();
  if (!service) throw new HttpError(404, "Service not found");
  const publicVisible = service.status === "approved" && service.isActive;
  const isOwner = String(service.vendorId) === String(req.user._id);
  if (!publicVisible && !isOwner && req.user.role !== "admin") throw new HttpError(404, "Service not found");
  res.json({ success: true, data: withVendorBadge(service) });
}));

export const vendorServices = Router();
vendorServices.use(authenticate, requireRole("vendor"));

async function activeCount(vendorId, excludeId) {
  const filter = { vendorId, isActive: true, status: { $ne: "rejected" } };
  if (excludeId) filter._id = { $ne: excludeId };
  return services().countDocuments(filter);
}

async function assertWithinLimit(user, excludeId) {
  if (isPremium(user)) return;
  if ((await activeCount(user._id, excludeId)) >= FREE_SERVICE_LIMIT) {
    throw new HttpError(403, `Free vendors can keep ${FREE_SERVICE_LIMIT} active services. Upgrade to Premium for unlimited services.`);
  }
}

vendorServices.get("/", asyncHandler(async (req, res) => {
  const list = await services().find({ vendorId: req.user._id }).sort({ createdAt: -1 }).toArray();
  res.json({ success: true, data: list });
}));

vendorServices.post("/", asyncHandler(async (req, res) => {
  const data = parse(serviceSchema, req.body);
  await assertWithinLimit(req.user);
  const doc = { ...data, vendorId: req.user._id, status: "pending", isActive: true, createdAt: new Date() };
  const { insertedId } = await services().insertOne(doc);
  res.status(201).json({ success: true, message: "Service submitted for admin approval", data: { ...doc, _id: insertedId } });
}));

vendorServices.get("/:id", asyncHandler(async (req, res) => {
  const service = await services().findOne({ _id: requireId(req.params.id, "service ID"), vendorId: req.user._id });
  if (!service) throw new HttpError(404, "Service not found");
  res.json({ success: true, data: service });
}));

vendorServices.patch("/:id", asyncHandler(async (req, res) => {
  const id = requireId(req.params.id, "service ID");
  const data = parse(serviceSchema, req.body);
  const existing = await services().findOne({ _id: id, vendorId: req.user._id });
  if (!existing) throw new HttpError(404, "Service not found");
  const update = { ...data };
  if (existing.status === "rejected") {
    await assertWithinLimit(req.user, id);
    update.status = "pending";
  }
  await services().updateOne({ _id: id }, { $set: update });
  res.json({ success: true, message: "Service updated" });
}));

vendorServices.patch("/:id/availability", asyncHandler(async (req, res) => {
  const id = requireId(req.params.id, "service ID");
  const { isActive } = parse(z.object({ isActive: z.boolean() }), req.body);
  const existing = await services().findOne({ _id: id, vendorId: req.user._id });
  if (!existing) throw new HttpError(404, "Service not found");
  if (isActive && existing.status !== "rejected") await assertWithinLimit(req.user, id);
  await services().updateOne({ _id: id }, { $set: { isActive } });
  res.json({ success: true, message: isActive ? "Service is now available" : "Service is now hidden" });
}));

vendorServices.delete("/:id", asyncHandler(async (req, res) => {
  const result = await services().deleteOne({ _id: requireId(req.params.id, "service ID"), vendorId: req.user._id });
  if (!result.deletedCount) throw new HttpError(404, "Service not found");
  res.json({ success: true, message: "Service deleted" });
}));

export default router;
