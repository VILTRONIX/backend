import { AppError } from '../../utils/appError.js';
import { getDatasetModel } from './dataset.model.js';
import { getDatasetAssetModel } from './dataset-asset.model.js';
import { getStudyAreaModel } from '../study-areas/study-area.model.js';
import { getReadiness } from './dataset.validation.js';

const pick = (object, keys) => Object.fromEntries(keys.filter((key) => object?.[key] !== undefined).map((key) => [key, object[key]]));
const publicTemporal = (coverage) => ({ status: 'unknown', start: null, end: null, precision: 'unknown', timezone: 'unknown', ...pick(coverage, ['status', 'start', 'end', 'precision', 'timezone', 'description', 'verifiedAt']) });
const publicAreaClaim = (claim) => ({
  ...pick(claim, ['studyAreaId', 'countryCode', 'geoid', 'status', 'description', 'verifiedAt']),
  temporalCoverage: publicTemporal(claim.temporalCoverage),
});
const publicSpatial = (coverage) => ({
  ...pick(coverage, ['status', 'description', 'nativeExtent', 'outputCrs', 'verifiedAt']),
  areas: (coverage?.areas ?? []).map(publicAreaClaim),
});

export function publicDataset(dataset) {
  return {
    ...pick(dataset, ['_id', 'slug', 'name', 'provider', 'category', 'productId', 'productCollection', 'version', 'description', 'purpose', 'optional', 'limitations', 'tags', 'isActive', 'createdAt', 'updatedAt']),
    variables: (dataset.variables ?? []).map((variable) => pick(variable, ['name', 'displayName', 'unit', 'description', 'availabilityStatus'])),
    temporalCoverage: publicTemporal(dataset.temporalCoverage),
    spatialCoverage: publicSpatial(dataset.spatialCoverage),
    spatialResolution: pick(dataset.spatialResolution, ['status', 'native', 'unit', 'nominal', 'latitude', 'longitude']),
    temporalResolution: pick(dataset.temporalResolution, ['unit', 'interval', 'description']),
    source: pick(dataset.source, ['referenceUrl', 'inventoryBasis', 'description']),
    acquisition: {
      ...pick(dataset.acquisition, ['status', 'description', 'requestId', 'requestStatus', 'requestCompletedOn']),
      reportedInventory: {
        ...pick(dataset.acquisition?.reportedInventory, ['fileCount', 'locationCount', 'featureCount', 'outputLayerCount', 'format', 'sceneId', 'metadataOnly', 'latitudeRows', 'longitudeCells']),
        size: pick(dataset.acquisition?.reportedInventory?.size, ['value', 'unit']),
      },
    },
    validation: pick(dataset.validation, ['status', 'description', 'checkedAt']),
    processing: pick(dataset.processing, ['status', 'description', 'checkedAt']),
    readiness: getReadiness(dataset),
  };
}

export function publicAsset(asset) {
  const result = pick(asset, ['_id', 'datasetId', 'assetKey', 'assetType', 'format', 'sizeBytes', 'checksum', 'checksumAlgorithm', 'storageType', 'discoveredAt', 'dateStart', 'dateEnd', 'timezone', 'crs', 'variables', 'validationStatus', 'processingStatus', 'createdAt', 'updatedAt']);
  // Defense in depth for legacy or out-of-band writes that bypass the model's filename validation.
  result.fileName = typeof asset.fileName === 'string' && /^[^/\\:\x00-\x1f]+$/.test(asset.fileName) ? asset.fileName : null;
  return result;
}

export function areaAvailability(dataset, area) {
  const claim = dataset.spatialCoverage?.areas?.find((entry) =>
    entry.studyAreaId && String(entry.studyAreaId) === String(area._id))
    ?? dataset.spatialCoverage?.areas?.find((entry) => !entry.studyAreaId && area.areaType === 'county' && entry.countryCode === area.countryCode && entry.geoid === area.geoid);
  const coverage = claim ? publicAreaClaim(claim) : {
    status: 'unknown', description: 'No area-specific coverage evidence is registered.',
    temporalCoverage: { status: 'unknown', start: null, end: null, precision: 'unknown', timezone: 'unknown' },
  };
  const readiness = getReadiness(dataset);
  const status = coverage.status === 'unavailable' ? 'unavailable'
    : coverage.status === 'verified' ? (readiness.ready ? 'available' : 'not_ready')
      : coverage.status === 'reported' ? 'unverified' : 'unknown';
  return {
    dataset: pick(dataset, ['_id', 'slug', 'name', 'provider', 'category', 'optional', 'isActive']),
    coverage,
    datasetTemporalCoverage: publicTemporal(dataset.temporalCoverage),
    readiness,
    availability: {
      status, available: status === 'available' ? true : status === 'unavailable' ? false : null,
      analysisReady: status === 'available',
    },
    limitations: dataset.limitations ?? [],
  };
}

