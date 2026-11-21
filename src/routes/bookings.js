import { Router } from "express";
import { z } from "zod";
import { bookings, services, users } from "../config/db.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { HttpError, asyncHandler, isPremium, parse, requireId } from "../utils/helpers.js";

const joinStages = [
  { $lookup: { from: "services", localField: "serviceId", foreignField: "_id", as: "service" } },
  { $unwind: { path: "$service", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "users", localField: "vendorId", foreignField: "_id", as: "vendor" } },
  { $unwind: { path: "$vendor", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "users", localField: "customerId", foreignField: "_id", as: "customer" } },
  { $unwind: { path: "$customer", preserveNullAndEmptyArrays: true } },
  {
    $project: {
      eventDate: 1, eventLocation: 1, message: 1, status: 1, createdAt: 1, serviceId: 1, vendorId: 1, customerId: 1,
      "service.serviceName": 1, "service.images": 1, "service.category": 1, "service.price": 1,
      "vendor.name": 1, "vendor.email": 1, "vendor.image": 1, "vendor.businessName": 1,
      "customer.name": 1, "customer.email": 1, "customer.image": 1, "customer.phone": 1,
    },
  },
];

const bookingSchema = z.object({
  serviceId: z.string(),
  eventDate: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Enter a valid event date"),
  eventLocation: z.string().trim().min(2, "Event location is required").max(200),
  message: z.string().trim().max(1000).optional().default(""),
});

export const customerBookings = Router();
customerBookings.use(authenticate, requireRole("customer"));

customerBookings.post("/", asyncHandler(async (req, res) => {
  const data = parse(bookingSchema, req.body);
  const serviceId = requireId(data.serviceId, "service ID");
  const eventDate = new Date(data.eventDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (eventDate < today) throw new HttpError(400, "Event date cannot be in the past");

  const service = await services().findOne({ _id: serviceId });
  if (!service || service.status !== "approved" || !service.isActive) {
    throw new HttpError(404, "This service is not available for booking");
  }
  if (String(service.vendorId) === String(req.user._id)) {
    throw new HttpError(403, "You cannot book your own service");
  }

  const dayStart = new Date(eventDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const duplicate = await bookings().findOne({
    customerId: req.user._id,
    serviceId,
    status: { $in: ["pending", "accepted"] },
    eventDate: { $gte: dayStart, $lt: dayEnd },
  });
  if (duplicate) throw new HttpError(409, "You already have an active request for this service on that date");

  const doc = {
    serviceId,
    vendorId: service.vendorId,
    customerId: req.user._id,
    eventDate,
    eventLocation: data.eventLocation,
    message: data.message,
    status: "pending",
    createdAt: new Date(),
  };
  const { insertedId } = await bookings().insertOne(doc);
  res.status(201).json({ success: true, message: "Booking request sent to the vendor", data: { ...doc, _id: insertedId } });
}));

customerBookings.get("/", asyncHandler(async (req, res) => {
  const list = await bookings()
    .aggregate([{ $match: { customerId: req.user._id } }, { $sort: { createdAt: -1 } }, ...joinStages])
    .toArray();
  res.json({ success: true, data: list });
}));

customerBookings.get("/overview", asyncHandler(async (req, res) => {
  const rows = await bookings()
    .aggregate([{ $match: { customerId: req.user._id } }, { $group: { _id: "$status", count: { $sum: 1 } } }])
    .toArray();
  const by = Object.fromEntries(rows.map((r) => [r._id, r.count]));
  res.json({
    success: true,
    data: {
      total: rows.reduce((n, r) => n + r.count, 0),
      pending: by.pending || 0,
      accepted: by.accepted || 0,
      rejected: by.rejected || 0,
      cancelled: by.cancelled || 0,
    },
  });
}));

customerBookings.get("/:id", asyncHandler(async (req, res) => {
  const [booking] = await bookings()
    .aggregate([{ $match: { _id: requireId(req.params.id, "booking ID"), customerId: req.user._id } }, ...joinStages])
    .toArray();
  if (!booking) throw new HttpError(404, "Booking not found");
  res.json({ success: true, data: booking });
}));

customerBookings.patch("/:id/cancel", asyncHandler(async (req, res) => {
  const result = await bookings().updateOne(
    { _id: requireId(req.params.id, "booking ID"), customerId: req.user._id, status: "pending" },
    { $set: { status: "cancelled" } },
  );
  if (!result.matchedCount) {
    const exists = await bookings().findOne({ _id: requireId(req.params.id, "booking ID"), customerId: req.user._id });
    if (!exists) throw new HttpError(404, "Booking not found");
    throw new HttpError(409, `A ${exists.status} booking cannot be cancelled`);
  }
  res.json({ success: true, message: "Booking cancelled" });
}));

export const vendorBookings = Router();
vendorBookings.use(authenticate, requireRole("vendor"));

vendorBookings.get("/", asyncHandler(async (req, res) => {
  const list = await bookings()
    .aggregate([{ $match: { vendorId: req.user._id } }, { $sort: { createdAt: -1 } }, ...joinStages])
    .toArray();
  res.json({ success: true, data: list });
}));

vendorBookings.patch("/:id", asyncHandler(async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(["accepted", "rejected"]) }), req.body);
  const id = requireId(req.params.id, "booking ID");
  const result = await bookings().updateOne({ _id: id, vendorId: req.user._id, status: "pending" }, { $set: { status } });
  if (!result.matchedCount) {
    const exists = await bookings().findOne({ _id: id, vendorId: req.user._id });
    if (!exists) throw new HttpError(404, "Booking not found");
    throw new HttpError(409, `This request is already ${exists.status}`);
  }
  res.json({ success: true, message: `Booking ${status}` });
}));

export const vendorOverview = Router();
vendorOverview.get("/", authenticate, requireRole("vendor"), asyncHandler(async (req, res) => {
  const vendorId = req.user._id;
  const [totalServices, activeServices, pending, accepted] = await Promise.all([
    services().countDocuments({ vendorId }),
    services().countDocuments({ vendorId, status: "approved", isActive: true }),
    bookings().countDocuments({ vendorId, status: "pending" }),
    bookings().countDocuments({ vendorId, status: "accepted" }),
  ]);
  res.json({
    success: true,
    data: {
      totalServices, activeServices, pendingBookings: pending, acceptedBookings: accepted,
      plan: isPremium(req.user) ? "premium" : "free",
    },
  });
}));
