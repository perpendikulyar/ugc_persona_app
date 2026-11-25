import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const jobs = [
  spawn(npm, ['run', 'build:js', '--', '--watch=forever'], { stdio: 'inherit' }),
  spawn(npm, ['run', 'build:css', '--', '--watch=always'], { stdio: 'inherit' }),
  spawn(process.execPath, ['--watch', '--env-file-if-exists=.env', 'src/server.ts'], { stdio: 'inherit' }),
];

let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const job of jobs) job.kill();
}
for (const job of jobs) {
  job.once('exit', code => stop(code ?? 1));
  job.once('error', error => {
    console.error(error.message);
    stop(1);
  });
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
