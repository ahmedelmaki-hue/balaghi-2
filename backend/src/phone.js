const PHONE_RE = /^\+[1-9]\d{7,14}$/;

function validPhone(value) {
  return typeof value === 'string' && PHONE_RE.test(value);
}

function authPhone(value) {
  if (typeof value !== 'string') return null;
  const canonical = value.startsWith('+') ? value : `+${value}`;
  return validPhone(canonical) ? canonical : null;
}

module.exports = { validPhone, authPhone };
