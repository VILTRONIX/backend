import { isDeepStrictEqual } from 'node:util';
import { fail, isRecord } from './engine.files.js';
import { validDate } from './engine.schema.js';

const reject = (reason) => fail('validation_failed', reason);
const close = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 64 * Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b));
const monthIndex = (text) => Number(text.slice(0, 4)) * 12 + Number(text.slice(5, 7)) - 1;
const periodLabel = (row) => row.month_start?.slice(0, 7) ?? (typeof row.month === 'string' ? row.month : row.date?.slice(0, 7));
function calendarDays(year, month) {
  const date = new Date(0); date.setUTCFullYear(year, month, 0); return date.getUTCDate();
}

// Contract structural/arithmetic checks only. Never alter records or assess scientific benefit.
export function createFinalIntegrity(descriptor, schema) {
  const { entry } = descriptor.finalContract, id = descriptor.logicalId, expected = schema['x-dataset'].validation;
  const keys = new Set(), nulls = Object.fromEntries(Object.keys(schema.properties).map((key) => [key, 0]));
  const groups = new Map(); let count = 0, monthlyPixels;
  function addGroup(key, row) {
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  function vegetation(row, total) {
    for (const prefix of ['ndvi', 'evi']) {
      const valid = row[`${prefix}_valid_pixel_count`];
      if (valid > total || !close(row[`${prefix}_valid_pixel_percentage`], 100 * valid / total)
        || ['mean', 'median', 'std'].some((stat) => (valid === 0) !== (row[`${prefix}_${stat}`] === null))) reject('vegetation_count_or_null_mismatch');
    }
  }
  function monthlyCoverage(rows, coverage) {
    if (!validDate(coverage.start, 'month') || !validDate(coverage.end, 'month')) reject('invalid_coverage_declaration');
    const low = monthIndex(coverage.start), high = monthIndex(coverage.end), periods = new Set(rows.map(periodLabel));
    if (low > high || periods.size !== high - low + 1 || rows.length !== periods.size
      || [...periods].some((period) => !validDate(period, 'month') || monthIndex(period) < low || monthIndex(period) > high)) reject('coverage_mismatch');
  }
  return {
    accept(row) {
      count += 1;
      const key = JSON.stringify(entry.primary_key.map((field) => row[field]));
      if (keys.has(key)) reject('duplicate_primary_key');
      keys.add(key);
      for (const field of Object.keys(nulls)) if (row[field] === null) nulls[field] += 1;
      if (id === 'power_monthly') {
        const start = `${row.year}-${String(row.month).padStart(2, '0')}-01`, days = calendarDays(row.year, row.month);
        if (row.month_start !== start || row.month_end !== start.slice(0, 8) + days || row.days_expected !== days
          || row.days_present > days || row.complete !== (row.days_present === days)) reject('power_calendar_mismatch');
        addGroup(row.location_id, row);
      } else if (id === 'modis_16day') {
        vegetation(row, row.total_pixel_count);
        const before = JSON.parse(row.vi_usefulness_distribution_before_filter), after = JSON.parse(row.vi_usefulness_distribution_after_filter);
        if (row.quality_valid_pixel_count > row.base_valid_pixel_count || row.base_valid_pixel_count > row.total_pixel_count
          || row.ndvi_valid_pixel_count !== row.quality_valid_pixel_count || row.evi_valid_pixel_count !== row.quality_valid_pixel_count
          || Object.values(before).reduce((a, b) => a + b, 0) !== row.base_valid_pixel_count
          || Object.values(after).reduce((a, b) => a + b, 0) !== row.quality_valid_pixel_count
          || Object.entries(after).some(([key, value]) => value > (before[key] ?? 0))) reject('modis_qa_mismatch');
        addGroup(row.date.slice(0, 4), row);
      } else if (id === 'modis_monthly') {
        vegetation(row, row.total_pixel_observations);
        const pixels = row.total_pixel_observations / row.observation_count;
        if (!Number.isSafeInteger(pixels) || monthlyPixels !== undefined && pixels !== monthlyPixels) reject('monthly_pixel_denominator_mismatch');
        monthlyPixels = pixels; addGroup('monthly', row);
      } else if (id === 'merra2_context') {
        if (!row.date.endsWith('-01')) reject('merra_month_label_mismatch');
        addGroup(JSON.stringify([row.latitude, row.longitude]), row);
      } else if (id === 'soil_map_units') {
        if (entry.coverage.kind !== 'static') reject('coverage_mismatch');
      } else {
        const period = id === 'usda_crop_transitions' ? `${row.year_1}->${row.year_2}` : String(row.year);
        if (id === 'usda_crop_transitions' && row.year_2 !== row.year_1 + 1) reject('transition_year_mismatch');
        if (id === 'usda_crop_classes' && ([0, 255, 999].includes(row.crop_code) || !close(row.area_ha, row.pixel_count * 0.09))) reject('crop_class_area_mismatch');
        addGroup(period, row);
      }
    },
    finish() {
      if (count !== entry.row_count) reject('record_count_mismatch');
      if (!isDeepStrictEqual(nulls, expected.expected_missing_counts)) reject('missing_count_mismatch');
      const coverage = entry.coverage;
      if (id === 'power_monthly') {
        const ids = schema.properties.location_id.enum;
        if (!Array.isArray(ids) || !isDeepStrictEqual([...groups.keys()].sort(), [...ids].sort())) reject('coverage_mismatch');
        for (const rows of groups.values()) {
          monthlyCoverage(rows, coverage);
          if (rows.length !== coverage.months_per_point || rows.some((row) => row.latitude !== rows[0].latitude || row.longitude !== rows[0].longitude)) reject('coverage_mismatch');
        }
      } else if (id === 'modis_monthly') monthlyCoverage(groups.get('monthly') ?? [], coverage);
      else if (id === 'modis_16day') {
        const rows = [...groups.values()].flat(), dates = rows.map((row) => row.date).sort();
        if (dates[0] !== coverage.start || dates.at(-1) !== coverage.end || !Number.isSafeInteger(coverage.observations_per_year)
          || groups.size !== Number(coverage.end.slice(0, 4)) - Number(coverage.start.slice(0, 4)) + 1
          || [...groups.values()].some((rows) => rows.length !== coverage.observations_per_year)) reject('coverage_mismatch');
      } else if (id === 'merra2_context') {
        const latitude = schema.properties.latitude.const, longitudes = schema.properties.longitude.enum;
        if (!Array.isArray(longitudes) || !isDeepStrictEqual([...groups.keys()].sort(), longitudes.map((longitude) => JSON.stringify([latitude, longitude])).sort())) reject('coverage_mismatch');
        for (const rows of groups.values()) { monthlyCoverage(rows, coverage); if (rows.length !== coverage.months_per_cell) reject('coverage_mismatch'); }
      } else if (id.startsWith('usda_')) {
        const declarations = expected.denominator_ha_by_period, tolerance = Number(expected.percentage_tolerance_percentage_points);
        if (!isRecord(declarations) || !Number.isFinite(tolerance) || tolerance < 0
          || !isDeepStrictEqual([...groups.keys()].sort(), Object.keys(declarations).sort())) reject('crop_denominator_declaration_invalid');
        const expectedPeriods = id === 'usda_crop_transitions'
          ? coverage.year_pairs?.map(([a, b]) => `${a}->${b}`)
          : Number.isSafeInteger(coverage.start_year) && Number.isSafeInteger(coverage.end_year) && coverage.end_year >= coverage.start_year && coverage.end_year - coverage.start_year < 1000
            ? Array.from({ length: coverage.end_year - coverage.start_year + 1 }, (_, index) => String(coverage.start_year + index)) : undefined;
        if (!expectedPeriods || !isDeepStrictEqual([...groups.keys()].sort(), [...expectedPeriods].sort())) reject('coverage_mismatch');
        for (const [period, rows] of groups) {
          const denominator = Number(declarations[period]), field = id === 'usda_crop_transitions' ? 'common_valid_area_ha' : 'valid_denominator_ha';
          if (!Number.isFinite(denominator) || denominator <= 0 || !close(rows.reduce((sum, row) => sum + row.area_ha, 0), denominator)
            || rows.some((row) => !close(row[field], denominator) || Math.abs(row.area_pct - 100 * row.area_ha / denominator) > tolerance + 64 * Number.EPSILON * 100)) reject('crop_area_or_percentage_mismatch');
          if (id === 'usda_annual' && !isDeepStrictEqual(rows.map((row) => row.crop_code).sort((a, b) => a - b), [1, 5, 999])) reject('crop_group_mismatch');
          if (id === 'usda_crop_transitions') {
            const labels = ['Corn', 'Soybeans', 'Other'].flatMap((a) => ['Corn', 'Soybeans', 'Other'].map((b) => `${a} -> ${b}`));
            if (!isDeepStrictEqual(rows.map((row) => row.transition_type).sort(), labels.sort())) reject('transition_group_mismatch');
          }
        }
      }
    },
  };
}
