import mongoose from 'mongoose';
import { SOURCE_MAPPING, SPATIAL_PROVENANCE, RESOLUTIONS } from './vegetation.constants.js';
import { validPeriodKey } from './vegetation.validation.js';

const { Schema } = mongoose;
const finite = (value) => value === null || (typeof value === 'number' && Number.isFinite(value));
const count = { type: Number, min: 0, validate: (value) => value === undefined || Number.isSafeInteger(value) };
const histogram = { type: Schema.Types.Mixed, validate: (value) => value === undefined || (value && !Array.isArray(value) && typeof value === 'object' && Object.entries(value).every(([key, number]) => /^\d+$/.test(key) && Number.isSafeInteger(number) && number >= 0)) };
const fields = {};
for (const name of ['ndvi', 'evi']) {
  for (const statistic of ['Mean', 'Median', 'Std']) fields[`${name}${statistic}`] = { type: Number, default: null, validate: finite, ...(statistic === 'Std' ? { min: 0 } : {}) };
  fields[`${name}ValidPixelCount`] = { ...count, required: true };
  fields[`${name}ValidPixelPercentage`] = { type: Number, required: true, min: 0, max: 100, validate: finite };
}
export const vegetationObservationSchema = new Schema({
  datasetId: { type: Schema.Types.ObjectId, ref: 'Dataset', required: true },
  studyAreaId: { type: Schema.Types.ObjectId, ref: 'StudyArea', required: true },
  areaGeoid: { type: String, required: true, match: /^\d{5}$/ },
  aoiKey: { type: String, required: true, maxlength: 120, match: /^[a-z0-9-]+$/ },
  spatialScope: { type: String, required: true, enum: ['bounding_box_aoi'] },
  countyMaskApplied: { type: Boolean, required: true, validate: (value) => value === false },
  exactCountyStatistics: { type: Boolean, required: true, validate: (value) => value === false },
  countyCoverageStatus: { type: String, required: true, enum: ['unverified'] },
  studyAreaRelationship: { type: String, required: true, enum: ['pilot_context_only'] },
  resolution: { type: String, required: true, enum: RESOLUTIONS },
  periodKey: { type: String, required: true, validate: { validator(value) { return validPeriodKey(value, this.resolution); }, message: 'Period key must match its resolution.' } },
  observationDate: { type: Date, required: true },
  month: { type: String, validate: (value) => value === undefined || validPeriodKey(value, 'monthly') },
  ...fields,
  totalPixelCount: count, baseValidPixelCount: count, qualityValidPixelCount: count,
  observationCount: count, totalPixelObservations: count,
  viUsefulnessDistributionBeforeFilter: histogram, viUsefulnessDistributionAfterFilter: histogram,
  missingDataStatus: { type: String, required: true, enum: ['available', 'no_valid_pixels', 'partial'] },
  sourceAssetId: { type: Schema.Types.ObjectId, ref: 'DatasetAsset', required: true },
  sourceFile: { type: String, required: true, maxlength: 255, match: /^[^/\\:\x00-\x1f]+$/ },
  sourceChecksum: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
  contentHash: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
  processingMetadata: { type: Schema.Types.Mixed, required: true, validate: (value) => Buffer.byteLength(JSON.stringify(value)) <= 8192 },
  importedAt: { type: Date, required: true },
}, { strict: 'throw', collection: 'vegetation_observations', bufferCommands: false, autoCreate: false, autoIndex: false });

vegetationObservationSchema.pre('validate', function () {
  const expected = new Date(`${this.periodKey}${this.resolution === 'monthly' ? '-01' : ''}T00:00:00Z`);
  if (this.observationDate?.getTime() !== expected.getTime()) this.invalidate('observationDate', 'Date must preserve the original calendar period at UTC midnight.');
  if (this.resolution === 'monthly' && this.month !== this.periodKey) this.invalidate('month', 'Monthly records must preserve the exact month string.');
  const required = this.resolution === 'monthly' ? ['observationCount', 'totalPixelObservations'] : ['totalPixelCount', 'baseValidPixelCount', 'qualityValidPixelCount', 'viUsefulnessDistributionBeforeFilter', 'viUsefulnessDistributionAfterFilter'];
  for (const name of required) if (this[name] === undefined) this.invalidate(name, 'Resolution-specific source field is required.');
  const absent = this.resolution === 'monthly' ? ['totalPixelCount', 'baseValidPixelCount', 'qualityValidPixelCount', 'viUsefulnessDistributionBeforeFilter', 'viUsefulnessDistributionAfterFilter'] : ['month', 'observationCount', 'totalPixelObservations'];
  for (const name of absent) if (this[name] !== undefined) this.invalidate(name, 'This field is absent from this resolution\'s source schema.');
  for (const name of ['ndvi', 'evi']) {
    const n = this[`${name}ValidPixelCount`];
    const total = this.resolution === 'monthly' ? this.totalPixelObservations : this.totalPixelCount;
    if (n > total) this.invalidate(`${name}ValidPixelCount`, 'Valid count exceeds total.');
    if (total > 0 && Math.abs(this[`${name}ValidPixelPercentage`] - 100 * n / total) > 1e-9) this.invalidate(`${name}ValidPixelPercentage`, 'Percentage must match source counts.');
    for (const suffix of ['Mean', 'Median', 'Std']) if ((n === 0) !== (this[`${name}${suffix}`] === null)) this.invalidate(`${name}${suffix}`, 'Null measurements must agree with zero valid pixels.');
  }
  const missing = [this.ndviMean, this.eviMean].filter((value) => value === null).length;
  if (this.missingDataStatus !== (missing === 2 ? 'no_valid_pixels' : missing ? 'partial' : 'available')) this.invalidate('missingDataStatus', 'Missing-data status must reflect stored measurements.');
});
vegetationObservationSchema.index({ datasetId: 1, aoiKey: 1, resolution: 1, periodKey: 1 }, { unique: true, name: 'vegetation_source_period_unique' });
vegetationObservationSchema.index({ studyAreaId: 1, resolution: 1, observationDate: 1 }, { name: 'vegetation_area_resolution_date' });
vegetationObservationSchema.index({ areaGeoid: 1, resolution: 1, periodKey: 1 }, { name: 'vegetation_geoid_resolution_period' });

export const OBSERVATION_FIELDS = ['datasetId', 'studyAreaId', 'areaGeoid', 'aoiKey', ...Object.keys(SPATIAL_PROVENANCE), 'resolution', 'periodKey', 'observationDate', 'month', ...Object.values(SOURCE_MAPPING), 'missingDataStatus', 'sourceAssetId', 'sourceFile', 'sourceChecksum', 'processingMetadata'];
export function getVegetationObservationModel(connection) {
  return connection.models.VegetationObservation ?? connection.model('VegetationObservation', vegetationObservationSchema);
}
