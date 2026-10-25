const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { ObjectId } = require("mongodb");
const { getUserCollec } = require("../config/db");

const router = express.Router();
const SECRET = process.env.JWT_SECRET;

const isProd = process.env.NODE_ENV === "production";
const cookieOpts = {
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? "none" : "lax",
};

function auth(req, res, next) {
  const token = req.cookies && req.cookies.token;
  const authorization = req.headers.authorization || "";
  const bearerToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : null;
  const sessionToken = bearerToken || token;
  if (!sessionToken) return res.status(401).send("Not logged in");
  jwt.verify(sessionToken, SECRET, (err, decoded) => {
    if (err) return res.status(401).send("Invalid token");
    req.user = decoded;
    next();
  });
}

function requireLibrarian(req, res, next) {
  if (!req.user || req.user.role !== "librarian") {
    return res.status(403).json({ error: "Librarian access required." });
  }
  next();
}

router.post("/signup", async (req, res) => {
  const userCollec = getUserCollec();
  const { name, email, password } = req.body; // role is NOT accepted from the client
  if (!name || !email || !password) return res.status(400).send("Name, email, and password are required");

  try {
    const existing = await userCollec.findOne({ email });
    if (existing) return res.status(409).send("An account with that email already exists");

    const hashed = await bcrypt.hash(password, 10);
    const result = await userCollec.insertOne({
      name,
      email,
      password: hashed,
      role: "user", // public signup can never create a librarian
    });

    res.status(201).json({ insertedId: result.insertedId });
  } catch (err) {
    console.error("SIGNUP ERROR:", err);
    res.status(500).send("Signup failed");
  }
});

router.post("/login", async (req, res) => {
  const userCollec = getUserCollec();
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).send("Email and password required");

  try {
    const user = await userCollec.findOne({ email });
    if (!user) return res.status(404).send("User not found");

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(400).send("Password incorrect");

    const token = jwt.sign({ id: user._id, role: user.role }, SECRET, { expiresIn: "1h" });
    res.cookie("token", token, { ...cookieOpts, maxAge: 60 * 60 * 1000 });
    res.json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    console.error(err);
    res.status(500).send("Login failed");
  }
});

router.post("/logout", (req, res) => {
  res.clearCookie("token", cookieOpts);
  res.send("Logged out");
});

router.get("/me", auth, async (req, res) => {
  try {
    const userCollec = getUserCollec();
    const user = await userCollec.findOne({ _id: new ObjectId(req.user.id) }, { projection: { password: 0 } });
    if (!user) return res.status(404).send("User not found");
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to fetch user");
  }
});

// Librarian only: list all users (passwords excluded). Available at GET /users
router.get("/", auth, requireLibrarian, async (req, res) => {
  try {
    const userCollec = getUserCollec();
    const users = await userCollec.find({}, { projection: { password: 0 } }).toArray();
    res.json(users);
  } catch (err) {
    console.error("LIST USERS ERROR:", err);
    res.status(500).json({ error: "Unable to load users." });
  }
});

module.exports = router;