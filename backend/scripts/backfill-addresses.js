// Fills the street name of reports saved before addresses were looked up.
// One lookup per second, as the OpenStreetMap service asks; safe to rerun.
const { Pool } = require('pg');
const { loadConfig } = require('../src/config');
const { createGeocoder, fillReportAddress } = require('../src/geocode');

async function main() {
  const config = loadConfig();
  if (!config.geocoder) throw new Error('GEOCODER=off: address lookups are disabled.');
  const pool = new Pool({ connectionString: config.databaseUrl });
  const geocoder = createGeocoder(config.geocoder);
  try {
    const missing = await pool.query(
      'SELECT id FROM public.reports WHERE address_text IS NULL ORDER BY id'
    );
    console.log(`${missing.rows.length} reports have no street name yet.`);
    let filled = 0;
    for (const { id } of missing.rows) {
      try {
        const address = await fillReportAddress(pool, geocoder, id);
        if (address) filled += 1;
        console.log(`#${id}: ${address || 'no street name found, coordinates stay'}`);
      } catch (error) {
        console.log(`#${id}: lookup failed (${error.message}); try again later`);
      }
    }
    console.log(`Done: ${filled} of ${missing.rows.length} reports now show a street name.`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
