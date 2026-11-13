import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

async function unusedPort() {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function launch(context, environment = {}) {
  const port = await unusedPort();
  // IPC lets this test deliver SIGTERM to Node's handler on Windows as well as Unix.
  // The production entry point has no test-only routes or IPC hooks.
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    await import('./src/server.js');
    process.on('message', () => { process.emit('SIGTERM'); process.disconnect(); });
  `], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'development',
      MONGODB_URI: '',
      CLIENT_URL: 'http://localhost:5173',
      ...environment,
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const exited = once(child, 'exit');
  let output = '';
  child.stdout.on('data', (data) => { output += data; });
  child.stderr.on('data', (data) => { output += data; });
  context.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await exited;
    }
  });
  const base = `http://127.0.0.1:${port}`;
  let running = false;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      running = (await fetch(`${base}/health/live`, { signal: AbortSignal.timeout(500) })).status === 200;
    } catch {
      // The child may still be importing modules and binding its HTTP listener.
    }
    if (running || child.exitCode !== null) break;
    await delay(25);
  }
  assert.equal(running, true, output);
  return { base, child, exited, output: () => output };
}

test('actual entry point starts without MongoDB and drains cleanly on shutdown', { timeout: 15000 }, async (t) => {
  const server = await launch(t);
  assert.equal((await fetch(`${server.base}/health/live`)).status, 200);
  const ready = await fetch(`${server.base}/health/ready`);
  assert.equal(ready.status, 503);
  assert.equal((await ready.json()).error.details.database.status, 'unconfigured');
  server.child.send('shutdown');
  const [exitCode] = await server.exited;
  assert.equal(exitCode, 0, server.output());
  assert.match(server.output(), /HTTP server and MongoDB connection closed/);
});

test('real Mongoose connection failure keeps HTTP alive and readiness false in production', { timeout: 20000 }, async (t) => {
  const databasePort = await unusedPort();
  const server = await launch(t, {
    NODE_ENV: 'production',
    MONGODB_URI: `mongodb://test-user:private-password@127.0.0.1:${databasePort}/terrapulse`,
  });
  assert.equal((await fetch(`${server.base}/health/ready`)).status, 503);
  for (let attempt = 0; attempt < 160 && !server.output().includes('Retrying initial connection'); attempt += 1) {
    await delay(50);
  }
  assert.match(server.output(), /Retrying initial connection/);
  assert.equal((await fetch(`${server.base}/health/live`)).status, 200);
  assert.equal((await fetch(`${server.base}/health/ready`)).status, 503);
  server.child.send('shutdown');
  const [exitCode] = await server.exited;
  assert.equal(exitCode, 0, server.output());
  assert.doesNotMatch(server.output(), /test-user|private-password|mongodb:\/\//);
});

test('actual entry point fails fast for missing production configuration', { timeout: 10000 }, async () => {
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: projectRoot,
    env: { ...process.env, NODE_ENV: 'production', MONGODB_URI: '', CLIENT_URL: 'https://terrapulse.example' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let errors = '';
  child.stderr.on('data', (data) => { errors += data; });
  const [exitCode] = await once(child, 'exit');
  assert.equal(exitCode, 1);
  assert.match(errors, /Startup failed/);
});
