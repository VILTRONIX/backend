import mongoose from 'mongoose';
import { AppError } from '../../utils/appError.js';
import { getDatasetModel } from '../datasets/dataset.model.js';
import { getDatasetAssetModel } from '../datasets/dataset-asset.model.js';
import { publicAsset } from '../datasets/dataset.service.js';
import { getReadiness } from '../datasets/dataset.validation.js';
import { getStudyAreaModel } from '../study-areas/study-area.model.js';
import { getVegetationObservationModel, OBSERVATION_FIELDS } from './vegetation-observation.model.js';
import { AOI_KEY, MODIS_SLUG, PILOT_GEOID, APPROVED_SOURCES, PROCESSING_METADATA, SPATIAL_PROVENANCE, LIMITATIONS } from './vegetation.constants.js';

export function publicObservation(row) {
  const fields = ['_id', ...OBSERVATION_FIELDS.filter((field) => field !== 'processingMetadata'), 'importedAt'];
  const result = Object.fromEntries(fields.filter((key) => row[key] !== undefined).map((key) => [key, row[key]]));
  result.sourceFile = Object.values(APPROVED_SOURCES).some((source) => source.fileName === row.sourceFile) ? row.sourceFile : null;
  result.processingMetadata = structuredClone(PROCESSING_METADATA);
  return result;
}
export function summaryPipeline(filter) {
  const hasNdvi = { $ne: [{ $ifNull: ['$ndviMean', null] }, null] };
  const hasEvi = { $ne: [{ $ifNull: ['$eviMean', null] }, null] };
  const available = { $and: [hasNdvi, hasEvi] };
  const group = {
    _id: null, recordCount: { $sum: 1 }, validObservationCount: { $sum: { $cond: [available, 1, 0] } },
    firstPeriod: { $min: '$periodKey' }, lastPeriod: { $max: '$periodKey' },
    missingPeriods: { $push: { $cond: [available, null, '$periodKey'] } },
    totalPixelObservations: { $sum: { $ifNull: ['$totalPixelCount', '$totalPixelObservations'] } },
  };
  for (const [prefix, hasValue] of [['ndvi', hasNdvi], ['evi', hasEvi]]) {
    group[`${prefix}Count`] = { $sum: { $cond: [hasValue, 1, 0] } };
    group[`${prefix}Average`] = { $avg: `$${prefix}Mean` };
    group[`${prefix}Minimum`] = { $min: `$${prefix}Mean` };
    group[`${prefix}Maximum`] = { $max: `$${prefix}Mean` };
    group[`${prefix}ValidPixels`] = { $sum: `$${prefix}ValidPixelCount` };
  }
  return [{ $match: filter }, { $sort: { periodKey: 1 } }, { $group: group }];
}
export function formatSummary(group, resolution) {
  const count = group?.recordCount ?? 0, total = group?.totalPixelObservations ?? 0;
  const statistics = {};
  for (const prefix of ['ndvi', 'evi']) statistics[prefix] = {
    validPeriodCount: group?.[`${prefix}Count`] ?? 0,
    averagePeriodMean: group?.[`${prefix}Average`] ?? null,
    minimumPeriodMean: group?.[`${prefix}Minimum`] ?? null,
    maximumPeriodMean: group?.[`${prefix}Maximum`] ?? null,
  };
  return {
    resolution, recordCount: count, validObservationCount: group?.validObservationCount ?? 0,
    missingObservationCount: count - (group?.validObservationCount ?? 0),
    periodRange: { start: group?.firstPeriod ?? null, end: group?.lastPeriod ?? null },
    statistics, statisticScope: 'unweighted_statistics_across_available_period_means_not_pixel_extrema',
    missingPeriods: (group?.missingPeriods ?? []).filter((key) => key !== null),
    pixelCoverage: {
      unit: 'pixel_observations_across_selected_periods_not_unique_pixels', totalPixelObservations: total,
      ndviValidPixelObservations: group?.ndviValidPixels ?? 0, eviValidPixelObservations: group?.eviValidPixels ?? 0,
      ndviValidPixelPercentage: total ? 100 * group.ndviValidPixels / total : null,
      eviValidPixelPercentage: total ? 100 * group.eviValidPixels / total : null,
    },
  };
}

