import { ObjectId } from "mongodb";

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function toId(value) {
  if (value instanceof ObjectId) return value;
  if (typeof value === "string" && ObjectId.isValid(value) && String(new ObjectId(value)) === value) {
    return new ObjectId(value);
  }
  return null;
}

export function requireId(value, label = "ID") {
  const id = toId(value);
  if (!id) throw new HttpError(400, `Invalid ${label}`);
  return id;
}

export function isPremium(user) {
  if (!user || user.subscriptionPlan !== "premium") return false;
  if (!user.subscriptionExpiresAt) return true;
  return new Date(user.subscriptionExpiresAt).getTime() > Date.now();
}

export function parse(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ field: i.path.join("."), message: i.message }));
    throw new HttpError(400, details[0]?.message || "Invalid request data", details);
  }
  return result.data;
}

export const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function publicUser(user) {
  if (!user) return null;
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    image: user.image || null,
    role: user.role,
    isBlocked: !!user.isBlocked,
    businessName: user.businessName || "",
    phone: user.phone || "",
    bio: user.bio || "",
    subscriptionPlan: isPremium(user) ? "premium" : "free",
    subscriptionExpiresAt: user.subscriptionExpiresAt || null,
    createdAt: user.createdAt,
  };
}

export const CATEGORIES = [
  "Photography & Videography",
  "Wedding Venues",
  "Decoration & Florist",
  "Catering Services",
  "Makeup & Styling",
  "Wedding Fashion",
];

export const FREE_SERVICE_LIMIT = 3;
