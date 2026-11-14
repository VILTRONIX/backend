import { AppError } from '../../utils/appError.js';

export const PREFERENCE_CRITERIA = Object.freeze(['water', 'soilHealth', 'productivity']);

const isRecord = (value) => value !== null && typeof value === 'object'
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

function invalid(errors) {
  throw new AppError(400, 'INVALID_PREFERENCES', 'Preference weights are invalid.', { errors });
}

// Reusable independently of HTTP, MongoDB, and any scientific data source.
export function validatePreferenceWeights(weights) {
  if (!isRecord(weights)) {
    invalid([{ field: 'weights', code: 'INVALID_TYPE', message: 'weights must be an object containing all three criteria.' }]);
  }

  const errors = [];
  if (Reflect.ownKeys(weights).some((key) => !PREFERENCE_CRITERIA.includes(key))) {
    errors.push({ field: 'weights', code: 'UNSUPPORTED_CRITERIA', message: 'Only water, soilHealth, and productivity are supported.' });
  }
  for (const criterion of PREFERENCE_CRITERIA) {
    const field = `weights.${criterion}`;
    if (!Object.hasOwn(weights, criterion)) {
      errors.push({ field, code: 'REQUIRED', message: 'This criterion is required.' });
    } else if (typeof weights[criterion] !== 'number' || !Number.isFinite(weights[criterion])) {
      errors.push({ field, code: 'INVALID_TYPE', message: 'Weight must be a finite number.' });
    } else if (weights[criterion] < 0 || weights[criterion] > 100) {
      errors.push({ field, code: 'OUT_OF_RANGE', message: 'Weight must be between 0 and 100 inclusive.' });
    }
  }
  if (errors.length) invalid(errors);

  const total = PREFERENCE_CRITERIA.reduce((sum, criterion) => sum + weights[criterion], 0);
  if (total === 0) {
    invalid([{ field: 'weights', code: 'ALL_ZERO', message: 'At least one weight must be greater than zero.' }]);
  }

  return {
    valid: true,
    originalWeights: Object.fromEntries(PREFERENCE_CRITERIA.map((criterion) => [criterion, weights[criterion]])),
    normalizedWeights: Object.fromEntries(PREFERENCE_CRITERIA.map((criterion) => [criterion, weights[criterion] / total])),
  };
}

export function validatePreferenceRequest(body) {
  if (!isRecord(body) || !Object.hasOwn(body, 'weights')) {
    invalid([{ field: 'weights', code: 'REQUIRED', message: 'Request body must be an object containing weights.' }]);
  }
  if (Reflect.ownKeys(body).some((key) => key !== 'weights')) {
    invalid([{ field: 'body', code: 'UNSUPPORTED_FIELD', message: 'Only weights is supported in the request body.' }]);
  }
  return validatePreferenceWeights(body.weights);
}
