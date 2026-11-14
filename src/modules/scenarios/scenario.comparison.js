import { AppError } from '../../utils/appError.js';
import { parseEngineQuery } from '../engine/engine.query.js';
import { getScenarioCatalog } from './scenario.catalog.js';
import { createHistoricalAnalytics } from '../analytics/historical.analytics.js';

const LIMITATIONS = [
  'This comparison organizes historical evidence by scenario priority; it does not evaluate alternative management outcomes.',
  'Source-product values may already be modeled, classified or aggregated upstream; they are not direct measurements on a particular farm.',
  'POWER locations and MERRA-2 cells remain separate. No county climate average is calculated.',
  'MODIS time series describe county greenness, not crop-specific stress, field measurements or yield. No fitted trend is calculated.',
  'Crop transitions are county aggregates. Both transition years must fall within the selected period; original pair-specific denominators are retained.',
  'Soil attributes are static map-unit context, not field assignments or measured soil-health changes. Nulls remain null.',
  'Engine MODIS and legacy MongoDB bounding-box observations remain separate; no date-based merge or ingestion occurs.',
];
const UNSUPPORTED_INDICATORS = [
  ['water_savings', 'No scenario-specific water-saving outcome is supplied or calculated.'],
  ['irrigation_requirement', 'No irrigation requirement is supplied or calculated.'],
  ['soil_health_improvement', 'Static soil attributes do not establish a management-induced improvement.'],
  ['yield_prediction', 'No yield prediction is supplied or calculated.'],
  ['field_rotation_history', 'County transitions do not identify individual fields or their multi-year histories.'],
  ['field_soil_assignment', 'Verified map-unit-to-field spatial linkage is not supplied.'],
  ['scenario_scores', 'No arbitrary score or performance ranking is generated.'],
  ['agricultural_recommendations', 'Agricultural recommendations remain disabled.'],
];

export function parseComparisonQuery(query = {}) {
  const bad = () => { throw new AppError(400, 'INVALID_COMPARISON_QUERY', 'Only valid startYear, endYear and includeMerra2 parameters are supported.'); };
  if (Object.keys(query).some((key) => !['startYear', 'endYear', 'includeMerra2'].includes(key))) bad();
  if (query.includeMerra2 !== undefined && !['true', 'false'].includes(query.includeMerra2)) bad();
  try {
    const { startYear, endYear } = parseEngineQuery({ startYear: query.startYear ?? '2021', endYear: query.endYear ?? '2025' });
    return { startYear, endYear, includeMerra2: query.includeMerra2 === 'true' };
  } catch (error) {
    if (error instanceof AppError && error.code === 'INVALID_ENGINE_QUERY') bad();
    throw error;
  }
}

function groups(records, keyFor, describe) {
  const result = new Map();
  for (const record of records) {
    const key = keyFor(record);
    if (!result.has(key)) result.set(key, { ...describe(record), records: [] });
    result.get(key).records.push(record);
  }
  return [...result.values()];
}
function periodRelation(coverage, period) {
  if (coverage?.kind === 'static') return 'static';
  const low = coverage?.start_year ?? (coverage?.start ? Number(coverage.start.slice(0, 4)) : coverage?.year_pairs?.[0]?.[0]);
  const high = coverage?.end_year ?? (coverage?.end ? Number(coverage.end.slice(0, 4)) : coverage?.year_pairs?.at(-1)?.[1]);
  if (!Number.isInteger(low) || !Number.isInteger(high)) return 'not_declared';
  if (period.endYear < low || period.startYear > high) return 'outside_declared_coverage';
  return period.startYear >= low && period.endYear <= high ? 'within_declared_coverage' : 'partially_within_declared_coverage';
}
function observations(records) {
  return {
    selectedPeriods: records.length,
    ndviAvailablePeriods: records.filter((row) => row.ndvi_mean !== null).length,
    eviAvailablePeriods: records.filter((row) => row.evi_mean !== null).length,
    bothAvailablePeriods: records.filter((row) => row.ndvi_mean !== null && row.evi_mean !== null).length,
    neitherAvailablePeriods: records.filter((row) => row.ndvi_mean === null && row.evi_mean === null).length,
  };
}

