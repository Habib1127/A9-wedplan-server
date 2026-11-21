import { connectDb, users } from "../config/db.js";

const email = process.argv[2]?.toLowerCase();
if (!email) {
  console.error("Usage: npm run make-admin -- admin@example.com");
  process.exit(1);
}

await connectDb();
const result = await users().updateOne({ email }, { $set: { role: "admin", isBlocked: false } });
console.log(result.matchedCount ? `${email} is now an admin` : `No user found with email ${email}. Sign up first, then run this again.`);
process.exit(0);
