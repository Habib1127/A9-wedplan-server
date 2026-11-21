import { Router } from "express";
import { z } from "zod";
import { users } from "../config/db.js";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler, parse, publicUser } from "../utils/helpers.js";

const router = Router();
router.use(authenticate);

const profileSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(80),
  image: z.string().url("Image must be a valid URL").optional().or(z.literal("")),
  phone: z.string().trim().max(30).optional(),
  bio: z.string().trim().max(500).optional(),
  businessName: z.string().trim().max(120).optional(),
});

router.get("/", (req, res) => res.json({ success: true, data: publicUser(req.user) }));

router.patch("/", asyncHandler(async (req, res) => {
  const data = parse(profileSchema, req.body);
  const update = { name: data.name, updatedAt: new Date() };
  if (data.image !== undefined) update.image = data.image || null;
  if (data.phone !== undefined) update.phone = data.phone;
  if (data.bio !== undefined) update.bio = data.bio;
  if (data.businessName !== undefined && req.user.role === "vendor") update.businessName = data.businessName;
  await users().updateOne({ _id: req.user._id }, { $set: update });
  const fresh = await users().findOne({ _id: req.user._id });
  res.json({ success: true, message: "Profile updated", data: publicUser(fresh) });
}));

export default router;
