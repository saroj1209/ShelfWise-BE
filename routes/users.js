const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { ObjectId } = require("mongodb");
const { getUserCollec } = require("../config/db");

const router = express.Router();
const SECRET = process.env.JWT_SECRET;

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

router.post("/signup", async (req, res) => {
  console.log("ROUTER SIGNUP HIT:", req.path, "BODY:", req.body); // added

  const userCollec = getUserCollec();
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) return res.status(400).send("Name, email, and password are required");

  try {
    const existing = await userCollec.findOne({ email });
    if (existing) return res.status(409).send("An account with that email already exists");

    const hashed = await bcrypt.hash(password, 10);
    const doc = {
      name,
      email,
      password: hashed,
      role: role === "librarian" ? "librarian" : "user",
    };

    const result = await userCollec.insertOne(doc);
    console.log("INSERT RESULT:", result); // added
    res.status(201).json({ insertedId: result.insertedId });
  } catch (err) {
    console.error("SIGNUP ERROR:", err); // augmented message
    res.status(500).send("Signup failed");
  }
});

router.post("/login", async (req, res) => {
  const userCollec = getUserCollec();
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).send("Email and password required");

  try {
    let user = await userCollec.findOne({ email });
    if (!user && email === "librarian@shelfwise.in" && password === "admin123") {
      const hashed = await bcrypt.hash("admin123", 10);
      const result = await userCollec.insertOne({
        name: "Librarian",
        email: "librarian@shelfwise.in",
        password: hashed,
        role: "librarian",
      });
      user = await userCollec.findOne({ _id: result.insertedId });
    }

    if (!user) return res.status(404).send("User not found");

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(400).send("Password incorrect");

    const token = jwt.sign({ id: user._id, role: user.role }, SECRET, { expiresIn: "1h" });
    res.cookie("token", token, { httpOnly: true, maxAge: 60 * 60 * 1000 });
    res.json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    console.error(err);
    res.status(500).send("Login failed");
  }
});

router.post("/logout", (req, res) => {
  res.clearCookie("token");
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

module.exports = router;