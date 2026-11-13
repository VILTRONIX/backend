import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

export function parseEnv(environment) {
  const nodeEnv = environment.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error('NODE_ENV must be development, test, or production.');
  }

  const rawPort = environment.PORT ?? '5000';
  const port = Number(rawPort);
  if (!/^\d+$/.test(rawPort) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }

  const mongodbUri = (environment.MONGODB_URI ?? '').trim();
  if (mongodbUri && (!/^mongodb(?:\+srv)?:\/\/[^\s]+$/.test(mongodbUri))) {
    throw new Error('MONGODB_URI must use mongodb:// or mongodb+srv:// without whitespace.');
  }
  if (nodeEnv === 'production' && !mongodbUri) {
    throw new Error('MONGODB_URI is required in production.');
  }

  const rawOrigins = environment.CLIENT_URL ?? (nodeEnv === 'production' ? '' : 'http://localhost:5173');
  const clientOrigins = rawOrigins.split(',').map((origin) => origin.trim());
  if (clientOrigins.some((origin) => !origin)) {
    throw new Error('CLIENT_URL must contain one or more comma-separated HTTP(S) origins.');
  }
  for (const origin of clientOrigins) {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error('CLIENT_URL must contain valid HTTP(S) origins.');
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.hostname.includes('*') || parsed.origin !== origin) {
      throw new Error('CLIENT_URL entries must be exact HTTP(S) origins without paths, credentials, or wildcards.');
    }
  }

  return Object.freeze({
    port,
    nodeEnv,
    mongodbUri,
    clientOrigins: Object.freeze([...new Set(clientOrigins)]),
  });
}

export function loadEnv() {
  // Resolve from this module so startup does not depend on the shell's working directory.
  const result = dotenv.config({
    path: fileURLToPath(new URL('../../.env', import.meta.url)),
    quiet: true,
  });
  if (result.error && result.error.code !== 'ENOENT') {
    throw new Error('Unable to read the .env configuration file.');
  }
  return parseEnv(process.env);
}
