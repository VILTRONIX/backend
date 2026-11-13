import { randomUUID } from 'node:crypto';

export function requestId(req, res, next) {
  // Generate IDs locally instead of trusting arbitrary client-controlled header values.
  req.id = randomUUID();
  res.setHeader('X-Request-ID', req.id);
  next();
}
