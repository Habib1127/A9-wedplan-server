import { MongoClient } from "mongodb";
import { env } from "./env.js";

let db;
let pending;

export function connectDb() {
  if (db) return Promise.resolve(db);
  if (pending) return pending;
  pending = (async () => {
    const client = new MongoClient(env.mongoUri);
    await client.connect();
    db = client.db(env.dbName);
    await Promise.all([
      db.collection("transactions").createIndex({ stripeSessionId: 1 }, { unique: true }),
      db.collection("services").createIndex({ vendorId: 1 }),
      db.collection("services").createIndex({ status: 1, isActive: 1 }),
      db.collection("bookings").createIndex({ customerId: 1 }),
      db.collection("bookings").createIndex({ vendorId: 1 }),
    ]);
    return db;
  })().catch((err) => {
    pending = null;
    throw err;
  });
  return pending;
}

export const users = () => db.collection("users");
export const services = () => db.collection("services");
export const bookings = () => db.collection("bookings");
export const transactions = () => db.collection("transactions");
