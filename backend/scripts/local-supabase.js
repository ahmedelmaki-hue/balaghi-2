const { execFileSync } = require('node:child_process');
const path = require('node:path');

const command = process.argv[2];
if (!['start', 'stop'].includes(command)) {
  throw new Error('Use start or stop.');
}

const backendDir = path.resolve(__dirname, '..');
if (process.platform === 'win32') {
  const linuxDir = backendDir
    .replace(/^([A-Za-z]):/, (_, drive) => `/mnt/${drive.toLowerCase()}`)
    .replace(/\\/g, '/');
  const quotedDir = `'${linuxDir.replace(/'/g, "'\\''")}'`;
  execFileSync('wsl', [
    '-d', 'Ubuntu', '--', 'sh', '-lc',
    `cd ${quotedDir} && "$HOME/.local/bin/supabase" ${command}${command === 'start' ? ' --runtime native' : ''}`,
  ], { stdio: 'inherit' });
} else {
  execFileSync('supabase', [command, ...(command === 'start' ? ['--runtime', 'native'] : [])], {
    cwd: backendDir,
    stdio: 'inherit',
  });
}
