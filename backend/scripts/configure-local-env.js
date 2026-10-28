const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

const backendDir = path.resolve(__dirname, '..');

function shellQuote(value) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function localStatus() {
  if (process.platform === 'win32') {
    const linuxDir = backendDir
      .replace(/^([A-Za-z]):/, (_, drive) => `/mnt/${drive.toLowerCase()}`)
      .replace(/\\/g, '/');
    return execFileSync('wsl', [
      '-d', 'Ubuntu', '--', 'sh', '-lc',
      `cd ${shellQuote(linuxDir)} && "$HOME/.local/bin/supabase" status --env`,
    ], { encoding: 'utf8' });
  }
  return execFileSync('supabase', ['status', '--env'], {
    cwd: backendDir,
    encoding: 'utf8',
  });
}

const status = dotenv.parse(localStatus());
const values = {
  PORT: '5000',
  DATABASE_URL: status.DB_URL,
  SUPABASE_URL: status.API_URL,
  SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY || status.ANON_KEY,
  SUPABASE_SECRET_KEY: status.SECRET_KEY || status.SERVICE_ROLE_KEY,
  SUPABASE_STORAGE_BUCKET: 'report-images',
  CORS_ORIGINS: 'http://localhost:5173',
};

for (const [name, value] of Object.entries(values)) {
  if (!value) throw new Error(`Local Supabase status is missing ${name}`);
}
for (const name of ['DATABASE_URL', 'SUPABASE_URL']) {
  const host = new URL(values[name]).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(`${name} must point to local Supabase`);
  }
}

const file = path.join(backendDir, '.env.local');
fs.writeFileSync(
  file,
  Object.entries(values).map(([name, value]) => `${name}=${value}`).join('\n') + '\n',
  { mode: 0o600 },
);
console.log('Local backend configuration created: backend/.env.local');