export function createScenarioComparisonService({ engineService, maxRecords = 10000 }) {
  if (!Number.isSafeInteger(maxRecords) || maxRecords < 1) throw new Error('Invalid comparison record limit.');
  return {
    async compare(query = {}) {
      const selected = parseComparisonQuery(query);
      const years = { startYear: String(selected.startYear), endYear: String(selected.endYear) };
      const datasetProvenance = {}, datasetSelections = {}, availableIndicators = {}, missingValues = {};
      const unavailableIndicators = UNSUPPORTED_INDICATORS.map(([indicator, reason]) => ({ indicator, reason }));
      let manifestChecksum, remaining = maxRecords;
      const changed = () => { throw new AppError(503, 'COMPARISON_SOURCE_CHANGED', 'Engine evidence changed while assembling the comparison. Retry the request.'); };

      async function load(id, filters, select = () => true) {
        const records = []; let source, fingerprint, total;
        for (let page = 1; ; page += 1) {
          const result = await engineService.readDataset(id, { ...filters, page: String(page), limit: '100' });
          if (result.dataset.metadata?.contractVersion !== '1.0.0' || !result.dataset.structurallyReady || !result.dataset.provenance?.manifestChecksum) {
            throw new AppError(503, 'COMPARISON_CONTRACT_UNAVAILABLE', 'Scenario evidence requires verified Engine contract 1.0.0.', { datasetId: id });
          }
          const current = JSON.stringify(result.dataset.provenance);
          if (page === 1) {
            source = result.dataset; fingerprint = current; total = result.pagination.total;
            if (!Number.isSafeInteger(total) || total < 0) changed();
            if (total > remaining) throw new AppError(503, 'COMPARISON_RECORD_LIMIT', 'The comparison exceeds its bounded record limit. Select a smaller period.');
            manifestChecksum ??= source.provenance.manifestChecksum;
          }
          if (current !== fingerprint || result.pagination.total !== total || result.dataset.provenance.manifestChecksum !== manifestChecksum) changed();
          if (!Array.isArray(result.items) || result.items.length > remaining) changed();
          remaining -= result.items.length; records.push(...result.items);
          if (records.length >= total) { if (records.length !== total) changed(); break; }
          if (!result.items.length || page >= 10000) changed();
        }
        const items = records.filter(select), fields = source.metadata.fields;
        const nullCounts = {}, allNullFields = [], available = [];
        for (const [field, declaration] of Object.entries(fields)) {
          const count = items.filter((row) => row[field] === null).length;
          if (count) nullCounts[field] = count;
          if (items.length && count === items.length) {
            allNullFields.push(field);
            unavailableIndicators.push({ datasetId: id, indicator: field, unit: declaration.unit, reason: 'All selected source values are null.' });
          } else if (items.length) available.push({ field, unit: declaration.unit, availableValueCount: items.length - count, missingValueCount: count });
        }
        datasetProvenance[id] = source;
        datasetSelections[id] = {
          status: items.length ? 'available' : 'no_records_in_period', selectedRecordCount: items.length,
          temporalSelection: id === 'soil_map_units' ? 'not_applicable_static' : id === 'usda_crop_transitions' ? 'both_transition_years_within_range' : 'inclusive_year_range',
          declaredPeriodRelation: periodRelation(source.metadata.coverage, selected),
        };
        availableIndicators[id] = available;
        missingValues[id] = { selectedRecordCount: items.length, nullCounts, allNullFields,
          recordsWithNullValues: items.filter((row) => Object.keys(fields).some((field) => row[field] === null)).length };
        return { datasetId: id, selectedRecordCount: items.length, records: items };
      }

      // Sequential, bounded reads reuse the existing validated/paginated Engine service.
      const annual = await load('usda_annual', years);
      const classes = await load('usda_crop_classes', years);
      const transitions = await load('usda_crop_transitions', {}, (row) => row.year_1 >= selected.startYear && row.year_2 <= selected.endYear);
      const power = await load('power_monthly', years);
      const monthly = await load('modis_monthly', years);
      const composites = await load('modis_16day', years);
      const soil = await load('soil_map_units', {});
      let merra2Context = { requested: false, status: 'not_requested' };
      if (selected.includeMerra2) {
        try {
          const context = await load('merra2_context', years);
          const { records, ...info } = context;
          merra2Context = { requested: true, status: records.length ? 'available' : 'no_records_in_period', ...info,
            cells: groups(records, (row) => JSON.stringify([row.latitude, row.longitude]), (row) => ({ latitude: row.latitude, longitude: row.longitude })) };
        } catch (error) {
          if (!(error instanceof AppError) || error.code !== 'ENGINE_DATASET_UNAVAILABLE') throw error;
          merra2Context = { requested: true, status: 'unavailable', datasetId: 'merra2_context',
            availabilityStatus: error.details?.status, reason: error.details?.reason };
          unavailableIndicators.push({ datasetId: 'merra2_context', indicator: 'merra2_context', reason: 'Optional MERRA-2 evidence is unavailable.' });
        }
      }
      const scenarios = getScenarioCatalog().items;
      const scenario = (id) => scenarios.find((entry) => entry.id === id);
      const limitations = [...new Set([...LIMITATIONS, ...Object.values(datasetProvenance).flatMap((source) => source.metadata.limitations)])];
      const comparison = {
        metadata: {
          comparisonMode: 'descriptive_evidence', comparisonStatus: 'available', sourceContractVersion: '1.0.0',
          scientificValidationStatus: 'not_assessed', scientificEvaluationStatus: 'not_implemented', recommendationGenerationEnabled: false,
          scenarioScoresGenerated: false, sourceManifestChecksum: manifestChecksum,
          sourceValueClassification: 'Supplied source-product values, including upstream aggregates; not scenario treatment outcomes or direct field measurements.',
          derivedDescriptiveStatistics: ['selected record counts', 'null/non-null counts', 'observation availability counts', 'record groupings'],
          timeSeriesRepresentation: 'Existing source time series; no fitted trend, rescaling or imputation.',
        },
        selectedPeriod: { startYear: selected.startYear, endYear: selected.endYear },
        currentRotation: {
          scenario: scenario('current_rotation'),
          annualCropDistribution: { datasetId: annual.datasetId, selectedRecordCount: annual.selectedRecordCount,
            years: groups(annual.records, (row) => row.year, (row) => ({ year: row.year })) },
          cropClassDistribution: { datasetId: classes.datasetId, selectedRecordCount: classes.selectedRecordCount,
            years: groups(classes.records, (row) => row.year, (row) => ({ year: row.year })) },
          observedTransitions: { datasetId: transitions.datasetId, selectedRecordCount: transitions.selectedRecordCount,
            yearPairs: groups(transitions.records, (row) => JSON.stringify([row.year_1, row.year_2]), (row) => ({ year_1: row.year_1, year_2: row.year_2 })) },
        },
        waterFirst: {
          scenario: scenario('water_first'),
          power: { datasetId: power.datasetId, selectedRecordCount: power.selectedRecordCount,
            locations: groups(power.records, (row) => row.location_id, (row) => ({ location_id: row.location_id, latitude: row.latitude, longitude: row.longitude })) },
          modisMonthly: { ...monthly, observationCounts: observations(monthly.records) },
          modis16day: { ...composites, observationCounts: observations(composites.records) },
        },
        soilFirst: { scenario: scenario('soil_first'), mapUnits: soil,
          temporalScope: 'Static source attributes; not filtered by selected years.', fieldAssignmentStatus: 'not_available' },
        merra2Context, datasetSelections, datasetProvenance, availableIndicators, missingValues, unavailableIndicators,
        scientificLimitations: limitations,
      };
      return { ...comparison, descriptiveAnalytics: createHistoricalAnalytics(comparison) };
    },
  };
}
