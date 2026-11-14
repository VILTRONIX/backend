import assert from 'node:assert/strict';
import test from 'node:test';
import { createHistoricalAnalytics } from '../src/modules/analytics/historical.analytics.js';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { createEngineService } from '../src/modules/engine/engine.service.js';
import { finalFixture } from './helpers/engine-v1.js';
import { serve, captureLogger } from './helpers/http.js';

const approximately = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
const climateUnits = { T2M_mean: 'C', T2M_MAX_mean: 'C', T2M_MIN_mean: 'C', RH2M_mean: '%',
  PRECTOTCORR_daily_mean: 'mm/day', ALLSKY_SFC_SW_DWN_daily_mean: 'MJ/m^2/day',
  PRECTOTCORR_total: 'mm', ALLSKY_SFC_SW_DWN_total: 'MJ/m^2' };
function powerRow(year, month, values = {}) {
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { year, month, days_expected: days, days_present: days, complete: true, T2M_mean: 10, T2M_MAX_mean: 20,
    T2M_MIN_mean: 5, RH2M_mean: 50, PRECTOTCORR_total: month, ALLSKY_SFC_SW_DWN_total: 2,
    PRECTOTCORR_daily_mean: 1, ALLSKY_SFC_SW_DWN_daily_mean: 3, ...values };
}
function vegetationRow(period, mean, count, total = 10) {
  const row = period.length === 7 ? { month: period, total_pixel_observations: total, observation_count: total / 10 }
    : { date: period, total_pixel_count: total, base_valid_pixel_count: total, quality_valid_pixel_count: count,
      vi_usefulness_distribution_before_filter: JSON.stringify({ 0: total }), vi_usefulness_distribution_after_filter: JSON.stringify({ 0: count }) };
  for (const prefix of ['ndvi', 'evi']) Object.assign(row, {
    [`${prefix}_mean`]: mean, [`${prefix}_median`]: mean, [`${prefix}_std`]: mean === null ? null : 0.1,
    [`${prefix}_valid_pixel_count`]: count, [`${prefix}_valid_pixel_percentage`]: 100 * count / total,
  });
  return row;
}
function cropRows(year, denominator, areas) {
  return [1, 5, 999].map((crop_code, index) => ({ year, crop_code, crop_name: ['Corn', 'Soybeans', 'Other'][index],
    area_ha: areas[index], area_pct: 100 * areas[index] / denominator, valid_denominator_ha: denominator, source: 'SYNTHETIC TEST ONLY' }));
}
function transitionRows(year_1, denominator) {
  const names = ['Corn', 'Soybeans', 'Other'], areas = [10, 20, 0, 30, 15, 0, 5, 0, 20];
  return names.flatMap((from, i) => names.map((to, j) => ({ year_1, year_2: year_1 + 1, transition_type: `${from} -> ${to}`,
    area_ha: areas[i * 3 + j] * denominator / 100, area_pct: areas[i * 3 + j], common_valid_area_ha: denominator })));
}
function evidence() {
  const soil = [
    { mukey: '001', awc_weighted_cm_per_cm: 0.1, organic_matter_weighted_pct: 1, slope_weighted_pct: 2,
      dominant_drainage_class: 'Well drained', dominant_hydrologic_group: 'A', root_zone_aws_0_150cm_mm: null },
    { mukey: '002', awc_weighted_cm_per_cm: 0.3, organic_matter_weighted_pct: 3, slope_weighted_pct: 6,
      dominant_drainage_class: 'Well drained', dominant_hydrologic_group: 'B', root_zone_aws_0_150cm_mm: null },
    { mukey: '003', awc_weighted_cm_per_cm: null, organic_matter_weighted_pct: null, slope_weighted_pct: 0,
      dominant_drainage_class: null, dominant_hydrologic_group: null, root_zone_aws_0_150cm_mm: null },
  ];
  const soilUnits = { awc_weighted_cm_per_cm: 'cm/cm', organic_matter_weighted_pct: '%', slope_weighted_pct: '%', root_zone_aws_0_150cm_mm: 'mm' };
  return {
    selectedPeriod: { startYear: 2020, endYear: 2021 },
    currentRotation: {
      annualCropDistribution: { years: [{ year: 2020, records: cropRows(2020, 100, [50, 30, 20]) },
        { year: 2021, records: cropRows(2021, 200, [100, 40, 60]) }] },
      observedTransitions: { datasetId: 'usda_crop_transitions', yearPairs: [{ year_1: 2020, year_2: 2021, records: transitionRows(2020, 100) }] },
    },
    waterFirst: {
      power: { locations: [{ location_id: 'SYNTHETIC-A', latitude: 1, longitude: 2, records: [powerRow(2020, 1), powerRow(2020, 2, { T2M_mean: 20 })] }] },
      modisMonthly: { records: [vegetationRow('2020-01', 0.2, 2), vegetationRow('2020-02', 0.6, 6, 30), vegetationRow('2020-03', null, 0)] },
      modis16day: { records: [vegetationRow('2020-01-01', 0.1, 2), vegetationRow('2020-01-17', null, 0), vegetationRow('2020-02-02', 0.9, 8)] },
    },
    soilFirst: { mapUnits: { records: soil } }, merra2Context: { status: 'not_requested' },
    datasetProvenance: {
      power_monthly: { metadata: { fields: Object.fromEntries(Object.entries(climateUnits).map(([field, unit]) => [field, { type: 'number', unit }])) } },
      modis_monthly: { metadata: { fields: { ndvi_mean: { unit: 'dimensionless' }, evi_mean: { unit: 'dimensionless' } } } },
      modis_16day: { metadata: { fields: { ndvi_mean: { unit: 'dimensionless' }, evi_mean: { unit: 'dimensionless' } }, coverage: { observations_per_year: 23 } } },
      soil_map_units: { metadata: { fields: Object.fromEntries(Object.keys(soil[0]).map((field) => [field,
        { type: Object.hasOwn(soilUnits, field) ? ['number', 'null'] : ['string', 'null'], unit: soilUnits[field] ?? null }])) } },
    },
    missingValues: { soil_map_units: { selectedRecordCount: soil.length,
      nullCounts: Object.fromEntries(Object.keys(soil[0]).map((field) => [field, soil.filter((row) => row[field] === null).length])) } },
  };
}

