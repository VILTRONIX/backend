import { createServer } from 'node:http';
import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createDatabase } from './config/database.js';

function startServer() {
  const config = loadEnv();
  const database = createDatabase({ uri: config.mongodbUri });
  const app = createApp({ config, database });
  const server = createServer(app);
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  let shuttingDown = false;

  async function shutdown(reason, exitCode = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    process.exitCode = exitCode;
    console.info(`Shutting down: ${reason}.`);
    const deadline = setTimeout(() => {
      console.error('Shutdown deadline exceeded.');
      server.closeAllConnections();
      process.exit(1);
    }, 10000);
    // Keep the deadline active until both HTTP and MongoDB have closed.
    try {
      const httpClosed = new Promise((resolve) => server.close(resolve));
      await Promise.all([httpClosed, database.stop()]);
      console.info('HTTP server and MongoDB connection closed.');
    } catch {
      console.error('Shutdown failed.');
      process.exitCode = 1;
    } finally {
      clearTimeout(deadline);
    }
  }

  process.once('SIGINT', () => { void shutdown('SIGINT'); });
  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
  server.on('error', (error) => {
    const message = error.code === 'EADDRINUSE' ? 'HTTP port is already in use' : 'HTTP server error';
    void shutdown(message, 1);
  });
  server.listen(config.port, () => {
    console.info(`TerraPulse API listening on port ${config.port} (${config.nodeEnv}).`);
    database.start();
  });
}

try {
  startServer();
} catch {
  console.error('Startup failed. Check PORT, NODE_ENV, MONGODB_URI, and CLIENT_URL configuration.');
  process.exitCode = 1;
}
