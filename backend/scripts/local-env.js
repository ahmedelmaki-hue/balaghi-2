const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

const file = path.resolve(__dirname, '../.env.local');
if (!fs.existsSync(file)) {
  throw new Error('Local configuration is missing. Run npm run configure:local after starting Supabase.');
}
dotenv.config({ path: file, override: true });
