import { spawn } from 'node:child_process';

// The same bounded build works on Windows and Linux without a shell dependency.
const child = spawn(process.execPath, ['node_modules/vinext/dist/cli.js', 'build'], {
  stdio: 'inherit', windowsHide: true,
  env: { ...process.env, WRANGLER_WRITE_LOGS: 'false', WRANGLER_LOG_PATH: '.wrangler/wrangler.log' },
});
let expired = false;
const timer = setTimeout(() => { expired = true; child.kill('SIGTERM'); }, 180000);
child.once('error', (error) => { clearTimeout(timer); console.error(error.message); process.exitCode = 1; });
child.once('close', (code) => { clearTimeout(timer); process.exitCode = expired ? 124 : (code ?? 1); });
