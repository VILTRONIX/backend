import { AppError } from '../../utils/appError.js';
import { isCoverageDate } from '../datasets/dataset.validation.js';
import { RESOLUTIONS } from './vegetation.constants.js';

export function validPeriodKey(value, resolution) {
  return typeof value === 'string' && (resolution === 'monthly' ? /^\d{4}-\d{2}$/.test(value) : /^\d{4}-\d{2}-\d{2}$/.test(value)) && isCoverageDate(value);
}
export function parseVegetationQuery(query, { summary = false, lookup = false } = {}) {
  const allowed = lookup ? ['areaId', 'geoid', 'resolution'] : ['areaId', 'geoid', 'resolution', 'startDate', 'endDate', ...(summary ? [] : ['page', 'limit'])];
  if (Object.keys(query).some((key) => !allowed.includes(key))) throw new AppError(400, 'INVALID_QUERY', 'Unsupported vegetation query parameter.');
  if (summary && query.resolution === undefined) throw new AppError(400, 'RESOLUTION_REQUIRED', 'Summary requires resolution=16day or resolution=monthly.');
  const resolution = query.resolution ?? '16day';
  if (!RESOLUTIONS.includes(resolution)) throw new AppError(400, 'INVALID_QUERY', 'resolution must be 16day or monthly.');
  if (query.areaId !== undefined && (typeof query.areaId !== 'string' || !/^[a-fA-F0-9]{24}$/.test(query.areaId))) throw new AppError(400, 'INVALID_QUERY', 'areaId must be a hexadecimal ObjectId.');
  if (query.geoid !== undefined && (typeof query.geoid !== 'string' || !/^\d{5}$/.test(query.geoid))) throw new AppError(400, 'INVALID_QUERY', 'geoid must be a five-digit string.');
  for (const key of ['startDate', 'endDate']) if (query[key] !== undefined && !validPeriodKey(query[key], resolution)) {
    throw new AppError(400, 'INVALID_QUERY', `${key} must be a valid ${resolution === 'monthly' ? 'YYYY-MM month' : 'YYYY-MM-DD date'}.`);
  }
  if (query.startDate && query.endDate && query.startDate > query.endDate) throw new AppError(400, 'INVALID_QUERY', 'startDate must not follow endDate.');
  const number = (key, fallback, maximum) => {
    if (query[key] === undefined) return fallback;
    if (typeof query[key] !== 'string' || !/^[1-9]\d*$/.test(query[key]) || Number(query[key]) > maximum) throw new AppError(400, 'INVALID_QUERY', `${key} must be an integer between 1 and ${maximum}.`);
    return Number(query[key]);
  };
  return { resolution, areaId: query.areaId, geoid: query.geoid, startDate: query.startDate, endDate: query.endDate, page: number('page', 1, 10000), limit: number('limit', 20, 100) };
}
