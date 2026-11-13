import { createServer } from 'node:http';
import { once } from 'node:events';

export async function serve(app, context) {
  const server = createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

export function captureLogger() {
  const messages = [];
  const log = (message) => messages.push(message);
  return { messages, info: log, warn: log, error: log };
}
