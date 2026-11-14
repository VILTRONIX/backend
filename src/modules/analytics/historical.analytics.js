// Pure descriptive calculations over an already validated Scenario Comparison.
// No filesystem, database, loader, or scientific evaluation dependency.
const CLIMATE_FIELDS = {
  T2M_mean: 'day_weighted_mean', T2M_MAX_mean: 'day_weighted_mean', T2M_MIN_mean: 'day_weighted_mean',
  RH2M_mean: 'day_weighted_mean', PRECTOTCORR_daily_mean: 'day_weighted_mean',
  ALLSKY_SFC_SW_DWN_daily_mean: 'day_weighted_mean',
  PRECTOTCORR_total: 'sum_monthly_totals', ALLSKY_SFC_SW_DWN_total: 'sum_monthly_totals',
};
const SOIL_CATEGORIES = ['dominant_texture', 'dominant_drainage_class', 'dominant_hydrologic_group'];
const sum = (values) => values.reduce((total, value) => total + value, 0);
const percent = (count, denominator) => denominator > 0 ? 100 * count / denominator : null;
const present = (value) => value !== null && value !== undefined;
function number(value) {
  if (!present(value)) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('Historical analytics require validated numeric source values.');
  return value;
}
function by(records, key) {
  const groups = new Map();
  for (const record of records) {
    const value = key(record);
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(record);
  }
  return groups;
}
const sorted = (groups) => [...groups].sort(([a], [b]) => a - b);
const leapYear = (year) => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
function absentYearRanges(years, period) {
  const ranges = []; let start;
  for (let year = period.startYear; year <= period.endYear + 1; year += 1) {
    if (year <= period.endYear && !years.has(year)) start ??= year;
    else if (start !== undefined) { ranges.push({ startYear: start, endYear: year - 1 }); start = undefined; }
  }
  return ranges;
}
function source(evidence, id, field) {
  return { datasetId: id, sourceField: field, unit: evidence.datasetProvenance[id].metadata.fields[field]?.unit ?? null };
}
function difference(current, previous) {
  current = number(current); previous = number(previous);
  return current === null || previous === null ? null : current - previous;
}

function climateAnalytics(evidence) {
  const id = 'power_monthly', fields = evidence.datasetProvenance[id].metadata.fields;
  const locations = evidence.waterFirst.power.locations.map((location) => {
    const annual = sorted(by(location.records, (row) => row.year)).map(([year, rows]) => {
      const months = new Set(rows.map((row) => row.month));
      const expectedDays = leapYear(year) ? 366 : 365;
      const observedDays = sum(rows.map((row) => number(row.days_present)));
      const missingMonths = Array.from({ length: 12 }, (_, index) => index + 1).filter((month) => !months.has(month));
      const incompleteMonths = rows.filter((row) => !row.complete).map((row) => row.month).sort((a, b) => a - b);
      const complete = !missingMonths.length && !incompleteMonths.length && observedDays === expectedDays;
      const completeness = {
        expectedMonthCount: 12, presentMonthCount: rows.length, missingMonths, incompleteMonths,
        expectedDayCount: expectedDays, observedDayCount: observedDays, missingDayCount: expectedDays - observedDays,
        observedDayPercentage: percent(observedDays, expectedDays), status: complete ? 'complete' : 'partial',
      };
      const metrics = {};
      for (const [field, method] of Object.entries(CLIMATE_FIELDS)) {
        const declared = Object.hasOwn(fields, field);
        const available = rows.filter((row) => declared && number(row[field]) !== null);
        const contributing = available.filter((row) => method === 'sum_monthly_totals' || row.days_present > 0);
        const weightSumDays = method === 'day_weighted_mean' ? sum(contributing.map((row) => row.days_present)) : null;
        const observedValue = !contributing.length ? null : method === 'sum_monthly_totals'
          ? sum(contributing.map((row) => row[field])) : sum(contributing.map((row) => row[field] * row.days_present)) / weightSumDays;
        const full = complete && contributing.length === 12;
        metrics[field] = {
          ...source(evidence, id, field), method, value: full ? observedValue : null, observedValue,
          sampleCount: contributing.length, missingValueCount: rows.length - available.length,
          unusableWeightCount: available.length - contributing.length, weightSumDays,
          status: !declared ? 'source_field_unavailable' : observedValue === null ? 'unavailable' : full ? 'complete' : 'partial',
        };
      }
      return { year, completeness, metrics };
    });
    const years = new Map(annual.map((row) => [row.year, row]));
    const yearOverYear = annual.map((current) => {
      const previous = years.get(current.year - 1);
      const metrics = Object.fromEntries(Object.keys(CLIMATE_FIELDS).map((field) => {
        const a = current.metrics[field], b = previous?.metrics[field];
        const value = difference(a.value, b?.value);
        return [field, { ...source(evidence, id, field), method: 'current_minus_previous_calendar_year',
          unit: field === 'RH2M_mean' ? 'percentage_points' : a.unit, value,
          sampleCount: Number(present(a.value)) + Number(present(b?.value)),
          status: !previous ? 'previous_year_unavailable' : value === null ? 'incomplete_or_missing_annual_value' : 'available' }];
      }));
      return { year: current.year, previousYear: current.year - 1, metrics };
    });
    return { location_id: location.location_id, latitude: location.latitude, longitude: location.longitude,
      missingYearRanges: absentYearRanges(years, evidence.selectedPeriod), annual, yearOverYear };
  });
  return { datasetId: id, evidencePath: 'waterFirst.power', locations,
    status: locations.length ? 'available' : 'no_records_in_period', spatialAggregation: 'none' };
}

