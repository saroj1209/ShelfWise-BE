const test = require('node:test');
const assert = require('node:assert/strict');
const { transformGoogleBooks } = require('../utils/bookApi');

test('transformGoogleBooks converts Google API volumes into library book cards', () => {
  const payload = {
    items: [
      {
        id: 'vol-1',
        volumeInfo: {
          title: 'The Hobbit',
          authors: ['J.R.R. Tolkien'],
          description: 'A classic fantasy adventure.',
          categories: ['Fiction', 'Fantasy'],
          industryIdentifiers: [
            { type: 'ISBN_13', identifier: '9780007520429' },
            { type: 'ISBN_10', identifier: '0007520428' }
          ]
        }
      }
    ]
  };

  const result = transformGoogleBooks(payload);

  assert.equal(result.length, 1);
  assert.equal(result[0].title, 'The Hobbit');
  assert.equal(result[0].author, 'J.R.R. Tolkien');
  assert.equal(result[0].genre, 'Fantasy');
  assert.equal(result[0].isbn, '9780007520429');
  assert.equal(result[0].available, result[0].total);
});
