import { STATUS_CODES } from 'node:http';
import { AppError } from '../utils/appError.js';

export function createErrorHandler({ logger = console } = {}) {
  return function errorHandler(error, req, res, next) {
    if (res.headersSent) return next(error);

    let status = Number.isInteger(error.status) && error.status >= 400 && error.status < 500
      ? error.status
      : 500;
    let code = 'REQUEST_ERROR';
    let message = STATUS_CODES[status];

    if (error.type === 'entity.parse.failed') {
      status = 400;
      code = 'INVALID_JSON';
      message = 'Request body must contain valid JSON.';
    } else if (error.type === 'entity.too.large') {
      status = 413;
      code = 'PAYLOAD_TOO_LARGE';
      message = 'Request body exceeds the permitted size limit.';
    } else if (error.code === 'CORS_ORIGIN_DENIED') {
      status = 403;
      code = 'CORS_ORIGIN_DENIED';
      message = 'Origin is not allowed.';
    } else if (error instanceof AppError) {
      status = error.status;
      code = error.code;
      message = error.message;
    } else if (status === 404) {
      code = 'NOT_FOUND';
      message = 'Route not found.';
    } else if (status === 500) {
      code = 'INTERNAL_SERVER_ERROR';
      message = 'An unexpected error occurred.';
    }

    if (status >= 500) {
      logger.error(`Request failed: requestId=${req.id} status=${status} code=${code}`);
    }
    // Error messages, bodies, stacks, URLs, and driver objects may contain secrets.
    const details = error instanceof AppError ? error.details : undefined;
    res.status(status).json({ success: false, error: { code, message, ...(details ? { details } : {}) }, requestId: req.id });
  };
}
