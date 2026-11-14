import { AppError } from '../../utils/appError.js';
import { validDate } from './engine.schema.js';

const bad = (message = 'Unsupported or invalid Engine query parameter.') => { throw new AppError(400, 'INVALID_ENGINE_QUERY', message); };
export function parseEngineQuery(query = {}) {
  if (Object.keys(query).some((key) => !['page', 'limit', 'startDate', 'endDate', 'year', 'startYear', 'endYear', 'mapUnit'].includes(key))) bad();
  const number = (key, fallback, maximum) => {
    if (query[key] === undefined) return fallback;
    if (typeof query[key] !== 'string' || !/^[1-9]\d*$/.test(query[key]) || Number(query[key]) > maximum) bad();
    return Number(query[key]);
  };
  const result = { page: number('page', 1, 10000), limit: number('limit', 20, 100) };
  for (const key of ['startDate', 'endDate']) {
    if (query[key] !== undefined) {
      if (!validDate(query[key], 'month') && !validDate(query[key], 'day')) bad();
      result[key] = query[key];
    }
  }
  if (result.startDate && result.endDate && (result.startDate.length !== result.endDate.length || result.startDate > result.endDate)) bad();
  for (const key of ['year', 'startYear', 'endYear']) {
    if (query[key] !== undefined) {
      if (typeof query[key] !== 'string' || !/^\d{4}$/.test(query[key]) || Number(query[key]) < 1) bad();
      result[key] = Number(query[key]);
    }
  }
  if (result.startYear && result.endYear && result.startYear > result.endYear
    || result.year && (result.startYear || result.endYear)) bad();
  if (query.mapUnit !== undefined) {
    if (typeof query.mapUnit !== 'string' || !query.mapUnit.trim() || query.mapUnit.length > 128) bad();
    result.mapUnit = query.mapUnit;
  }
  return result;
}

export function createRecordFilter(query, mappings) {
  if ((query.startDate || query.endDate) && !mappings.date
    || (query.year || query.startYear || query.endYear) && !mappings.year || query.mapUnit !== undefined && !mappings.mapUnit) {
    bad('The manifest does not declare the requested filter mapping.');
  }
  for (const key of ['startDate', 'endDate']) {
    if (query[key] && !validDate(query[key], mappings.date.granularity)) bad('Date filter precision must match the manifest mapping.');
  }
  return (record) => (!query.startDate || record[mappings.date.field] >= query.startDate)
    && (!query.endDate || record[mappings.date.field] <= query.endDate)
    && (!query.year || record[mappings.year] === query.year)
    && (!query.startYear || record[mappings.year] >= query.startYear)
    && (!query.endYear || record[mappings.year] <= query.endYear)
    && (query.mapUnit === undefined || String(record[mappings.mapUnit]) === query.mapUnit);
}
