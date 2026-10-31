import { type ChildProcess, spawn } from 'node:child_process';

const commands = ['dev:server', 'dev:desktop'];
const children: ChildProcess[] = [];
let code: number | undefined;

function stopAll() {
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
}

for (const command of commands) {
  const child = spawn('pnpm', [command], { stdio: 'inherit' });
  children.push(child);
  child.on('exit', (status, signal) => {
    // The first process to leave decides the result; the other one is stopped with it.
    code ??= status ?? (signal ? 1 : 0);
    stopAll();
    if (children.every((entry) => entry.exitCode !== null || entry.signalCode !== null))
      process.exit(code);
  });
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, stopAll);
