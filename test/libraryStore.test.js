const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("../config/db");

test("returnRecord returns a persisted loan without in-memory borrower state", async () => {
  const loan = {
    recordId: "record-1",
    bookId: "book-1",
    status: "borrowed",
    returnedAt: null,
  };
  db.getBorrowHistoryCollec = () => ({
    findOne: async (filter) =>
      filter.recordId === loan.recordId &&
      loan.status === filter.status &&
      loan.returnedAt === filter.returnedAt
        ? { ...loan }
        : null,
    updateOne: async (filter, update) => {
      if (
        filter.recordId !== loan.recordId ||
        loan.status !== filter.status ||
        loan.returnedAt !== filter.returnedAt
      ) {
        return { matchedCount: 0 };
      }
      Object.assign(loan, update.$set);
      return { matchedCount: 1 };
    },
  });

  delete require.cache[require.resolve("../config/libraryStore")];
  const libraryStore = require("../config/libraryStore");
  libraryStore.setBooks([{ id: "book-1", total: 3, available: 2 }]);

  assert.equal(await libraryStore.returnRecord("record-1"), true);
  assert.equal(loan.status, "returned");
  assert.ok(loan.returnedAt instanceof Date);
  assert.equal(libraryStore.getState().books[0].available, 3);
  assert.equal(libraryStore.getState().borrowers.length, 0);
  assert.equal(await libraryStore.returnRecord("record-1"), false);
});