function vegetationSummary(evidence, id, rows, expectedRecordCount, totalField) {
  const possible = rows.map((row) => number(row[totalField]));
  const possiblePixelObservations = possible.some((value) => value === null) ? null : sum(possible);
  const indices = {};
  for (const index of ['ndvi', 'evi']) {
    const field = `${index}_mean`, countField = `${index}_valid_pixel_count`;
    const available = rows.filter((row) => number(row[field]) !== null);
    const weighted = available.filter((row) => number(row[countField]) > 0);
    const contributingPixelObservations = sum(weighted.map((row) => row[countField]));
    const counts = rows.map((row) => number(row[countField]));
    const validPixelObservations = counts.some((value) => value === null) ? null : sum(counts);
    indices[index] = {
      ...source(evidence, id, field), method: 'valid_pixel_observation_weighted_mean',
      mean: contributingPixelObservations ? sum(weighted.map((row) => row[field] * row[countField])) / contributingPixelObservations : null,
      minimumPeriodMean: available.length ? Math.min(...available.map((row) => row[field])) : null,
      maximumPeriodMean: available.length ? Math.max(...available.map((row) => row[field])) : null,
      availablePeriodCount: available.length, nullPeriodCount: rows.length - available.length,
      contributingPeriodCount: weighted.length, unusableWeightCount: available.length - weighted.length,
      validObservationPercentage: percent(available.length, rows.length),
      contributingPixelObservations, validPixelObservations, possiblePixelObservations,
      validPixelPercentage: validPixelObservations === null || possiblePixelObservations === null ? null : percent(validPixelObservations, possiblePixelObservations),
      weightField: countField, pixelPercentageDenominatorField: totalField,
    };
  }
  return { presentRecordCount: rows.length, expectedRecordCount,
    missingRecordCount: expectedRecordCount === null ? null : expectedRecordCount - rows.length, indices };
}

