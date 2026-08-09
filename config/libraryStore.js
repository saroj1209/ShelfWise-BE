const { getBorrowHistoryCollec } = require("./db");

const state = {
  books: [],
  holds: [],
  borrowers: [],
};

function getState() {
  return {
    books: state.books,
    holds: state.holds,
    borrowers: state.borrowers,
  };
}

function setBooks(books) {
  state.books = books;
}

function addHold(hold) {
  if (state.holds.some((item) => item.id === hold.id)) return;
  state.holds.push(hold);
  if (hold.reserved) {
    state.books = state.books.map((book) =>
      book.id === hold.bookId && book.available > 0
        ? { ...book, available: book.available - 1 }
        : book
    );
  }
}

function removeHold(holdId) {
  const index = state.holds.findIndex((hold) => hold.id === holdId);
  if (index === -1) return null;
  const [hold] = state.holds.splice(index, 1);
  return hold;
}

function restoreHoldCopy(hold) {
  if (!hold?.reserved) return;
  state.books = state.books.map((book) =>
    book.id === hold.bookId
      ? { ...book, available: Math.min(book.total, book.available + 1) }
      : book
  );
}

async function approveHold(holdId) {
  const hold = removeHold(holdId);
  if (!hold) return null;


  const borrowed = new Date();
  const due = new Date(borrowed);
  due.setDate(due.getDate() + 14);
  const record = {
    id: `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    bookId: hold.bookId,
    title: hold.bookTitle,
    borrowed: borrowed.toISOString().slice(0, 10),
    due: due.toISOString().slice(0, 10),
    returned: null,
  };

  const borrower = state.borrowers.find((item) => item.id === hold.userId);
  if (borrower) {
    borrower.records = [record, ...borrower.records];
  } else {
    state.borrowers.push({
      id: hold.userId,
      name: hold.userName,
      email: hold.userEmail,
      records: [record],
    });
  }
   try {
    await getBorrowHistoryCollec().insertOne({
      recordId: record.id,
      userId: hold.userId,
      userName: hold.userName,
      userEmail: hold.userEmail,
      bookId: hold.bookId,
      bookTitle: hold.bookTitle,
      borrowedAt: borrowed,
      dueDate: due,
      returnedAt: null,
      status: "borrowed",
    });
  } catch (err) {
    console.error("Failed to persist borrow record:", err);
  }
  return record;
}

async function returnRecord(recordId, bookId) {
  let returned = false;
  state.borrowers = state.borrowers.map((borrower) => ({
    ...borrower,
    records: borrower.records.map((record) => {
      if (record.id !== recordId || record.returned) return record;
      returned = true;
      return { ...record, returned: new Date().toISOString().slice(0, 10) };
    }),
  }));

  if (returned && bookId != null) {
    state.books = state.books.map((book) =>
      book.id === bookId
        ? { ...book, available: Math.min(book.total, book.available + 1) }
        : book
    );
  }

  // NEW — persist the return
  if (returned) {
    try {
      await getBorrowHistoryCollec().updateOne(
        { recordId },
        { $set: { returnedAt: new Date(), status: "returned" } }
      );
    } catch (err) {
      console.error("Failed to persist return:", err);
    }
  }

  return returned;
}

async function getUserHistory(userId) {
  return getBorrowHistoryCollec()
    .find({ userId })
    .sort({ borrowedAt: -1 })
    .toArray();
}

// NEW — everyone's history, for admin
async function getAllHistory() {
  return getBorrowHistoryCollec()
    .find({})
    .sort({ borrowedAt: -1 })
    .toArray();
}


function updateBookAvailability(bookId, delta) {
  state.books = state.books.map((book) =>
    book.id === bookId
      ? { ...book, available: Math.max(0, Math.min(book.total, book.available + delta)) }
      : book
  );
}

function removeBook(bookId) {
  state.books = state.books.filter((book) => book.id !== bookId);
}

function addBook(book) {
  state.books.push(book);
}

module.exports = {
  getState,
  setBooks,
  addHold,
  removeHold,
  restoreHoldCopy,
  approveHold,
  returnRecord,
  updateBookAvailability,
  removeBook,
  addBook,
  getUserHistory,   // NEW
  getAllHistory,
};
