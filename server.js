require("dotenv").config(); // MUST be the very first line — everything below reads process.env

//console.log(process.env.MONGO_URI);
let express = require("express");
let cors = require("cors");
let cookieParser = require("cookie-parser");
let bcrypt = require("bcryptjs");
let jwt = require("jsonwebtoken");

let { ObjectId } = require("mongodb");
let { connectDB, getUserCollec, getBorrowHistoryCollec } = require("./config/db");
let { transformGoogleBooks } = require("./utils/bookApi");
let libraryStore = require("./config/libraryStore");
const http = require("http");
const { initSocket, broadcastState, broadcastHistoryUpdate } = require("./config/socket");

let SECRET = process.env.JWT_SECRET; // was missing entirely before — this line fixes bug #1

let app = express();
app.use(express.json());
app.use(cookieParser());
const allowedOrigins = [
  "https://shelfwise-f1144.web.app",
  "https://shelfwise-f1144.firebaseapp.com", // Firebase's second default domain
  "http://localhost:5173",                    // local dev, adjust to your ports
  "http://localhost:5174",
  "https://shelfwise-f1144.web.app"
  // add your deployed admin app URL here too
];

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

function auth(req, res, next) {
  let token = req.cookies.token;
  const authorization = req.headers.authorization || "";
  if (authorization.startsWith("Bearer ")) token = authorization.slice(7);

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

    res.json({ token, user: { id: obj._id, name: obj.name, email: obj.email, role: obj.role } });
  } catch (err) {
    console.error(err);
    res.status(500).send("Something went wrong during login");
  }
});

app.post("/logout", (req, res) => {
  res.clearCookie("token");
  res.send("Logged out");
});

app.get("/library/state", async (req, res) => {
  try {
    if (libraryStore.getState().books.length === 0) {
      await loadBooksIntoStore("library");
    }
    res.json(libraryStore.getState());
  } catch (err) {
    console.error("LIBRARY STATE ERROR:", err);
    res.status(502).json({ error: "Unable to load the shared library state." });
  }
});

app.post("/library/holds", auth, (req, res) => {
  const hold = req.body;
  if (!hold?.id || !hold.bookId || !hold.userId) {
    return res.status(400).json({ error: "Invalid borrow request." });
  }
  const state = libraryStore.getState();
  const book = state.books.find((item) => item.id === hold.bookId);
  if (!book) return res.status(404).json({ error: "Book not found." });
  if (state.holds.some((item) => item.bookId === hold.bookId && item.userId === hold.userId)) {
    return res.status(409).json({ error: "You already have a request for this book." });
  }
  libraryStore.addHold({ ...hold, reserved: book.available > 0 });
  broadcastState(libraryStore.getState());
  res.json(libraryStore.getState());
});

app.delete("/library/holds/:id", auth, (req, res) => {
  const hold = libraryStore.removeHold(req.params.id);
  if (!hold) return res.status(404).json({ error: "Request not found." });
  libraryStore.restoreHoldCopy(hold);
  broadcastState(libraryStore.getState());
  res.json(libraryStore.getState());
});

app.post("/library/holds/:id/approve", auth, async (req, res) => {
  const record = await libraryStore.approveHold(req.params.id);
  if (!record) return res.status(404).json({ error: "Request not found." });
  broadcastState(libraryStore.getState());
  res.json(libraryStore.getState());
});

app.post("/library/holds/:id/reject", auth, (req, res) => {
  const hold = libraryStore.removeHold(req.params.id);
  if (!hold) return res.status(404).json({ error: "Request not found." });
  libraryStore.restoreHoldCopy(hold);
  broadcastState(libraryStore.getState());
  res.json(libraryStore.getState());
});

app.post("/library/records/:id/return", auth, async (req, res) => {
  try {
    const returned = await libraryStore.returnRecord(req.params.id);
    if (!returned) return res.status(404).json({ error: "Loan not found or already returned." });
    broadcastState(libraryStore.getState());
    broadcastHistoryUpdate();
    res.json(libraryStore.getState());
  } catch (err) {
    console.error("RETURN RECORD ERROR:", err);
    res.status(500).json({ error: "Unable to return loan." });
  }
});



app.patch("/library/books/:id/availability", auth, (req, res) => {
  libraryStore.updateBookAvailability(req.params.id, Number(req.body.delta) || 0);
  broadcastState(libraryStore.getState());
  res.json(libraryStore.getState());
});

