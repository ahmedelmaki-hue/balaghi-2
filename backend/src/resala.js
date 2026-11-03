// Client for the Resala SMS API (https://resala.ly), used to text citizens their
// sign-in codes. Resala sends free text only through templates it has approved,
// so the code goes in as the template's $1.
const DEFAULT_BASE_URL = 'https://dev.resala.ly/api/v1';

// Resala's error types, as sent in the response's "type" field. Branch on these,
// never on the localized "message".
const RESALA_ERRORS = [
  'AccountExpired', 'InsufficientCredit', 'BadRequest', 'Unauthorized',
  'TokenExpired', 'Forbidden', 'NotFound', 'InputValidation',
];

class ResalaError extends Error {
  constructor(status, type, message, errors = null) {
    super(message || type || `Resala returned ${status}`);
    this.name = 'ResalaError';
    this.status = status;
    // One of RESALA_ERRORS, or "Unknown" for an unexpected answer.
    this.type = RESALA_ERRORS.includes(type) ? type : 'Unknown';
    // Per-field messages for InputValidation.
    this.errors = errors;
  }
}

// Resala accepts 2189XXXXXXXX or 09XXXXXXXX; Supabase gives +2189XXXXXXXX or 2189XXXXXXXX.
function resalaPhone(phone) {
  const digits = String(phone || '').replace(/^\+/, '');
  return /^2189[1-4]\d{7}$/.test(digits) ? digits : null;
}

function createResalaClient({
  apiKey, baseUrl = DEFAULT_BASE_URL, sender, test = false,
  fetchImpl = globalThis.fetch, timeoutMs = 4000,
}) {
  if (!apiKey || !apiKey.startsWith('rsl_')) throw new Error('RESALA_API_KEY must be a Resala key starting with rsl_');

  // One request, never retried: a failed send may already have gone out.
  // Sends carry the sender name and, in the sandbox, test=true; reads carry neither.
  async function call(method, path, { query = {}, body, send = false } = {}) {
    const url = new URL(`${baseUrl.replace(/\/$/, '')}${path}`);
    const params = { ...query, ...(send && sender ? { sender } : {}), ...(send && test ? { test: 'true' } : {}) };
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    const response = await fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    let payload = null;
    try { payload = await response.json(); } catch { payload = null; }
    if (!response.ok) {
      throw new ResalaError(response.status, payload?.type, payload?.message, payload?.errors || null);
    }
    return payload;
  }

  return {
    /**
     * Sends an approved template to one or more phones.
     * @param {{ templateId: string, records: Array<{ phone: string, [variable: string]: string }> }} input
     * @returns {Promise<{ succeeded: number, failed: number, invalid_numbers: string[],
     *   failed_numbers: string[], total_cost: number, is_prod: boolean,
     *   sender_names: Record<string, string> }>}
     */
    sendTemplate({ templateId, records }) {
      if (!templateId) throw new Error('RESALA_TEMPLATE_ID is required');
      return call('POST', '/messages/send-template', {
        query: { sms_template_id: templateId }, body: { records }, send: true,
      });
    },

    /**
     * Resala generates and texts its own code. Not used for sign-in, where
     * Supabase owns the code; kept for completeness of the documented API.
     * @param {{ phone: string, serviceName?: string, length?: 4 | 5 | 6 }} input
     * @returns {Promise<{ id: string, pin: string, content: string, sender_name: string }>}
     */
    sendPin({ phone, serviceName, length }) {
      return call('POST', '/pins', {
        query: { service_name: serviceName, len: length }, body: { phone }, send: true,
      });
    },

    /**
     * Messages sent from the account, newest first.
     * @param {{ q?: string, page?: number }} [input]
     * @returns {Promise<{ data: Array<{ id: string, number: string, status: string,
     *   env: string, created_at: string }>, meta: { total: number, current_page: number, last_page: number } }>}
     */
    sentMessages({ q, page } = {}) {
      return call('GET', '/sent-view', { query: { q, page } });
    },
  };
}

module.exports = { createResalaClient, ResalaError, RESALA_ERRORS, resalaPhone };