function vegetationAnalytics(evidence) {
  function resolution(id, section, totalField, expectedPerYear) {
    const series = evidence.waterFirst[section], rows = series.records;
    const years = by(rows, (row) => Number((row.month ?? row.date).slice(0, 4)));
    const annual = sorted(years).map(([year, records]) => ({ year,
      ...vegetationSummary(evidence, id, records, expectedPerYear, totalField) }));
    const requestedYearCount = evidence.selectedPeriod.endYear - evidence.selectedPeriod.startYear + 1;
    return {
      datasetId: id, evidencePath: `waterFirst.${section}.records`, qaEvidencePath: `waterFirst.${section}.records`,
      periodAvailabilityPath: `waterFirst.${section}.observationCounts`,
      expectedRecordCount: expectedPerYear === null ? null : requestedYearCount * expectedPerYear,
      missingRecordCount: expectedPerYear === null ? null : requestedYearCount * expectedPerYear - rows.length,
      missingYearRanges: absentYearRanges(years, evidence.selectedPeriod), annual,
    };
  }
  const monthly = resolution('modis_monthly', 'modisMonthly', 'total_pixel_observations', 12);
  const expected = evidence.datasetProvenance.modis_16day.metadata.coverage.observations_per_year ?? null;
  const composites16day = resolution('modis_16day', 'modis16day', 'total_pixel_count', expected);
  monthly.monthlySummariesPath = 'waterFirst.modisMonthly.records';
  monthly.calendarMonths = sorted(by(evidence.waterFirst.modisMonthly.records, (row) => Number(row.month.slice(5, 7))))
    .map(([month, rows]) => ({ month, ...vegetationSummary(evidence, 'modis_monthly', rows,
      evidence.selectedPeriod.endYear - evidence.selectedPeriod.startYear + 1, 'total_pixel_observations') }));
  // Differences between adjacent source records, never a fitted or causal trend.
  const records = [...evidence.waterFirst.modis16day.records].sort((a, b) => a.date.localeCompare(b.date));
  composites16day.changesBetweenConsecutiveRecords = records.map((row, index) => {
    const previous = records[index - 1];
    return { date: row.date, previousDate: previous?.date ?? null,
      elapsedDays: previous ? (Date.parse(`${row.date}T00:00:00Z`) - Date.parse(`${previous.date}T00:00:00Z`)) / 86400000 : null,
      ndviChange: difference(row.ndvi_mean, previous?.ndvi_mean), eviChange: difference(row.evi_mean, previous?.evi_mean),
      comparisonAvailable: { ndvi: present(row.ndvi_mean) && present(previous?.ndvi_mean), evi: present(row.evi_mean) && present(previous?.evi_mean) },
    };
  });
  composites16day.changeMethod = { method: 'current_minus_previous_source_record', sourceFields: ['ndvi_mean', 'evi_mean'], unit: 'dimensionless',
    missingValueHandling: 'A missing mean at either endpoint gives a null change; gaps are not interpolated. elapsedDays is the actual source-date interval.' };
  return { monthly, composites16day };
}

function cropAnalytics(evidence) {
  const groups = evidence.currentRotation.annualCropDistribution.years;
  const years = new Map(groups.map((group) => [group.year, group.records]));
  const annualChanges = [...groups].sort((a, b) => a.year - b.year).map(({ year, records }) => {
    const previous = years.get(year - 1), previousCrops = new Map((previous ?? []).map((row) => [row.crop_code, row]));
    const currentCrops = new Map(records.map((row) => [row.crop_code, row]));
    const codes = new Set([...currentCrops.keys(), ...previousCrops.keys()]);
    return { year, previousYear: year - 1, status: previous ? 'available' : 'previous_year_unavailable',
      crops: [...codes].sort((a, b) => a - b).map((crop_code) => {
        const current = currentCrops.get(crop_code), before = previousCrops.get(crop_code);
        return { crop_code, crop_name: current?.crop_name ?? before.crop_name,
          currentAreaHa: current?.area_ha ?? null, previousAreaHa: before?.area_ha ?? null,
          areaChangeHa: difference(current?.area_ha, before?.area_ha),
          currentAreaPercentage: current?.area_pct ?? null, previousAreaPercentage: before?.area_pct ?? null,
          percentagePointChange: difference(current?.area_pct, before?.area_pct),
          currentValidDenominatorHa: current?.valid_denominator_ha ?? null, previousValidDenominatorHa: before?.valid_denominator_ha ?? null,
          sampleCount: Number(Boolean(current)) + Number(Boolean(before)),
          status: current && before ? 'available' : 'missing_comparison_record',
        };
      }),
    };
  });
  const transitions = evidence.currentRotation.observedTransitions;
  const yearPairs = transitions.yearPairs.map(({ year_1, year_2, records }) => {
    const denominator = records[0].common_valid_area_ha;
    const categories = Object.fromEntries(['same_group', 'different_group'].map((category) => {
      const selected = records.filter((row) => {
        const [from, to] = row.transition_type.split(' -> ');
        return (from === to) === (category === 'same_group');
      });
      const areaHa = sum(selected.map((row) => number(row.area_ha)));
      return [category, { areaHa, percentageOfCommonValidArea: percent(areaHa, denominator), sourceRecordCount: selected.length }];
    }));
    return { year_1, year_2, sourceRecordCount: records.length, commonValidAreaHa: denominator,
      totalTransitionAreaHa: sum(records.map((row) => number(row.area_ha))), categories };
  });
  return {
    datasetId: 'usda_annual', annualDistributionPath: 'currentRotation.annualCropDistribution.years', focusCropCodes: [1, 5],
    changeMethod: 'Current minus previous calendar year within the selected period; percentage changes use source percentages in percentage points. Missing crop records are not zero.',
    units: { areas: 'ha', sourcePercentages: '%', percentagePointChange: 'percentage_points' }, annualChanges,
    cropClasses: { datasetId: 'usda_crop_classes', distributionPath: 'currentRotation.cropClassDistribution.years' },
    transitions: { datasetId: transitions.datasetId, evidencePath: 'currentRotation.observedTransitions.yearPairs', yearPairs,
      method: 'Sum source areas within same/different grouped labels separately per year pair; percentage = 100 * category area / original common_valid_area_ha.',
      units: { area: 'ha', percentage: '%' }, limitation: 'Other -> Other need not mean the same original crop class. Group transitions are county aggregates, not field rotation histories.' },
  };
}

