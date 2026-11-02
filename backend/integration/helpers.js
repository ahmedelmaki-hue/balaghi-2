// Shared setup for the integration tests: the real Express app against the real
// local PostgreSQL schema, with Supabase Auth and Storage replaced by fakes.
// Everything a test writes happens inside one transaction that is rolled back,
// so the local data is left as it was (report numbers may skip ahead, because
// PostgreSQL never rolls back an identity sequence).
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const sharp = require('sharp');
const { createApp } = require('../src/app');

const LOCAL_HOSTS = ['127.0.0.1', 'localhost'];
if (!process.env.DATABASE_URL || !LOCAL_HOSTS.includes(new URL(process.env.DATABASE_URL).hostname)) {
  throw new Error('Integration tests run only against local Supabase. Run configure:local first.');
}

// Routes open their own transactions with BEGIN/COMMIT/ROLLBACK. Inside the
// test's outer transaction those become savepoints, and every other statement
// gets one of its own, so an expected SQL error does not abort the test.
async function transactionalPool() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  await client.query('BEGIN');
  let depth = 0;
  let serial = 0;
  // Routes sometimes run queries together (Promise.all); one connection must
  // take them one at a time or their savepoints would interleave.
  let queue = Promise.resolve();
  const query = (text, params) => {
    const run = queue.then(() => runQuery(text, params));
    queue = run.catch(() => {});
    return run;
  };
  const runQuery = async (text, params) => {
    if (text === 'BEGIN') { depth += 1; return client.query(`SAVEPOINT route_${depth}`); }
    if (text === 'COMMIT') { depth -= 1; return client.query(`RELEASE SAVEPOINT route_${depth + 1}`); }
    if (text === 'ROLLBACK') { depth -= 1; return client.query(`ROLLBACK TO SAVEPOINT route_${depth + 1}`); }
    if (depth > 0) return client.query(text, params);
    const name = `statement_${serial += 1}`;
    await client.query(`SAVEPOINT ${name}`);
    try {
      const result = await client.query(text, params);
      await client.query(`RELEASE SAVEPOINT ${name}`);
      return result;
    } catch (error) {
      await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
      throw error;
    }
  };
  return {
    pool: { query, async connect() { return { query, release() {} }; } },
    query,
    async finish() {
      await client.query('ROLLBACK');
      client.release();
      await pool.end();
    },
  };
}

// Builds the world a test needs: auth users and profiles inside the rolled-back
// transaction, a token per person, and a running server.
async function startWorld() {
  const db = await transactionalPool();
  const tokens = new Map();
  const people = {};

  async function authUser({ email = null, phone = null } = {}) {
    const id = randomUUID();
    await db.query(
      `INSERT INTO auth.users (id, aud, role, email, phone) VALUES ($1, 'authenticated', 'authenticated', $2, $3)`,
      [id, email, phone]
    );
    return id;
  }

  async function addCitizen(key, fullName) {
    const phone = `+2189${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
    const id = await authUser({ phone: phone.slice(1) });
    await db.query(
      `INSERT INTO public.profiles (id, full_name, phone, role) VALUES ($1, $2, $3, 'citizen')`,
      [id, fullName, phone]
    );
    people[key] = { id, phone };
    tokens.set(`${key}-token`, { id, phone: phone.slice(1) });
  }

  async function addAccount(key, { role, agency = null, owner = false, permissions = [], fullName }) {
    const username = `it_${key.toLowerCase()}_${randomUUID().slice(0, 8)}`;
    const email = `${username}@balaghi.local`;
    const id = await authUser({ email });
    await db.query(
      `INSERT INTO public.profiles
       (id, full_name, staff_username, staff_auth_email, role, agency, is_owner, admin_permissions)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, fullName, username, email, role, agency, owner, permissions]
    );
    people[key] = { id, username, email };
    tokens.set(`${key}-token`, { id, email });
  }

  const authClientFactory = () => ({ auth: {
    async getUser(token) {
      const user = tokens.get(token);
      return { data: { user: user || null }, error: user ? null : new Error('invalid') };
    },
  } });
  const authAdmin = {
    async createUser({ email }) {
      return { data: { user: { id: await authUser({ email }) } }, error: null };
    },
    async updateUserById() { return { data: {}, error: null }; },
    async deleteUser() { return { error: null }; },
    async signOut() { return { error: null }; },
  };
  const uploads = [];
  const storage = {
    async upload(userId, buffer) {
      const path = `${userId}/${randomUUID()}.jpg`;
      uploads.push({ path, bytes: buffer.length });
      return path;
    },
    async remove() {},
    async withSignedImages(rows) {
      return rows.map(({ image_path: path, ...row }) => ({ ...row, image_url: `/api/images?target=${path}` }));
    },
  };

  const server = createApp({ pool: db.pool, authClientFactory, authAdmin, storage }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api`;

  async function call(token, path, { method = 'GET', body, form } = {}) {
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: form || (body ? JSON.stringify(body) : undefined),
    });
    return { status: response.status, body: await response.json() };
  }

  return {
    db, people, uploads, call, addCitizen, addAccount,
    async stop() {
      await new Promise((resolve) => server.close(resolve));
      await db.finish();
    },
  };
}

async function photo() {
  return sharp({ create: { width: 64, height: 48, channels: 3, background: '#7a6a55' } }).jpeg().toBuffer();
}

// A point inside the Tripoli Center service area.
const INSIDE = { latitude: '32.8812', longitude: '13.1910' };

async function reportForm({ category = 'pothole', description = 'حفرة للاختبار', requestId = randomUUID() } = {}) {
  const form = new FormData();
  form.set('category', category);
  form.set('description', description);
  form.set('latitude', INSIDE.latitude);
  form.set('longitude', INSIDE.longitude);
  form.set('client_request_id', requestId);
  form.set('image', new Blob([await photo()], { type: 'image/jpeg' }), 'report.jpg');
  return form;
}

async function completionForm(note = 'تم ردم الحفرة') {
  const form = new FormData();
  form.set('note', note);
  form.set('photo_latitude', INSIDE.latitude);
  form.set('photo_longitude', INSIDE.longitude);
  form.set('photo_accuracy_m', '8');
  form.set('image', new Blob([await photo()], { type: 'image/jpeg' }), 'after.jpg');
  return form;
}

const BBOX = '13.15,32.85,13.24,32.91';

module.exports = { startWorld, reportForm, completionForm, BBOX };
