export function notFound(req, res, next) {
  const error = new Error('Route not found.');
  error.status = 404;
  error.code = 'NOT_FOUND';
  next(error);
}
