import { AppError } from '../../utils/appError.js';

export const PROVIDERS = ['NASA', 'USDA', 'USGS'];
export const CATEGORIES = ['vegetation', 'climate', 'soil_moisture', 'soil', 'crop_history', 'imagery'];
export const ACQUISITION_STATUSES = ['pending', 'request_completed', 'reported_available', 'downloaded', 'failed'];
export const VALIDATION_STATUSES = ['pending', 'partially_validated', 'validated', 'failed'];
export const PROCESSING_STATUSES = ['not_started', 'in_progress', 'completed', 'failed'];
export const COVERAGE_STATUSES = ['reported', 'verified', 'unavailable', 'unknown'];
export const VARIABLE_STATUSES = ['target', 'reported', 'verified', 'reported_absent', 'unavailable', 'unknown'];
export const ASSET_TYPES = ['raw', 'processed', 'metadata'];
export const ASSET_FORMATS = ['CSV', 'NetCDF4', 'GeoTIFF', 'GeoJSON', 'Parquet', 'JSON', 'TXT'];

const readyConditions = { isActive: true, 'acquisition.status': 'downloaded', 'validation.status': 'validated', 'processing.status': 'completed' };
const failedConditions = { $or: ['acquisition', 'validation', 'processing'].map((stage) => ({ [`${stage}.status`]: 'failed' })) };

export function getReadiness(dataset) {
  const blockers = [];
  if (dataset.isActive !== true) blockers.push('inactive');
  if (dataset.acquisition?.status !== 'downloaded') blockers.push('acquisition_not_downloaded');
  if (dataset.validation?.status !== 'validated') blockers.push('validation_not_validated');
  if (dataset.processing?.status !== 'completed') blockers.push('processing_not_completed');
  const failed = ['acquisition', 'validation', 'processing'].some((stage) => dataset[stage]?.status === 'failed');
  return { status: failed ? 'failed' : blockers.length ? 'not_ready' : 'ready', ready: !blockers.length, scope: 'dataset_lifecycle_only', blockers };
}

export function validateSlug(slug) {
  if (typeof slug !== 'string' || slug.length > 120 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new AppError(400, 'INVALID_SLUG', 'Dataset slug must use lowercase letters, digits, and single hyphens (maximum 120 characters).');
  }
  return slug;
}

export function isCoverageDate(value) {
  if (value == null) return true;
  if (typeof value !== 'string' || !/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(value)) return false;
  const [year, month = '01', day = '01'] = value.split('-');
  const iso = `${year}-${month}-${day}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso;
}

function pagination(query, permitted) {
  if (Object.keys(query).some((key) => !permitted.includes(key))) throw new AppError(400, 'INVALID_QUERY', 'Unsupported query parameter.');
  const number = (key, fallback, max) => {
    if (query[key] === undefined) return fallback;
    if (typeof query[key] !== 'string' || !/^[1-9]\d*$/.test(query[key]) || Number(query[key]) > max) {
      throw new AppError(400, 'INVALID_QUERY', `${key} must be an integer between 1 and ${max}.`);
    }
    return Number(query[key]);
  };
  return { page: number('page', 1, 10000), limit: number('limit', 20, 100) };
}

function enumFilter(query, key, values) {
  if (query[key] === undefined) return undefined;
  if (!values.includes(query[key])) throw new AppError(400, 'INVALID_QUERY', `${key} is not supported.`);
  return query[key];
}

export function parseDatasetQuery(query) {
  const { page, limit } = pagination(query, ['page', 'limit', 'provider', 'category', 'acquisitionStatus', 'validationStatus', 'processingStatus', 'readiness', 'isActive', 'search']);
  if (query.isActive !== undefined && !['true', 'false'].includes(query.isActive)) throw new AppError(400, 'INVALID_QUERY', 'isActive must be true or false.');
  const filter = { isActive: query.isActive !== 'false' };
  for (const [key, values, field] of [
    ['provider', PROVIDERS, 'provider'], ['category', CATEGORIES, 'category'],
    ['acquisitionStatus', ACQUISITION_STATUSES, 'acquisition.status'],
    ['validationStatus', VALIDATION_STATUSES, 'validation.status'],
    ['processingStatus', PROCESSING_STATUSES, 'processing.status'],
  ]) {
    const value = enumFilter(query, key, values);
    if (value !== undefined) filter[field] = value;
  }
  const readiness = enumFilter(query, 'readiness', ['ready', 'not_ready', 'failed']);
  if (readiness) filter.$and = [readiness === 'ready' ? { ...readyConditions } : readiness === 'failed' ? failedConditions : { $nor: [readyConditions, failedConditions] }];
  if (query.search !== undefined) {
    if (typeof query.search !== 'string' || !query.search.trim() || query.search.length > 100) throw new AppError(400, 'INVALID_QUERY', 'search must contain 1 to 100 characters.');
    const literal = query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = ['name', 'slug', 'productId', 'description'].map((field) => ({ [field]: { $regex: literal, $options: 'i' } }));
  }
  return { page, limit, filter };
}

export function parseAssetQuery(query) {
  const { page, limit } = pagination(query, ['page', 'limit', 'assetType']);
  const assetType = enumFilter(query, 'assetType', ASSET_TYPES);
  return { page, limit, filter: assetType ? { assetType } : {} };
}
