import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createDatabase } from '../src/config/database.js';
import { captureLogger } from './helpers/http.js';

class TestConnection extends EventEmitter {
  readyState = 0;
  db = { databaseName: 'terrapulse' };
  attempts = 0;
  closed = false;
  async openUri(uri, options) {
    this.attempts += 1;
    this.options = options;
    this.readyState = 1;
    this.emit('connected');
  }
  async close() {
    this.closed = true;
    this.readyState = 0;
    this.emit('disconnected');
  }
}

test('missing configuration keeps readiness false and starts no connection attempts', async () => {
  const connection = new TestConnection();
  const database = createDatabase({ uri: '', connection, logger: captureLogger() });
  database.start();
  assert.equal(database.getStatus().status, 'unconfigured');
  assert.equal(database.isReady(), false);
  assert.equal(connection.attempts, 0);
  await database.stop();
});

test('readiness is false until connection succeeds and follows disconnect/reconnect events', async () => {
  const connection = new TestConnection();
  let connected;
  connection.openUri = async () => {
    connection.readyState = 2;
    await new Promise((resolve) => { connected = resolve; });
    connection.readyState = 1;
    connection.emit('connected');
  };
  const logger = captureLogger();
  const database = createDatabase({ uri: 'mongodb://localhost/db', connection, logger });
  database.start();
  assert.equal(database.isReady(), false);
  assert.equal(database.getStatus().status, 'connecting');
  assert.equal(database.getStatus().name, null);
  connected();
  await delay(0);
  assert.equal(database.isReady(), true);
  assert.equal(database.getStatus().name, 'terrapulse');
  assert.equal(database.getConnection(), connection);
  connection.readyState = 0;
  connection.emit('disconnected');
  assert.equal(database.isReady(), false);
  assert.equal(database.getStatus().name, null);
  connection.readyState = 1;
  connection.emit('connected');
  assert.equal(database.isReady(), true);
  await database.stop();
  assert.equal(database.isReady(), false);
  assert.ok(logger.messages.includes('MongoDB connected.'));
  assert.ok(logger.messages.includes('MongoDB disconnected.'));
});

test('initial failure retries successfully and never logs driver secrets', async () => {
  const connection = new TestConnection();
  const originalOpen = connection.openUri.bind(connection);
  let fail = true;
  connection.openUri = async (...args) => {
    if (fail) {
      fail = false;
      const error = new Error('mongodb://private-user:private-password@example.com/db');
      connection.emit('error', error);
      throw error;
    }
    await originalOpen(...args);
  };
  const logger = captureLogger();
  const database = createDatabase({ uri: 'mongodb://private-user:private-password@example.com/db', connection, logger, retryDelayMs: 5 });
  try {
    database.start();
    assert.equal(database.isReady(), false);
    for (let count = 0; count < 100 && !database.isReady(); count += 1) await delay(5);
    assert.equal(database.isReady(), true);
    assert.doesNotMatch(logger.messages.join('\n'), /private-user|private-password|example.com/);
    assert.equal(connection.options.bufferCommands, false);
    assert.equal(connection.options.serverSelectionTimeoutMS, 5000);
  } finally {
    await database.stop();
  }
});

test('shutdown cancels scheduled retries and repeated start does not open more connections', async () => {
  const connection = new TestConnection();
  connection.openUri = async () => { connection.attempts += 1; throw new Error('unavailable'); };
  const database = createDatabase({ uri: 'mongodb://localhost/db', connection, logger: captureLogger(), retryDelayMs: 20 });
  database.start();
  database.start();
  await delay(0);
  await database.stop();
  await delay(40);
  database.start();
  assert.equal(connection.attempts, 1);
  assert.equal(connection.closed, true);
  assert.equal(database.isReady(), false);
});

test('shutdown waits for an in-flight connection and closes it before resolving', async () => {
  const connection = new TestConnection();
  let finish;
  connection.openUri = async () => {
    connection.readyState = 2;
    await new Promise((resolve) => { finish = resolve; });
    connection.readyState = 1;
  };
  const database = createDatabase({ uri: 'mongodb://localhost/db', connection, logger: captureLogger() });
  database.start();
  const stopped = database.stop();
  assert.equal(database.isReady(), false);
  finish();
  await stopped;
  assert.equal(connection.closed, true);
  assert.equal(connection.readyState, 0);
});
