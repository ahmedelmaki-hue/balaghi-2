const test = require('node:test');
const assert = require('node:assert/strict');
const { createGeocoder, fillReportAddress, shortAddress } = require('../src/geocode');

test('the short address is the street and its area, Arabic names first', () => {
  assert.equal(shortAddress({ address: {
    road: 'شارع السيدي', neighbourhood: "Shar'a Zawya", suburb: 'محلة الظهرة', city: 'طرابلس', country: 'ليبيا',
  } }), 'شارع السيدي، محلة الظهرة');
  // No street: the most specific Arabic area name.
  assert.equal(shortAddress({ address: { neighbourhood: 'Fashloum', village: 'فشلوم', suburb: 'سيدي خليفة' } }), 'فشلوم');
  // Only an English name: better than nothing.
  assert.equal(shortAddress({ address: { neighbourhood: 'Downtown', city: 'طرابلس' } }), 'Downtown');
  // Only the city or country says less than the coordinates.
  assert.equal(shortAddress({ address: { city: 'طرابلس', country: 'ليبيا' } }), null);
  assert.equal(shortAddress({}), null);
});

test('lookups ask in Arabic, name the app, and wait a second between requests', async () => {
  const requests = [];
  const waits = [];
  const geocoder = createGeocoder({
    userAgent: 'Balaghi test',
    wait: async (ms) => { waits.push(ms); },
    fetchImpl: async (url, options) => {
      requests.push({ url: new URL(url), headers: options.headers });
      return { ok: true, json: async () => ({ address: { road: 'شارع عمر المختار' } }) };
    },
  });

  assert.equal(await geocoder.reverse(32.8893, 13.1871), 'شارع عمر المختار');
  assert.equal(await geocoder.reverse(32.88, 13.19), 'شارع عمر المختار');

  assert.equal(requests[0].url.searchParams.get('lat'), '32.8893');
  assert.equal(requests[0].url.searchParams.get('lon'), '13.1871');
  assert.equal(requests[0].url.searchParams.get('accept-language'), 'ar');
  assert.equal(requests[0].headers['User-Agent'], 'Balaghi test');
  assert.equal(waits.length, 1, 'the second request waits for the first');
  assert.ok(waits[0] > 1000);
});

test('a failed lookup rejects without blocking the next one', async () => {
  let calls = 0;
  const geocoder = createGeocoder({
    wait: async () => {},
    fetchImpl: async () => {
      calls += 1;
      return calls === 1 ? { ok: false, status: 503 }
        : { ok: true, json: async () => ({ address: { suburb: 'حي الأندلس' } }) };
    },
  });
  await assert.rejects(geocoder.reverse(32.88, 13.19), /503/);
  assert.equal(await geocoder.reverse(32.88, 13.19), 'حي الأندلس');
});

test('an address is written only to a report still at the looked-up location', async () => {
  const writes = [];
  const pool = {
    async query(sql, params) {
      if (sql.startsWith('SELECT latitude')) {
        return { rows: params[0] === '1' ? [{ latitude: 32.88, longitude: 13.19 }] : [] };
      }
      writes.push({ sql, params });
      return { rows: [] };
    },
  };
  const geocoder = { reverse: async () => 'شارع عمر المختار' };

  assert.equal(await fillReportAddress(pool, geocoder, '1'), 'شارع عمر المختار');
  assert.deepEqual(writes[0].params, ['1', 'شارع عمر المختار', 32.88, 13.19]);
  assert.match(writes[0].sql, /address_text IS NULL AND latitude = \$3 AND longitude = \$4/);

  // A report that already has an address, or none at all, is left alone.
  assert.equal(await fillReportAddress(pool, geocoder, '2'), null);
  assert.equal(writes.length, 1);
  assert.equal(await fillReportAddress(pool, { reverse: async () => null }, '1'), null);
  assert.equal(writes.length, 1);
});
