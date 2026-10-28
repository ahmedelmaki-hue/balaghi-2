const { HttpError } = require('./http');

function optionalChoice(value, choices, label) {
  if (value === undefined) return null;
  if (typeof value !== 'string' || !choices.includes(value)) {
    throw new HttpError(400, `invalid ${label}`);
  }
  return value;
}

function positiveInteger(value, defaultValue, maximum, label) {
  if (value === undefined) return defaultValue;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new HttpError(400, `invalid ${label}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw new HttpError(400, `invalid ${label}`);
  }
  return parsed;
}

function pagination(query) {
  const page = positiveInteger(query.page, 1, 1_000_000, 'page');
  const limit = positiveInteger(query.limit, 25, 100, 'limit');
  return { page, limit, offset: (page - 1) * limit };
}

module.exports = { optionalChoice, positiveInteger, pagination };