function soilAnalytics(evidence) {
  const id = 'soil_map_units', records = evidence.soilFirst.mapUnits.records;
  const missing = evidence.missingValues[id], attributes = {};
  for (const [field, declaration] of Object.entries(evidence.datasetProvenance[id].metadata.fields)) {
    const nullCount = missing.nullCounts[field] ?? 0, availableCount = records.length - nullCount;
    const attribute = { ...source(evidence, id, field), recordCount: missing.selectedRecordCount, availableCount, nullCount,
      nullPercentage: percent(nullCount, records.length), status: !records.length ? 'no_records' : !availableCount ? 'all_values_null' : 'available' };
    const types = Array.isArray(declaration.type) ? declaration.type : [declaration.type];
    if (types.some((type) => ['number', 'integer'].includes(type))) {
      const values = records.map((row) => number(row[field])).filter(present).sort((a, b) => a - b);
      const middle = Math.floor(values.length / 2);
      attribute.summary = { method: 'unweighted_across_map_units', sampleCount: values.length,
        mean: values.length ? sum(values) / values.length : null,
        median: !values.length ? null : values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2,
        minimum: values[0] ?? null, maximum: values.at(-1) ?? null };
    } else if (SOIL_CATEGORIES.includes(field)) {
      attribute.distribution = [...by(records.filter((row) => present(row[field])), (row) => row[field])]
        .sort(([a], [b]) => a.localeCompare(b)).map(([value, rows]) => ({ value, count: rows.length,
          percentageOfAllMapUnits: percent(rows.length, records.length), percentageOfAvailableMapUnits: percent(rows.length, availableCount) }));
    }
    attributes[field] = attribute;
  }
  return { datasetId: id, evidencePath: 'soilFirst.mapUnits.records', missingValuesPath: 'missingValues.soil_map_units',
    sampleUnit: 'one delivered map unit, equal weight', spatialWeighting: 'none', temporalScope: 'static', attributes,
    limitation: 'Counts and summaries describe delivered map-unit records, not county land coverage, field soils, or area-weighted county conditions.' };
}

export function createHistoricalAnalytics(evidence) {
  return {
    version: '1.0.0', classification: 'derived_descriptive_statistics',
    methodology: 'docs/historical_analytics_methodology.md', provenancePath: 'datasetProvenance',
    climate: climateAnalytics(evidence), vegetation: vegetationAnalytics(evidence), crops: cropAnalytics(evidence), soil: soilAnalytics(evidence),
    merra2: { evidencePath: 'merra2Context', status: evidence.merra2Context.status, additionalAggregation: 'none' },
    limitations: [
      'Descriptive differences and weighted summaries do not establish causation, management outcomes, recommendations, or agricultural scores.',
      'Climate full-year values require all twelve complete months; partial observations remain visible with observedValue and completeness counts.',
      'No POWER locations or MERRA-2 cells are spatially averaged. Monthly and 16-day MODIS remain independent resolutions.',
      'MODIS annual means weight supplied, already rounded period means by valid pixel observations; raw-pixel medians or variances cannot be recovered.',
      'Requested periods outside declared coverage contribute to missing-record counts; this does not prove a sensor failure.',
      'Missing values are not zero. Absent previous calendar years are not bridged. Soil summaries have no spatial area weights.',
    ],
  };
}