export function createDatasetService({ database, datasetModel, assetModel, studyAreaModel }) {
  const models = () => ({
    Dataset: datasetModel ?? getDatasetModel(database.getConnection()),
    Asset: assetModel ?? getDatasetAssetModel(database.getConnection()),
    StudyArea: studyAreaModel ?? getStudyAreaModel(database.getConnection()),
  });
  async function queryDatabase(operation) {
    if (!database.isReady()) throw new AppError(503, 'DATABASE_UNAVAILABLE', 'Database is not ready.');
    try { return await operation(models()); } catch (error) {
      if (!database.isReady() || /^Mongo(Network|ServerSelection|TopologyClosed|NotConnected|ClientClosed)/.test(error.name) || error.code === 50) {
        throw new AppError(503, 'DATABASE_UNAVAILABLE', 'Database is temporarily unavailable.');
      }
      throw error;
    }
  }
  async function findDataset(Dataset, slug) {
    const dataset = await Dataset.findOne({ slug }).select('-__v').maxTimeMS(5000).lean();
    if (!dataset) throw new AppError(404, 'DATASET_NOT_FOUND', 'Dataset was not found.');
    return dataset;
  }
  async function pageOf(Model, { filter, page, limit }, projection, sort) {
    const [items, total] = await Promise.all([
      Model.find(filter).select(projection).sort(sort).skip((page - 1) * limit).limit(limit).maxTimeMS(5000).lean(),
      Model.countDocuments(filter).maxTimeMS(5000),
    ]);
    return { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }
  return {
    list(options) {
      return queryDatabase(async ({ Dataset }) => {
        const result = await pageOf(Dataset, options, '-__v', { slug: 1, _id: 1 });
        return { ...result, items: result.items.map(publicDataset) };
      });
    },
    getBySlug(slug) { return queryDatabase(async ({ Dataset }) => publicDataset(await findDataset(Dataset, slug))); },
    listAssets(slug, options) {
      return queryDatabase(async ({ Dataset, Asset }) => {
        const dataset = await findDataset(Dataset, slug);
        const projection = '_id datasetId assetKey assetType fileName format sizeBytes checksum checksumAlgorithm storageType discoveredAt dateStart dateEnd timezone crs variables validationStatus processingStatus createdAt updatedAt';
        const result = await pageOf(Asset, { ...options, filter: { ...options.filter, datasetId: dataset._id } }, projection, { _id: 1 });
        return { dataset: pick(dataset, ['_id', 'slug', 'name']), ...result, items: result.items.map(publicAsset) };
      });
    },
    getCoverage(slug) {
      return queryDatabase(async ({ Dataset }) => {
        const dataset = await findDataset(Dataset, slug);
        return {
          dataset: pick(dataset, ['_id', 'slug', 'name']), temporalCoverage: publicTemporal(dataset.temporalCoverage),
          spatialCoverage: publicSpatial(dataset.spatialCoverage), readiness: getReadiness(dataset),
          limitations: dataset.limitations ?? [],
          warning: 'Reported dataset dates or global product extent do not establish verified study-area coverage or usable files.',
        };
      });
    },
    getAreaCoverage(areaId, options) {
      return queryDatabase(async ({ Dataset, StudyArea }) => {
        const area = await StudyArea.findOne({ _id: areaId, isActive: true }).select('_id name areaType countryCode geoid').maxTimeMS(5000).lean();
        if (!area) throw new AppError(404, 'STUDY_AREA_NOT_FOUND', 'Study area was not found.');
        const result = await pageOf(Dataset, options, '-__v', { slug: 1, _id: 1 });
        return { studyArea: area, ...result, items: result.items.map((dataset) => areaAvailability(dataset, area)) };
      });
    },
  };
}
