const { MongoClient } = require("mongodb");

let client;
let db;

async function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("MONGO_URI is not defined");

  client = new MongoClient(uri);
  await client.connect();
  const dbName = client.options.dbName && client.options.dbName !== "test"
    ? client.options.dbName
    : "shelfwise";
  db = client.db(dbName);
  console.log("MongoDB connected:", db.databaseName);
}

function getUserCollec() {
  if (!db) throw new Error("MongoDB is not connected");
  return db.collection("users");
}

function getBorrowHistoryCollec() {
  if (!db) throw new Error("MongoDB is not connected");
  return db.collection("borrowHistory");
}

module.exports = { connectDB, getUserCollec, getBorrowHistoryCollec };