test('POWER partial-year means use observed days and expose every incomplete or missing month', () => {
  const input = evidence(), february = input.waterFirst.power.locations[0].records[1];
  february.days_present = 20; february.complete = false;
  const annual = createHistoricalAnalytics(input).climate.locations[0].annual[0];
  assert.equal(annual.completeness.expectedDayCount, 366);
  assert.equal(annual.completeness.observedDayCount, 51);
  assert.deepEqual(annual.completeness.missingMonths, [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(annual.completeness.incompleteMonths, [2]);
  approximately(annual.completeness.observedDayPercentage, 100 * 51 / 366);
  approximately(annual.metrics.T2M_mean.observedValue, (10 * 31 + 20 * 20) / 51);
  assert.equal(annual.metrics.T2M_mean.value, null);
  assert.equal(annual.metrics.T2M_mean.sampleCount, 2);
  assert.equal(annual.metrics.T2M_mean.weightSumDays, 51);
  assert.equal(annual.metrics.PRECTOTCORR_total.observedValue, 3);
  assert.equal(annual.metrics.PRECTOTCORR_total.value, null);
  assert.equal(annual.metrics.PRECTOTCORR_total.status, 'partial');
});

test('full annual climate calculations respect leap calendars, source units, sums, and weighted means', () => {
  for (const [year, days, februaryDays] of [[2020, 366, 29], [2021, 365, 28], [1900, 365, 28], [2000, 366, 29]]) {
    const input = evidence(); input.selectedPeriod = { startYear: year, endYear: year };
    input.waterFirst.power.locations[0].records = Array.from({ length: 12 }, (_, i) => powerRow(year, i + 1, { T2M_mean: i === 1 ? 20 : 10 }));
    const annual = createHistoricalAnalytics(input).climate.locations[0].annual[0];
    assert.equal(annual.completeness.status, 'complete'); assert.equal(annual.completeness.observedDayCount, days);
    approximately(annual.metrics.T2M_mean.value, (10 * (days - februaryDays) + 20 * februaryDays) / days);
    assert.equal(annual.metrics.T2M_MAX_mean.value, 20); assert.equal(annual.metrics.T2M_MIN_mean.value, 5);
    assert.equal(annual.metrics.RH2M_mean.value, 50); assert.equal(annual.metrics.PRECTOTCORR_total.value, 78);
    assert.equal(annual.metrics.ALLSKY_SFC_SW_DWN_total.value, 24);
    assert.equal(annual.metrics.PRECTOTCORR_daily_mean.value, 1); assert.equal(annual.metrics.ALLSKY_SFC_SW_DWN_daily_mean.value, 3);
    for (const [field, unit] of Object.entries(climateUnits)) {
      assert.equal(annual.metrics[field].unit, unit); assert.equal(annual.metrics[field].datasetId, 'power_monthly');
      assert.equal(annual.metrics[field].sampleCount, 12); assert.equal(annual.metrics[field].missingValueCount, 0);
    }
  }
});

test('POWER locations stay separate and year-over-year changes require consecutive complete calendar years', () => {
  const input = evidence(); input.selectedPeriod = { startYear: 2020, endYear: 2023 };
  input.waterFirst.power.locations = ['A', 'B', 'C', 'D'].map((id, offset) => ({ location_id: `SYNTHETIC-${id}`, latitude: offset, longitude: offset,
    records: [2020, 2021, 2023].flatMap((year) => Array.from({ length: 12 }, (_, i) => powerRow(year, i + 1,
      { T2M_mean: year - 2020 + offset, RH2M_mean: 50 + year - 2020, PRECTOTCORR_total: year - 2019 }))) }));
  const climate = createHistoricalAnalytics(input).climate;
  assert.equal(climate.locations.length, 4); assert.equal(climate.spatialAggregation, 'none');
  for (const [offset, point] of climate.locations.entries()) {
    assert.equal(point.annual[0].metrics.T2M_mean.value, offset);
    assert.equal(point.yearOverYear[1].metrics.T2M_mean.value, 1);
    assert.equal(point.yearOverYear[1].metrics.PRECTOTCORR_total.value, 12);
    assert.equal(point.yearOverYear[1].metrics.RH2M_mean.unit, 'percentage_points');
    assert.equal(point.yearOverYear[1].metrics.RH2M_mean.value, 1);
    assert.equal(point.yearOverYear[0].metrics.T2M_mean.value, null);
    assert.equal(point.yearOverYear[2].metrics.T2M_mean.value, null);
    assert.equal(point.yearOverYear[2].previousYear, 2022);
    assert.deepEqual(point.missingYearRanges, [{ startYear: 2022, endYear: 2022 }]);
  }
});

test('missing climate values and unusable day weights remain explicit instead of becoming zero', () => {
  const input = evidence(), records = input.waterFirst.power.locations[0].records;
  records[0].T2M_mean = null;
  records[1].days_present = 0; records[1].complete = false;
  const metric = createHistoricalAnalytics(input).climate.locations[0].annual[0].metrics.T2M_mean;
  assert.equal(metric.value, null); assert.equal(metric.observedValue, null); assert.equal(metric.missingValueCount, 1);
  assert.equal(metric.unusableWeightCount, 1); assert.equal(metric.sampleCount, 0);
  delete input.datasetProvenance.power_monthly.metadata.fields.T2M_mean;
  assert.equal(createHistoricalAnalytics(input).climate.locations[0].annual[0].metrics.T2M_mean.status, 'source_field_unavailable');
});

test('incomplete annual climate values cannot silently enter year-over-year comparisons', () => {
  const input = evidence();
  input.waterFirst.power.locations[0].records = [2020, 2021].flatMap((year) => Array.from({ length: 12 }, (_, i) => powerRow(year, i + 1)));
  input.waterFirst.power.locations[0].records[2].T2M_mean = null;
  const annual = createHistoricalAnalytics(input).climate.locations[0];
  assert.equal(annual.annual[0].metrics.T2M_mean.status, 'partial');
  assert.equal(annual.annual[0].metrics.T2M_mean.missingValueCount, 1);
  assert.equal(annual.yearOverYear[1].metrics.T2M_mean.value, null);
  assert.equal(annual.yearOverYear[1].metrics.T2M_mean.status, 'incomplete_or_missing_annual_value');
  assert.equal(annual.yearOverYear[1].metrics.PRECTOTCORR_total.value, 0);
});

test('MODIS annual weighted means and percentages use pixel-observation denominators independently by resolution', () => {
  const analytics = createHistoricalAnalytics(evidence()).vegetation;
  const monthly = analytics.monthly.annual[0], composite = analytics.composites16day.annual[0];
  for (const index of ['ndvi', 'evi']) {
    approximately(monthly.indices[index].mean, 0.5);
    approximately(composite.indices[index].mean, 0.74);
    assert.equal(monthly.indices[index].contributingPixelObservations, 8);
    assert.equal(monthly.indices[index].possiblePixelObservations, 50);
    assert.equal(monthly.indices[index].validPixelPercentage, 16);
    approximately(monthly.indices[index].validObservationPercentage, 200 / 3);
    assert.equal(monthly.indices[index].availablePeriodCount, 2); assert.equal(monthly.indices[index].nullPeriodCount, 1);
    assert.equal(monthly.indices[index].minimumPeriodMean, 0.2); assert.equal(monthly.indices[index].maximumPeriodMean, 0.6);
    assert.equal(monthly.indices[index].unit, 'dimensionless');
  }
  assert.equal(monthly.expectedRecordCount, 12); assert.equal(monthly.missingRecordCount, 9);
  assert.equal(composite.expectedRecordCount, 23); assert.equal(composite.missingRecordCount, 20);
  assert.equal(analytics.monthly.missingRecordCount, 21); assert.equal(analytics.composites16day.missingRecordCount, 43);
});

test('MODIS calendar-month summaries use each selected year as an expected record and preserve source summary references', () => {
  const input = evidence(); input.waterFirst.modisMonthly.records.push(vegetationRow('2021-01', 0.8, 8));
  const monthly = createHistoricalAnalytics(input).vegetation.monthly;
  const january = monthly.calendarMonths.find((row) => row.month === 1), february = monthly.calendarMonths.find((row) => row.month === 2);
  approximately(january.indices.ndvi.mean, 0.68); assert.equal(january.expectedRecordCount, 2); assert.equal(january.missingRecordCount, 0);
  assert.equal(february.missingRecordCount, 1);
  assert.equal(monthly.monthlySummariesPath, 'waterFirst.modisMonthly.records');
  assert.equal(monthly.periodAvailabilityPath, 'waterFirst.modisMonthly.observationCounts');
  assert.equal(monthly.qaEvidencePath, 'waterFirst.modisMonthly.records');
});

test('EVI uses its own supplied values and an undeclared composite cadence stays unknown', () => {
  const input = evidence();
  input.waterFirst.modisMonthly.records[0].evi_mean = 0.1;
  input.waterFirst.modisMonthly.records[1].evi_mean = 0.3;
  delete input.datasetProvenance.modis_16day.metadata.coverage.observations_per_year;
  const vegetation = createHistoricalAnalytics(input).vegetation;
  approximately(vegetation.monthly.annual[0].indices.ndvi.mean, 0.5);
  approximately(vegetation.monthly.annual[0].indices.evi.mean, 0.25);
  assert.equal(vegetation.composites16day.expectedRecordCount, null);
  assert.equal(vegetation.composites16day.missingRecordCount, null);
  assert.equal(vegetation.composites16day.annual[0].expectedRecordCount, null);
});

test('real zero climate and vegetation values remain available and are distinct from missing observations', () => {
  const input = evidence();
  input.waterFirst.power.locations[0].records = Array.from({ length: 12 }, (_, i) => powerRow(2020, i + 1, { T2M_mean: 0, PRECTOTCORR_total: 0 }));
  input.waterFirst.modisMonthly.records = [vegetationRow('2020-01', 0, 2)];
  const analytics = createHistoricalAnalytics(input), annual = analytics.climate.locations[0].annual[0];
  assert.equal(annual.metrics.PRECTOTCORR_total.value, 0); assert.equal(annual.metrics.PRECTOTCORR_total.sampleCount, 12);
  assert.equal(annual.metrics.T2M_mean.value, 0); assert.equal(annual.metrics.T2M_mean.missingValueCount, 0);
  const ndvi = analytics.vegetation.monthly.annual[0].indices.ndvi;
  assert.equal(ndvi.mean, 0); assert.equal(ndvi.minimumPeriodMean, 0); assert.equal(ndvi.validObservationPercentage, 100);
  assert.equal(ndvi.nullPeriodCount, 0);
});

test('all-null MODIS periods yield null means, zero valid percentages, and explicit missingness', () => {
  const input = evidence(); input.waterFirst.modisMonthly.records = [vegetationRow('2020-01', null, 0)];
  const result = createHistoricalAnalytics(input).vegetation.monthly.annual[0].indices;
  for (const index of ['ndvi', 'evi']) {
    assert.equal(result[index].mean, null); assert.equal(result[index].minimumPeriodMean, null);
    assert.equal(result[index].validObservationPercentage, 0); assert.equal(result[index].validPixelPercentage, 0);
    assert.equal(result[index].nullPeriodCount, 1); assert.equal(result[index].contributingPeriodCount, 0);
  }
});

test('16-day differences retain actual date intervals and never bridge a null mean or mutate QA', () => {
  const input = evidence();
  input.waterFirst.modis16day.records.push(vegetationRow('2020-03-05', 0.5, 5));
  input.waterFirst.modis16day.records.reverse();
  const before = JSON.stringify(input), composite = createHistoricalAnalytics(input).vegetation.composites16day;
  const changes = composite.changesBetweenConsecutiveRecords;
  assert.equal(changes[0].previousDate, null); assert.equal(changes[0].ndviChange, null);
  assert.equal(changes[1].ndviChange, null); assert.equal(changes[2].ndviChange, null);
  assert.equal(changes[1].elapsedDays, 16); assert.equal(changes[3].elapsedDays, 32);
  approximately(changes[3].ndviChange, -0.4); approximately(changes[3].eviChange, -0.4);
  assert.equal(JSON.stringify(input), before);
  assert.equal(composite.qaEvidencePath, 'waterFirst.modis16day.records');
});

test('crop area and percentage-point differences retain different annual denominators and corn/soybean codes', () => {
  const crops = createHistoricalAnalytics(evidence()).crops;
  assert.deepEqual(crops.focusCropCodes, [1, 5]);
  const corn = crops.annualChanges[1].crops.find((row) => row.crop_code === 1);
  const soy = crops.annualChanges[1].crops.find((row) => row.crop_code === 5);
  assert.equal(corn.currentValidDenominatorHa, 200); assert.equal(corn.previousValidDenominatorHa, 100);
  assert.equal(corn.areaChangeHa, 50); assert.equal(corn.percentagePointChange, 0);
  assert.equal(soy.areaChangeHa, 10); assert.equal(soy.percentagePointChange, -10);
  assert.equal(corn.sampleCount, 2); assert.equal(crops.annualChanges[0].crops[0].areaChangeHa, null);
  assert.equal(crops.cropClasses.distributionPath, 'currentRotation.cropClassDistribution.years');
  assert.equal(crops.units.percentagePointChange, 'percentage_points');
});

test('missing crop rows are not zero and missing calendar years are not skipped for comparisons', () => {
  const input = evidence(); input.currentRotation.annualCropDistribution.years[1].records.shift();
  let crops = createHistoricalAnalytics(input).crops;
  const corn = crops.annualChanges[1].crops.find((row) => row.crop_code === 1);
  assert.equal(corn.currentAreaHa, null); assert.equal(corn.areaChangeHa, null); assert.equal(corn.percentagePointChange, null);
  input.currentRotation.annualCropDistribution.years[1] = { year: 2022, records: cropRows(2022, 100, [80, 10, 10]) };
  crops = createHistoricalAnalytics(input).crops;
  assert.equal(crops.annualChanges[1].previousYear, 2021);
  assert.equal(crops.annualChanges[1].status, 'previous_year_unavailable');
  assert.equal(crops.annualChanges[1].crops[0].areaChangeHa, null);
});

test('zero crop area retains a valid change and keeps the original source percentage denominator', () => {
  const input = evidence();
  input.currentRotation.annualCropDistribution.years[1].records = cropRows(2021, 200, [0, 100, 100]);
  const corn = createHistoricalAnalytics(input).crops.annualChanges[1].crops.find((row) => row.crop_code === 1);
  assert.equal(corn.currentAreaHa, 0); assert.equal(corn.areaChangeHa, -50);
  assert.equal(corn.percentagePointChange, -50); assert.equal(corn.currentValidDenominatorHa, 200);
  assert.equal(corn.status, 'available'); assert.equal(corn.sampleCount, 2);
});

test('transition summaries use each original year-pair denominator and grouped labels without field histories', () => {
  const input = evidence(); input.currentRotation.observedTransitions.yearPairs.push({ year_1: 2021, year_2: 2022, records: transitionRows(2021, 200) });
  const pairs = createHistoricalAnalytics(input).crops.transitions.yearPairs;
  assert.equal(pairs[0].commonValidAreaHa, 100); assert.equal(pairs[1].commonValidAreaHa, 200);
  assert.equal(pairs[0].categories.same_group.areaHa, 45); assert.equal(pairs[1].categories.same_group.areaHa, 90);
  for (const pair of pairs) {
    assert.equal(pair.totalTransitionAreaHa, pair.commonValidAreaHa);
    assert.equal(pair.categories.same_group.percentageOfCommonValidArea, 45);
    assert.equal(pair.categories.different_group.percentageOfCommonValidArea, 55);
    assert.equal(pair.categories.same_group.sourceRecordCount, 3); assert.equal(pair.sourceRecordCount, 9);
  }
});

test('soil null distributions reuse existing counts and numerical summaries are unweighted map-unit samples', () => {
  const soil = createHistoricalAnalytics(evidence()).soil, awc = soil.attributes.awc_weighted_cm_per_cm;
  assert.equal(soil.spatialWeighting, 'none'); assert.equal(soil.temporalScope, 'static');
  assert.equal(awc.nullCount, 1); approximately(awc.nullPercentage, 100 / 3);
  approximately(awc.summary.mean, 0.2); approximately(awc.summary.median, 0.2);
  assert.equal(awc.summary.minimum, 0.1); assert.equal(awc.summary.maximum, 0.3); assert.equal(awc.summary.sampleCount, 2);
  assert.equal(awc.summary.method, 'unweighted_across_map_units'); assert.equal(awc.unit, 'cm/cm');
  assert.equal(soil.attributes.organic_matter_weighted_pct.summary.mean, 2);
  assert.equal(soil.attributes.slope_weighted_pct.summary.median, 2);
  assert.equal(soil.attributes.root_zone_aws_0_150cm_mm.nullPercentage, 100);
  assert.equal(soil.attributes.root_zone_aws_0_150cm_mm.summary.mean, null);
  assert.equal(soil.attributes.root_zone_aws_0_150cm_mm.summary.sampleCount, 0);
  const drainage = soil.attributes.dominant_drainage_class.distribution[0];
  assert.equal(drainage.value, 'Well drained'); assert.equal(drainage.count, 2);
  assert.equal(drainage.percentageOfAvailableMapUnits, 100); approximately(drainage.percentageOfAllMapUnits, 200 / 3);
  assert.deepEqual(soil.attributes.dominant_hydrologic_group.distribution.map((row) => [row.value, row.count]), [['A', 1], ['B', 1]]);
});

test('empty selections have explicit calendar gaps and no fabricated zero-valued source observations', () => {
  const input = evidence(); input.waterFirst.power.locations = [];
  input.waterFirst.modisMonthly.records = []; input.waterFirst.modis16day.records = [];
  input.currentRotation.annualCropDistribution.years = []; input.currentRotation.observedTransitions.yearPairs = [];
  input.soilFirst.mapUnits.records = []; input.missingValues.soil_map_units = { selectedRecordCount: 0, nullCounts: {} };
  const analytics = createHistoricalAnalytics(input);
  assert.equal(analytics.climate.status, 'no_records_in_period');
  assert.equal(analytics.vegetation.monthly.missingRecordCount, 24); assert.equal(analytics.vegetation.composites16day.missingRecordCount, 46);
  assert.deepEqual(analytics.vegetation.monthly.annual, []);
  assert.deepEqual(analytics.vegetation.monthly.missingYearRanges, [{ startYear: 2020, endYear: 2021 }]);
  assert.deepEqual(analytics.crops.annualChanges, []); assert.deepEqual(analytics.crops.transitions.yearPairs, []);
  assert.equal(analytics.soil.attributes.awc_weighted_cm_per_cm.nullPercentage, null);
  assert.equal(analytics.soil.attributes.awc_weighted_cm_per_cm.summary.mean, null);
});

test('unvalidated numeric strings and non-finite values fail instead of being silently coerced', () => {
  for (const value of ['10', Number.NaN, Number.POSITIVE_INFINITY]) {
    const input = evidence(); input.waterFirst.power.locations[0].records[0].T2M_mean = value;
    assert.throws(() => createHistoricalAnalytics(input), /validated numeric/);
  }
});

test('analytics calculations are stateless and do not mutate the comparison evidence', () => {
  const input = evidence(), before = structuredClone(input), first = createHistoricalAnalytics(input);
  first.soil.attributes.awc_weighted_cm_per_cm.summary.mean = 999;
  first.climate.locations[0].annual[0].metrics.T2M_mean.observedValue = 999;
  assert.deepEqual(input, before);
  assert.notEqual(createHistoricalAnalytics(input).soil.attributes.awc_weighted_cm_per_cm.summary.mean, 999);
});

test('comparison API adds analytics without extra Engine reads or changes to source records and query conventions', async (t) => {
  const fixture = await finalFixture(t), underlying = createEngineService({ engineRoot: fixture.root });
  const calls = [], engineService = { ...underlying, readDataset(id, query) { calls.push(id); return underlying.readDataset(id, query); } };
  const database = { isReady: () => false, getStatus: () => ({ configured: false, ready: false, status: 'unconfigured' }),
    getConnection() { throw new Error('Historical analytics must not use MongoDB.'); } };
  const base = await serve(createApp({ config: parseEnv({ TERRAPULSE_ENGINE_ROOT: fixture.root }), database, engineService, logger: captureLogger() }), t);
  const url = `${base}/api/v1/scenarios/comparison`;
  const response = await fetch(`${url}?startYear=2020&endYear=2020`), body = await response.json(), data = body.data;
  assert.equal(response.status, 200); assert.equal(body.success, true); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-request-id'), body.requestId); assert.equal(calls.length, 7);
  assert.equal(data.descriptiveAnalytics.classification, 'derived_descriptive_statistics');
  assert.deepEqual(data.selectedPeriod, { startYear: 2020, endYear: 2020 });
  assert.equal(data.descriptiveAnalytics.climate.locations.length, 2);
  assert.equal(data.descriptiveAnalytics.climate.locations[0].annual[0].metrics.T2M_mean.status, 'source_field_unavailable');
  assert.deepEqual(data.waterFirst.modisMonthly.records, fixture.forLogicalId('modis_monthly').rows);
  assert.deepEqual(data.waterFirst.modis16day.records, [fixture.forLogicalId('modis_16day').rows[0]]);
  assert.equal(data.descriptiveAnalytics.vegetation.composites16day.annual[0].presentRecordCount, 1);
  assert.deepEqual(data.descriptiveAnalytics.crops.transitions.yearPairs, []);
  assert.equal(data.descriptiveAnalytics.soil.attributes.root_zone_aws_0_150cm_mm.nullPercentage, 100);
  assert.equal(data.metadata.scientificEvaluationStatus, 'not_implemented'); assert.equal(data.metadata.recommendationGenerationEnabled, false);
  assert.equal(data.descriptiveAnalytics.merra2.status, 'not_requested');
  const defaultBody = await (await fetch(url)).json();
  assert.deepEqual(defaultBody.data.selectedPeriod, { startYear: 2021, endYear: 2025 });
  assert.deepEqual(defaultBody.data.descriptiveAnalytics.climate.locations, []);
  const context = await (await fetch(`${url}?startYear=2020&endYear=2021&includeMerra2=true`)).json();
  assert.equal(context.data.descriptiveAnalytics.merra2.status, 'available'); assert.equal(context.data.merra2Context.cells.length, 2);
  assert.equal(context.data.descriptiveAnalytics.crops.transitions.yearPairs.length, 1);
  const invalid = await fetch(`${url}?startYear=2021&endYear=2020`);
  assert.equal(invalid.status, 400); assert.equal((await invalid.json()).error.code, 'INVALID_COMPARISON_QUERY');
});
