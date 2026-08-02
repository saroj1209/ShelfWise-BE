function transformGoogleBooks(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];

  return items.map((item, index) => {
    const info = item?.volumeInfo || {};
    const isbn13 = (info.industryIdentifiers || []).find((x) => x?.type === 'ISBN_13')?.identifier;
    const isbn10 = (info.industryIdentifiers || []).find((x) => x?.type === 'ISBN_10')?.identifier;
    const categories = Array.isArray(info.categories) ? info.categories.filter(Boolean) : [];
    const preferredCategory = categories.find((category) => {
      const normalized = category.toLowerCase();
      return normalized !== 'fiction' && normalized !== 'nonfiction';
    });
    const genre = preferredCategory || categories[0] || 'Fiction';

    return {
      id: item?.id || `google-${index + 1}`,
      title: info.title || 'Untitled',
      author: Array.isArray(info.authors) && info.authors.length > 0 ? info.authors[0] : 'Unknown author',
      genre,
      isbn: isbn13 || isbn10 || 'N/A',
      description: info.description || 'No description available.',
      total: 3,
      available: 3,
    };
  });
}

module.exports = { transformGoogleBooks };
