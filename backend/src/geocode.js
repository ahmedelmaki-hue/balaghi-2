// Street names for report locations, from OpenStreetMap's Nominatim service.
// Lookups run after a report is saved, so a slow or missing service never
// delays or fails a submission; the coordinates stay the fallback.
const DEFAULT_URL = 'https://nominatim.openstreetmap.org/reverse';
const DEFAULT_USER_AGENT = 'Balaghi civic reports (graduation project)';
// Nominatim's usage policy allows at most one request per second.
const MIN_INTERVAL_MS = 1100;
const MAX_ADDRESS_LENGTH = 255;

const ROAD_KEYS = ['road', 'pedestrian', 'footway', 'residential', 'street'];
// Most specific first. In Tripoli some neighbourhoods carry only an English
// name in OpenStreetMap while the wider area has an Arabic one.
const AREA_KEYS = ['neighbourhood', 'quarter', 'village', 'hamlet', 'suburb', 'town', 'city_district'];
const ARABIC = /[؀-ۿ]/;

// The first Arabic value among the keys, else the first value at all.
function pick(address, keys) {
  const values = keys.map((key) => address[key])
    .filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim());
  return values.find((value) => ARABIC.test(value)) || values[0] || null;
}

// "شارع عمر المختار، باب البحر": the street and its area, nothing wider.
// Without either, the coordinates say more than a city name would.
function shortAddress(result) {
  const address = result?.address || {};
  const road = pick(address, ROAD_KEYS);
  const area = pick(address, AREA_KEYS);
  const parts = [...new Set([road, area].filter(Boolean))];
  return parts.length ? parts.join('، ').slice(0, MAX_ADDRESS_LENGTH) : null;
}

function createGeocoder({
  fetchImpl = globalThis.fetch, url = DEFAULT_URL, userAgent = DEFAULT_USER_AGENT,
  minIntervalMs = MIN_INTERVAL_MS, timeoutMs = 8000, wait = (ms) => new Promise((done) => setTimeout(done, ms)),
} = {}) {
  let queue = Promise.resolve();
  let lastRequest = -Infinity;

  async function lookup(latitude, longitude) {
    const delay = lastRequest + minIntervalMs - Date.now();
    if (delay > 0) await wait(delay);
    lastRequest = Date.now();
    const target = new URL(url);
    target.search = new URLSearchParams({
      format: 'jsonv2', lat: String(latitude), lon: String(longitude),
      zoom: '17', addressdetails: '1', 'accept-language': 'ar',
    }).toString();
    const response = await fetchImpl(target, {
      headers: { 'User-Agent': userAgent, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`address lookup returned ${response.status}`);
    return shortAddress(await response.json());
  }

  return {
    // Lookups take turns so the service sees one request per second at most.
    reverse(latitude, longitude) {
      const result = queue.then(() => lookup(latitude, longitude));
      queue = result.catch(() => {});
      return result;
    },
  };
}

// Writes the street name of a report that has none. The location is read and
// compared again on write, so a lookup never lands on a corrected location.
async function fillReportAddress(pool, geocoder, id) {
  const current = await pool.query(
    'SELECT latitude, longitude FROM public.reports WHERE id = $1 AND address_text IS NULL', [id]
  );
  if (!current.rows[0]) return null;
  const { latitude, longitude } = current.rows[0];
  const address = await geocoder.reverse(latitude, longitude);
  if (!address) return null;
  await pool.query(
    `UPDATE public.reports SET address_text = $2
     WHERE id = $1 AND address_text IS NULL AND latitude = $3 AND longitude = $4`,
    [id, address, latitude, longitude]
  );
  return address;
}

module.exports = { createGeocoder, fillReportAddress, shortAddress };