app.delete("/library/books/:id", auth, (req, res) => {
  libraryStore.removeBook(req.params.id);
  broadcastState(libraryStore.getState());
  res.json(libraryStore.getState());
});

app.post("/library/books", auth, (req, res) => {
  const book = req.body;
  if (!book?.id || !book.title || !book.author) {
    return res.status(400).json({ error: "Title and author are required." });
  }
  libraryStore.addBook(book);
  broadcastState(libraryStore.getState());
  res.json(libraryStore.getState());
});

async function loadBooksIntoStore(query) {
  const fallbackBooks = [
    { id: "fb-1", title: "The Great Gatsby", author: "F. Scott Fitzgerald", genre: "Fiction", total: 3, available: 3, isbn: "9780743273565" },
    { id: "fb-2", title: "1984", author: "George Orwell", genre: "Fiction", total: 5, available: 5, isbn: "9780451524935" },
    { id: "fb-3", title: "To Kill a Mockingbird", author: "Harper Lee", genre: "Fiction", total: 2, available: 2, isbn: "9780060935467" },
    { id: "fb-4", title: "The Hobbit", author: "J.R.R. Tolkien", genre: "Fantasy", total: 4, available: 4, isbn: "9780547928227" }
  ];

  let booksToLoad = [];

  try {
    const apiKey = process.env.GOOGLE_BOOKS_API_KEY;
    if (!apiKey) throw new Error("Google Books API key is not configured.");
    
    const response = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=12&key=${apiKey}`);
    if (!response.ok) throw new Error("Google Books request failed with status: " + response.status);
    
    const books = transformGoogleBooks(await response.json());
    if (!books || books.length === 0) throw new Error("No books found");
    
    booksToLoad = books;
  } catch (err) {
    console.warn("Falling back to local books due to error:", err.message);
    booksToLoad = JSON.parse(JSON.stringify(fallbackBooks));
  }

  try {
    const activeLoans = await getBorrowHistoryCollec().find({ status: "borrowed", returnedAt: null }).toArray();
    const loanCounts = {};
    activeLoans.forEach(loan => {
      loanCounts[loan.bookId] = (loanCounts[loan.bookId] || 0) + 1;
    });

    booksToLoad.forEach(book => {
      if (loanCounts[book.id]) {
        book.available = Math.max(0, book.total - loanCounts[book.id]);
      }
    });
  } catch (err) {
    console.error("Failed to sync book availability with DB:", err);
  }

  libraryStore.setBooks(booksToLoad);
  return booksToLoad;
}

app.get("/books", async (req, res) => {
  try {
    const query = (req.query.q || "fiction").trim();
    const books = libraryStore.getState().books.length > 0
      ? libraryStore.getState().books
      : await loadBooksIntoStore(query);
    res.json(books);
  } catch (err) {
    console.error("BOOKS API ERROR:", err);
    res.status(502).json({ error: "Unable to load books from Google Books right now." });
  }
});

app.get("/library/history", auth, async (req, res) => {
  try {
    const history = await libraryStore.getUserHistory(req.user.id);
    res.json(history);
  } catch (err) {
    console.error("USER HISTORY ERROR:", err);
    res.status(500).json({ error: "Unable to load borrow history." });
  }
});

// NEW — admin/librarian: everyone's borrow history
app.get("/library/history/all", auth, async (req, res) => {
  if (req.user.role !== "librarian") {
    return res.status(403).json({ error: "Librarian access required." });
  }
  try {
    const history = await libraryStore.getAllHistory();
    res.json(history);
  } catch (err) {
    console.error("ADMIN HISTORY ERROR:", err);
    res.status(500).json({ error: "Unable to load borrow history." });
  }
});

let PORT = Number(process.env.PORT) || 3000;

const usersRouter = require("./routes/users");
app.use("/users", usersRouter);

function startServer(port) {
  const server = http.createServer(app);
  initSocket(server);

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.warn(`Port ${port} is already in use. Retrying on ${port + 1}...`);
      startServer(port + 1);
      return;
    }

    console.error("Server failed to start:", error);
    process.exit(1);
  });

  server.listen(port, () => {
    process.env.PORT = String(port);
    console.log(`Server running on ${port}`);
  });
}

// bug #8 fix — we wait for MongoDB to actually finish connecting BEFORE
// we start accepting requests. If a request came in before the connection
// resolved, getUserCollec() would still return undefined.
connectDB().then(async () => {
  await ensureDefaultAdmin();
  startServer(PORT);
});