export function createVegetationService({ database, observationModel, datasetModel, assetModel, studyAreaModel }) {
  async function perform(operation) {
    if (!database.isReady()) throw new AppError(503, 'DATABASE_UNAVAILABLE', 'Database is not ready.');
    try {
      return await operation({
        Observation: observationModel ?? getVegetationObservationModel(database.getConnection()),
        Dataset: datasetModel ?? getDatasetModel(database.getConnection()),
        Asset: assetModel ?? getDatasetAssetModel(database.getConnection()),
        Area: studyAreaModel ?? getStudyAreaModel(database.getConnection()),
      });
    } catch (error) {
      if (!database.isReady() || /^Mongo(Network|ServerSelection|TopologyClosed|NotConnected|ClientClosed)/.test(error.name) || error.code === 50) throw new AppError(503, 'DATABASE_UNAVAILABLE', 'Database is temporarily unavailable.');
      throw error;
    }
  }
  async function context(models, options) {
    const dataset = await models.Dataset.findOne({ slug: MODIS_SLUG }).lean().maxTimeMS(5000);
    const pilot = await models.Area.findOne({ geoid: PILOT_GEOID, countryCode: 'US', areaType: 'county', isActive: true }).select('_id name geoid').lean().maxTimeMS(5000);
    if (!dataset || !pilot) throw new AppError(404, 'MODIS_CONTEXT_NOT_FOUND', 'MODIS dataset and active pilot context must be registered.');
    const assets = await models.Asset.find({ datasetId: dataset._id, assetKey: { $in: [`${AOI_KEY}:16day`, `${AOI_KEY}:monthly`] } }).lean().maxTimeMS(5000);
    const filter = {
      datasetId: dataset._id, aoiKey: AOI_KEY, resolution: options.resolution,
      sourceChecksum: APPROVED_SOURCES[options.resolution].checksum,
      studyAreaId: options.areaId ? new mongoose.Types.ObjectId(options.areaId) : pilot._id,
      areaGeoid: options.geoid ?? PILOT_GEOID,
    };
    if (options.startDate || options.endDate) filter.periodKey = { ...(options.startDate ? { $gte: options.startDate } : {}), ...(options.endDate ? { $lte: options.endDate } : {}) };
    const metadata = {
      provider: 'NASA', product: 'MOD13Q1.061', variables: ['NDVI', 'EVI'], nativeSpatialResolutionMeters: 250,
      resolution: options.resolution, temporalResolution: options.resolution === 'monthly' ? 'monthly_aggregation_of_existing_16day_pixel_observations' : '16_day_composite',
      aoiKey: AOI_KEY, ...SPATIAL_PROVENANCE, dataLevel: 'area_summary', rasterRenderingSupported: false,
      studyArea: { id: pilot._id, name: pilot.name, geoid: pilot.geoid, relationship: 'pilot_context_only' },
      processing: structuredClone(PROCESSING_METADATA), limitations: LIMITATIONS,
      sourceAssets: assets.map(publicAsset), rawProductAcquisitionStatus: dataset.acquisition.status,
      datasetReadiness: getReadiness(dataset),
      processedSummariesAvailable: dataset.processedSummaryAvailability?.status === 'available' && assets.length === 2,
      requestedFilters: { areaId: options.areaId ?? String(pilot._id), geoid: options.geoid ?? PILOT_GEOID, startDate: options.startDate ?? null, endDate: options.endDate ?? null },
    };
    return { filter, metadata };
  }
  return {
    list(options) {
      return perform(async (models) => {
        const { filter, metadata } = await context(models, options);
        const [items, total] = await Promise.all([
          models.Observation.find(filter).sort({ periodKey: 1, _id: 1 }).skip((options.page - 1) * options.limit).limit(options.limit).lean().maxTimeMS(5000),
          models.Observation.countDocuments(filter).maxTimeMS(5000),
        ]);
        return { items: items.map(publicObservation), pagination: { page: options.page, limit: options.limit, total, totalPages: Math.ceil(total / options.limit) }, metadata };
      });
    },
    summary(options) {
      return perform(async (models) => {
        const { filter, metadata } = await context(models, options);
        const rows = await models.Observation.aggregate(summaryPipeline(filter)).option({ maxTimeMS: 5000 });
        return { ...formatSummary(rows[0], options.resolution), metadata };
      });
    },
    getByPeriod(period, options) {
      return perform(async (models) => {
        const { filter, metadata } = await context(models, options);
        const observation = await models.Observation.findOne({ ...filter, periodKey: period }).lean().maxTimeMS(5000);
        if (!observation) throw new AppError(404, 'VEGETATION_OBSERVATION_NOT_FOUND', 'No observation exists for this period and pilot-context filter.');
        return { observation: publicObservation(observation), metadata };
      });
    },
  };
}
