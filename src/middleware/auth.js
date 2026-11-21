import { createRemoteJWKSet, jwtVerify } from "jose";
import { env } from "../config/env.js";
import { users } from "../config/db.js";
import { HttpError, asyncHandler, toId } from "../utils/helpers.js";

let jwks;
const getJwks = () => {
  if (!jwks) jwks = createRemoteJWKSet(new URL(`${env.clientUrl}/api/auth/jwks`));
  return jwks;
};

export const authenticate = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) throw new HttpError(401, "Authentication required");
  const token = header.slice(7);
  let payload;
  try {
    ({ payload } = await jwtVerify(token, getJwks(), { issuer: env.clientUrl, audience: env.clientUrl }));
  } catch {
    throw new HttpError(401, "Invalid or expired token");
  }
  const id = toId(payload.sub || payload.id);
  if (!id) throw new HttpError(401, "Invalid token");
  const user = await users().findOne({ _id: id });
  if (!user) throw new HttpError(401, "Account not found");
  if (user.isBlocked) throw new HttpError(403, "Your account has been blocked");
  req.user = user;
  next();
});

export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return next(new HttpError(403, "You do not have permission to perform this action"));
  }
  next();
};
