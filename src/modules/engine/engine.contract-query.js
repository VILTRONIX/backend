import { AppError } from '../../utils/appError.js';
import { parseEngineQuery } from './engine.query.js';
import { validDate } from './engine.schema.js';
import { NUMBER_TOKEN } from './engine.csv.js';

const bad = () => { throw new AppError(400, 'INVALID_ENGINE_QUERY', 'Unsupported or invalid filter for this Engine dataset.'); };
const base = ['page', 'limit'];
const year = ['year', 'startYear', 'endYear'];
const range = ['startDate', 'endDate'];
export const FINAL_FILTERS = Object.freeze({
  power_monthly: [...year, ...range, 'location_id', 'month'],
  modis_monthly: [...year, ...range, 'month'], modis_16day: [...year, ...range],
  usda_annual: [...year, 'crop_code'], usda_crop_classes: [...year, 'crop_code'],
  usda_crop_transitions: ['year_1', 'year_2', 'transition_type'], soil_map_units: ['mukey', 'mapUnit'],
  merra2_context: [...year, ...range, 'latitude', 'longitude'],
});

export function parseFinalQuery(id, query = {}) {
  if (Object.keys(query).some((key) => ![...base, ...FINAL_FILTERS[id]].includes(key))) bad();
  const generic = Object.fromEntries(Object.entries(query).filter(([key]) => [...base, ...year, ...range].includes(key)));
  const result = parseEngineQuery(generic);
  const text = (key, max = 128) => {
    if (query[key] === undefined) return;
    if (typeof query[key] !== 'string' || !query[key].trim() || query[key].length > max) bad();
    result[key] = query[key];
  };
  for (const key of ['location_id', 'transition_type', 'mukey', 'mapUnit']) text(key);
  for (const key of ['year_1', 'year_2', 'crop_code']) {
    if (query[key] === undefined) continue;
    if (typeof query[key] !== 'string' || !/^[1-9]\d*$/.test(query[key]) || !Number.isSafeInteger(Number(query[key]))) bad();
    result[key] = Number(query[key]);
    if (key.startsWith('year_') && (query[key].length !== 4 || result[key] > 9999)) bad();
  }
  if (result.year_1 && result.year_2 && result.year_2 !== result.year_1 + 1) bad();
  if (query.month !== undefined) {
    if (id === 'power_monthly') {
      if (typeof query.month !== 'string' || !/^(?:[1-9]|1[0-2])$/.test(query.month)) bad();
      result.month = Number(query.month);
    } else {
      if (!validDate(query.month, 'month')) bad();
      result.month = query.month;
    }
  }
  if (id === 'modis_monthly' && [result.startDate, result.endDate].some((value) => value && !validDate(value, 'month'))) bad();
  if (id === 'modis_16day' && [result.startDate, result.endDate].some((value) => value && !validDate(value, 'day'))) bad();
  for (const key of ['latitude', 'longitude']) {
    if (query[key] === undefined) continue;
    if (typeof query[key] !== 'string' || !NUMBER_TOKEN.test(query[key]) || !Number.isFinite(Number(query[key]))) bad();
    result[key] = Number(query[key]);
    if (Math.abs(result[key]) > (key === 'latitude' ? 90 : 180)) bad();
  }
  if ([result.mukey, result.mapUnit].some((value) => value !== undefined && !/^\d+$/.test(value))
    || result.mukey !== undefined && result.mapUnit !== undefined && result.mukey !== result.mapUnit) bad();
  return result;
}

export function createFinalFilter(id, query) {
  const direct = FINAL_FILTERS[id].filter((key) => ![...year, ...range, 'mapUnit'].includes(key));
  return (record) => {
    for (const key of direct) if (query[key] !== undefined && record[key] !== query[key]) return false;
    if (query.mapUnit !== undefined && record.mukey !== query.mapUnit) return false;
    const date = id === 'power_monthly' ? record.month_start : id === 'modis_monthly' ? record.month : record.date;
    const recordYear = record.year ?? (typeof date === 'string' ? Number(date.slice(0, 4)) : undefined);
    if (query.year && recordYear !== query.year || query.startYear && recordYear < query.startYear || query.endYear && recordYear > query.endYear) return false;
    if (query.startDate && date.slice(0, query.startDate.length) < query.startDate || query.endDate && date.slice(0, query.endDate.length) > query.endDate) return false;
    return true;
  };
}
