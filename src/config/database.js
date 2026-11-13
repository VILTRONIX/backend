import mongoose from 'mongoose';

const CONNECTION_STATES = ['disconnected', 'connected', 'connecting', 'disconnecting'];

export function createDatabase({
  uri,
  logger = console,
  connection = mongoose.createConnection(),
  retryDelayMs = 5000,
  serverSelectionTimeoutMS = 5000,
}) {
  let started = false;
  let stopping = false;
  let retryTimer;
  let pendingConnection;

  // Never log driver errors or the URI: either can contain database credentials.
  connection.on('connected', () => logger.info('MongoDB connected.'));
  connection.on('disconnected', () => logger.warn('MongoDB disconnected.'));
  connection.on('error', () => logger.error('MongoDB connection error. Check configuration and network access.'));

  const isReady = () => !stopping && connection.readyState === 1;
  const getStatus = () => ({
    configured: Boolean(uri),
    ready: isReady(),
    name: isReady() ? connection.db?.databaseName ?? connection.name ?? null : null,
    status: stopping ? 'stopping' : !uri ? 'unconfigured' : CONNECTION_STATES[connection.readyState] ?? 'disconnected',
  });

  async function connect() {
    try {
      await connection.openUri(uri, {
        serverSelectionTimeoutMS,
        connectTimeoutMS: 5000,
        heartbeatFrequencyMS: 5000,
        maxPoolSize: 10,
        bufferCommands: false,
        autoIndex: false,
        autoCreate: false,
      });
    } catch {
      if (!stopping) {
        logger.warn(`MongoDB unavailable. Retrying initial connection in ${retryDelayMs} ms.`);
        // Mongoose reconnects after an established connection drops, but initial failures need a retry.
        retryTimer = setTimeout(() => {
          pendingConnection = connect();
        }, retryDelayMs);
        retryTimer.unref();
      }
    }
  }

  function start() {
    if (started || stopping) return;
    started = true;
    if (!uri) {
      logger.warn('MONGODB_URI is not configured. Liveness is available; readiness will return 503.');
      return;
    }
    pendingConnection = connect();
  }

  async function stop() {
    stopping = true;
    clearTimeout(retryTimer);
    // Wait for the bounded in-flight attempt before closing so it cannot connect after shutdown.
    await pendingConnection;
    await connection.close();
  }

  return { start, stop, isReady, getStatus, getConnection: () => connection };
}
