import mongoose from 'mongoose';
import { PROVIDERS, CATEGORIES, ACQUISITION_STATUSES, VALIDATION_STATUSES, PROCESSING_STATUSES, COVERAGE_STATUSES, VARIABLE_STATUSES, isCoverageDate } from './dataset.validation.js';

const { Schema } = mongoose;
const text = (max = 2000) => ({ type: String, trim: true, maxlength: max });
const options = { _id: false, strict: 'throw' };
const optionalInteger = (value) => value == null || Number.isSafeInteger(value);
const sourceUrl = {
  type: String, required: true, maxlength: 2000,
  validate: { validator(value) { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; } }, message: 'Source URL must be HTTPS without credentials.' },
};

export const temporalCoverageSchema = new Schema({
  status: { type: String, enum: COVERAGE_STATUSES, default: 'unknown' },
  start: { type: String, default: null, validate: { validator: isCoverageDate, message: 'Invalid coverage start date.' } },
  end: { type: String, default: null, validate: { validator: isCoverageDate, message: 'Invalid coverage end date.' } },
  precision: { type: String, enum: ['day', 'month', 'year', 'unknown'], default: 'unknown' },
  timezone: { type: String, enum: ['UTC', 'local_standard_time', 'unknown'], default: 'unknown' },
  description: text(),
  verifiedAt: { type: Date, default: null, required() { return this.status === 'verified'; } },
  evidenceReference: { ...text(2000), select: false, required() { return this.status === 'verified'; } },
}, options);
temporalCoverageSchema.pre('validate', function () {
  if ((this.start === null) !== (this.end === null)) this.invalidate('end', 'Both coverage bounds must be supplied or both left unknown.');
  if (this.start && this.end && this.start > this.end) this.invalidate('end', 'Coverage end must not precede start.');
  if (this.start || this.end) {
    const length = { day: 10, month: 7, year: 4 }[this.precision];
    if (!length || this.start?.length !== length || this.end?.length !== length) this.invalidate('precision', 'Coverage date strings must match their declared precision.');
  }
  if (this.status === 'verified' && (!this.start || !this.end)) this.invalidate('start', 'Verified temporal coverage requires explicit bounds.');
});

const areaCoverageSchema = new Schema({
  studyAreaId: { type: Schema.Types.ObjectId, ref: 'StudyArea', default: null },
  countryCode: { type: String, match: /^[A-Z]{2}$/ },
  geoid: { type: String, match: /^\d{5}$/ },
  status: { type: String, enum: COVERAGE_STATUSES, default: 'unknown' },
  description: text(),
  temporalCoverage: { type: temporalCoverageSchema, default: () => ({}) },
  verifiedAt: { type: Date, default: null, required() { return this.status === 'verified'; } },
  evidenceReference: { ...text(), select: false, required() { return this.status === 'verified'; } },
}, options);
areaCoverageSchema.pre('validate', function () {
  if (!this.studyAreaId && !(this.countryCode && this.geoid)) this.invalidate('studyAreaId', 'Coverage must identify a study area or a country/county GEOID.');
});

const spatialCoverageSchema = new Schema({
  status: { type: String, enum: COVERAGE_STATUSES, default: 'unknown' },
  description: text(),
  nativeExtent: { type: String, enum: ['global', 'unknown'], default: 'unknown' },
  outputCrs: { ...text(100), default: null },
  verifiedAt: { type: Date, default: null, required() { return this.status === 'verified'; } },
  evidenceReference: { ...text(), select: false, required() { return this.status === 'verified'; } },
  areas: {
    type: [areaCoverageSchema], default: [],
    validate: { validator(areas) {
      const keys = areas.map((area) => area.studyAreaId ? String(area.studyAreaId) : `${area.countryCode}:${area.geoid}`);
      return keys.length <= 1000 && new Set(keys).size === keys.length;
    }, message: 'Area coverage claims must be bounded and have unique identities.' },
  },
}, options);

function stageSchema(statuses, fallback) {
  return new Schema({
    status: { type: String, enum: statuses, default: fallback },
    description: text(),
    checkedAt: { type: Date, default: null },
    evidenceReference: { ...text(), select: false },
  }, options);
}
const acquisitionSchema = new Schema({
  status: { type: String, enum: ACQUISITION_STATUSES, default: 'pending' },
  description: text(),
  requestId: { ...text(200), default: null },
  requestStatus: { ...text(100), default: null },
  requestCompletedOn: { type: String, default: null, validate: { validator: isCoverageDate, message: 'Invalid request completion date.' } },
  reportedInventory: {
    type: new Schema({
      fileCount: { type: Number, min: 0, validate: optionalInteger, default: null },
      locationCount: { type: Number, min: 0, validate: optionalInteger, default: null },
      featureCount: { type: Number, min: 0, validate: optionalInteger, default: null },
      outputLayerCount: { type: Number, min: 0, validate: optionalInteger, default: null },
      size: { value: { type: Number, min: 0, default: null }, unit: { type: String, enum: ['MB', null], default: null } },
      format: { ...text(100), default: null },
      sceneId: { ...text(200), default: null },
      metadataOnly: { type: Boolean, default: false },
      latitudeRows: { type: Number, min: 0, validate: optionalInteger, default: null },
      longitudeCells: { type: Number, min: 0, validate: optionalInteger, default: null },
    }, options), default: () => ({}),
  },
}, options);

const variableSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  displayName: { type: String, required: true, trim: true, maxlength: 200 },
  unit: { ...text(100), default: null },
  description: text(),
  availabilityStatus: { type: String, enum: VARIABLE_STATUSES, default: 'unknown' },
}, options);

export const datasetSchema = new Schema({
  slug: { type: String, required: true, maxlength: 120, match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ },
  name: { type: String, required: true, trim: true, maxlength: 300 },
  provider: { type: String, required: true, enum: PROVIDERS },
  category: { type: String, required: true, enum: CATEGORIES },
  productId: { ...text(200), default: null },
  productCollection: { ...text(200), default: null },
  version: { ...text(100), default: null },
  description: { ...text(4000), required: true },
  purpose: { ...text(2000), required: true },
  optional: { type: Boolean, default: false },
  variables: {
    type: [variableSchema], default: [],
    validate: { validator(values) { return values.length <= 200 && new Set(values.map((value) => value.name)).size === values.length; }, message: 'Variable names must be unique (maximum 200).' },
  },
  temporalCoverage: { type: temporalCoverageSchema, default: () => ({}) },
  spatialCoverage: { type: spatialCoverageSchema, default: () => ({}) },
  spatialResolution: {
    type: new Schema({
      status: { type: String, enum: ['known', 'unknown'], default: 'unknown' },
      native: text(500),
      unit: { type: String, enum: ['meters', 'degrees', null], default: null },
      nominal: { type: Number, min: 0, default: null },
      latitude: { type: Number, min: 0, default: null },
      longitude: { type: Number, min: 0, default: null },
    }, options), default: () => ({}),
  },
  temporalResolution: {
    type: new Schema({ unit: { type: String, enum: ['day', 'month', 'year', 'unknown'], default: 'unknown' }, interval: { type: Number, min: 1, validate: optionalInteger, default: null }, description: text(500) }, options), default: () => ({}),
  },
  source: {
    type: new Schema({ referenceUrl: sourceUrl, inventoryBasis: { type: String, enum: ['project_report', 'verified_files'], default: 'project_report' }, description: text() }, options), required: true,
  },
  acquisition: { type: acquisitionSchema, default: () => ({}) },
  validation: { type: stageSchema(VALIDATION_STATUSES, 'pending'), default: () => ({}) },
  processing: { type: stageSchema(PROCESSING_STATUSES, 'not_started'), default: () => ({}) },
  processedSummaryAvailability: {
    type: new Schema({
      status: { type: String, enum: ['available', 'pending', 'unavailable'], required: true },
      aoiKey: { type: String, required: true, maxlength: 120 },
      studyAreaId: { type: Schema.Types.ObjectId, ref: 'StudyArea', required: true },
      spatialScope: { type: String, enum: ['bounding_box_aoi'], required: true },
      countyMaskApplied: { type: Boolean, required: true, validate: (value) => value === false },
      exactCountyStatistics: { type: Boolean, required: true, validate: (value) => value === false },
      countyCoverageStatus: { type: String, enum: ['unverified'], required: true },
      studyAreaRelationship: { type: String, enum: ['pilot_context_only'], required: true },
      resolutions: [{ type: String, enum: ['16day', 'monthly'] }],
      recordCount16day: { type: Number, min: 0, validate: Number.isSafeInteger, required: true },
      recordCountMonthly: { type: Number, min: 0, validate: Number.isSafeInteger, required: true },
      assetIds: [{ type: Schema.Types.ObjectId, ref: 'DatasetAsset' }],
      rawProductVerifiedByThisImport: { type: Boolean, required: true, validate: (value) => value === false },
    }, options), default: undefined,
  },
  limitations: { type: [{ type: String, maxlength: 2000 }], default: [], validate: (values) => values.length <= 100 },
  tags: { type: [{ type: String, maxlength: 100 }], default: [], validate: (values) => values.length <= 30 },
  isActive: { type: Boolean, default: true },
}, { timestamps: true, strict: 'throw', collection: 'datasets', bufferCommands: false });

datasetSchema.index({ slug: 1 }, { unique: true, name: 'dataset_slug_unique' });
datasetSchema.index({ provider: 1, category: 1 }, { name: 'dataset_provider_category' });
datasetSchema.index({ category: 1 }, { name: 'dataset_category' });
datasetSchema.index({ provider: 1, productId: 1, version: 1 }, {
  unique: true, name: 'dataset_product_version_unique',
  partialFilterExpression: { productId: { $type: 'string' }, version: { $type: 'string' } },
});

export function getDatasetModel(connection) {
  return connection.models.Dataset ?? connection.model('Dataset', datasetSchema);
}
