function normalizeUsername(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;
  if (trimmed.length > 24) return null;
  if (!/^[A-Za-z0-9 _-]+$/.test(trimmed)) return null;
  return trimmed;
}

function normalizeGuess(raw) {
  if (typeof raw !== 'string') return '';
  return raw.trim().toUpperCase().replace(/[^A-Z]/g, '');
}

module.exports = { normalizeUsername, normalizeGuess };
