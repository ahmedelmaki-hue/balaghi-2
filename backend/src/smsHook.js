// Supabase Auth's "Send SMS" hook. Supabase still makes and checks each
// sign-in code; instead of texting it itself it posts it here, and this sends
// it through Resala. Requests are signed (Standard Webhooks) with the secret
// shown when the hook is created in Supabase.
const crypto = require('node:crypto');
const express = require('express');
const { ResalaError, resalaPhone } = require('./resala');

// Signatures older or newer than this are refused, so a captured request
// cannot be replayed later.
const TOLERANCE_SECONDS = 5 * 60;

// Supabase shows the secret as "v1,whsec_<base64>".
function secretKey(secret) {
  return Buffer.from(String(secret).replace(/^v1,/, '').replace(/^whsec_/, ''), 'base64');
}

function signatureValid(secret, headers, rawBody, now = Date.now()) {
  const id = headers['webhook-id'];
  const timestamp = headers['webhook-timestamp'];
  const signatures = headers['webhook-signature'];
  if (!id || !timestamp || !signatures || !rawBody) return false;
  const seconds = Number(timestamp);
  if (!Number.isInteger(seconds) || Math.abs(now / 1000 - seconds) > TOLERANCE_SECONDS) return false;
  const expected = crypto.createHmac('sha256', secretKey(secret))
    .update(`${id}.${timestamp}.${rawBody.toString('utf8')}`).digest();
  return String(signatures).split(' ').some((entry) => {
    const [version, value] = entry.split(',');
    if (version !== 'v1' || !value) return false;
    const given = Buffer.from(value, 'base64');
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  });
}

// The shape Supabase expects when a hook fails.
const hookError = (res, status, message) => res.status(status).json({ error: { http_code: status, message } });

// "2189****5678": enough to find a send in the logs without printing the number.
const maskedPhone = (phone) => `${phone.slice(0, 4)}****${phone.slice(-4)}`;

function createSmsHookRouter({ secret, resala, templateId }) {
  const router = express.Router();
  router.post('/', async (req, res) => {
    if (!signatureValid(secret, req.headers, req.rawBody)) return hookError(res, 401, 'invalid signature');
    const phone = resalaPhone(req.body?.user?.phone);
    const otp = req.body?.sms?.otp;
    if (!phone) return hookError(res, 400, 'only Libyan mobile numbers can receive codes');
    if (typeof otp !== 'string' || !/^\d{4,10}$/.test(otp)) return hookError(res, 400, 'invalid code');
    try {
      const result = await resala.sendTemplate({ templateId, records: [{ phone, $1: otp }] });
      if (!result?.succeeded) {
        console.warn(`Sign-in code to ${maskedPhone(phone)} not sent: Resala listed it as failed or invalid`);
        return hookError(res, 502, 'the code could not be sent');
      }
      console.log(`Sign-in code sent to ${maskedPhone(phone)}${result.is_prod === false ? ' (Resala sandbox, not delivered)' : ''}`);
      return res.json({});
    } catch (error) {
      // Never retried: the message may already have gone out.
      // Resala's own message says which part it refused (template, sender, number...).
      const reason = error instanceof ResalaError
        ? `${error.status} ${error.type}: ${error.message}${error.errors ? ` ${JSON.stringify(error.errors)}` : ''}`
        : error.message;
      console.warn(`Sign-in code to ${maskedPhone(phone)} not sent: ${reason}`);
      if (error instanceof ResalaError && ['InsufficientCredit', 'AccountExpired'].includes(error.type)) {
        console.error('Resala account cannot send: top up the balance or renew the account.');
      }
      return hookError(res, 502, 'the code could not be sent');
    }
  });
  return router;
}

module.exports = { createSmsHookRouter, signatureValid };
