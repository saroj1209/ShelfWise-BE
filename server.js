require("dotenv").config(); // MUST be the very first line — everything below reads process.env

//console.log(process.env.MONGO_URI);
let express = require("express");
let cors = require("cors");
let cookieParser = require("cookie-parser");
let bcrypt = require("bcryptjs");
let jwt = require("jsonwebtoken");

let { ObjectId } = require("mongodb");
let { connectDB, getUserCollec } = require("./config/db");
let { transformGoogleBooks } = require("./utils/bookApi");

let SECRET = process.env.JWT_SECRET; // was missing entirely before — this line fixes bug #1

let app = express();
app.use(express.json());
app.use(cookieParser());
app.use(cors({ origin: "http://localhost:5173", credentials: true }));

function auth(req, res, next) {
  let token = req.cookies.token;

  if (!token) {
    return res.status(401).send("Not logged in");
  }

  jwt.verify(token, SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send("Invalid token");
    }
    req.user = decoded;
    next();
  });
}

async function ensureDefaultAdmin() {
  try {
    const userCollec = getUserCollec();
    const existing = await userCollec.findOne({ email: "librarian@shelfwise.in" });
    if (existing) return existing;

    const hashedPassword = await bcrypt.hash("admin123", 10);
    const result = await userCollec.insertOne({
      name: "Librarian",
      email: "librarian@shelfwise.in",
      password: hashedPassword,
      role: "librarian",
    });

    console.log("Created default librarian account", result.insertedId);
    return result;
  } catch (err) {
    console.error("Failed to create default librarian account", err);
    return null;
  }
}

app.post("/signup", async (req, res) => {
  let userCollec = getUserCollec();
  let { name, email, password, role } = req.body;
  console.log("SIGNUP BODY:", req.body, "PATH:", req.path);

  if (!name || !email || !password) {
    return res.status(400).send("Name, email, and password are all required");
  }

  try {
    const existing = await userCollec.findOne({ email });
    if (existing) {
      return res.status(409).send("An account with that email already exists");
    }

    let hashedPassword = await bcrypt.hash(password, 10);

    const result = await userCollec.insertOne({
      name,
      email,
      password: hashedPassword,
      role: role === "librarian" ? "librarian" : "user",
    });

    console.log("INSERT RESULT:", result);
    res.status(201).json({ insertedId: result.insertedId });
  } catch (err) {
    console.error("SIGNUP ERROR:", err);
    res.status(500).send("Something went wrong during signup");
  }
});

app.post("/login", async (req, res) => {
  let userCollec = getUserCollec();
  let { email, password } = req.body;

  try {
    let obj = await userCollec.findOne({ email });
    if (!obj && email === "librarian@shelfwise.in" && password === "admin123") {
      await ensureDefaultAdmin();
      obj = await userCollec.findOne({ email });
    }

    if (!obj) {
      return res.status(404).send("User not found");
    }

    let ok = await bcrypt.compare(password, obj.password);
    if (!ok) {
      return res.status(400).send("Password Incorrect");
    }

    let token = jwt.sign({ id: obj._id, role: obj.role }, SECRET, { expiresIn: "1h" });
    res.cookie("token", token, { httpOnly: true, maxAge: 60 * 60 * 1000 });

    res.send("Login Successful");
  } catch (err) {
    console.error(err);
    res.status(500).send("Something went wrong during login");
  }
});

app.post("/logout", (req, res) => {
  res.clearCookie("token");
  res.send("Logged out");
});

app.get("/books", async (req, res) => {
  const query = (req.query.q || "fiction").trim();
  const apiKey = process.env.GOOGLE_BOOKS_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: "Google Books API key is not configured." });
  }

  try {
    const response = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=12&key=${apiKey}`);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || "Failed to fetch books");
    }

    const payload = await response.json();
    const books = transformGoogleBooks(payload);
    res.json(books);
  } catch (err) {
    console.error("BOOKS API ERROR:", err);
    res.status(502).json({ error: "Unable to load books from Google Books right now." });
  }
});

let PORT = process.env.PORT || 3000;

const usersRouter = require("./routes/users");
app.use("/users", usersRouter);

// bug #8 fix — we wait for MongoDB to actually finish connecting BEFORE
// we start accepting requests. If a request came in before the connection
// resolved, getUserCollec() would still return undefined.
connectDB().then(async () => {
  await ensureDefaultAdmin();
  app.listen(PORT, () => console.log(`Server running on ${PORT}`));
});