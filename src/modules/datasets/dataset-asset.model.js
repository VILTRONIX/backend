import mongoose from 'mongoose';
import { ASSET_TYPES, ASSET_FORMATS, VALIDATION_STATUSES, PROCESSING_STATUSES, isCoverageDate } from './dataset.validation.js';

const { Schema } = mongoose;
export const datasetAssetSchema = new Schema({
  datasetId: { type: Schema.Types.ObjectId, ref: 'Dataset', required: true },
  assetKey: { type: String, required: true, maxlength: 200, match: /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/ },
  assetType: { type: String, required: true, enum: ASSET_TYPES },
  fileName: { type: String, required: true, maxlength: 255, match: /^[^/\\:\x00-\x1f]+$/ },
  format: { type: String, required: true, enum: ASSET_FORMATS },
  sizeBytes: { type: Number, default: null, min: 0, validate: (value) => value == null || Number.isSafeInteger(value) },
  checksum: { type: String, default: null, maxlength: 128 },
  checksumAlgorithm: { type: String, enum: ['sha256', 'sha512', 'md5', null], default: null },
  storageType: { type: String, enum: ['local', 'object_storage', 'https'], required: true },
  storageUri: { type: String, required: true, maxlength: 2048, select: false },
  discoveredAt: { type: Date, required: true },
  dateStart: { type: String, default: null, validate: isCoverageDate },
  dateEnd: { type: String, default: null, validate: isCoverageDate },
  timezone: { type: String, enum: ['UTC', 'local_standard_time', 'unknown'], default: 'unknown' },
  crs: { type: String, default: null, maxlength: 100 },
  variables: { type: [{ type: String, maxlength: 100 }], default: [], validate: (values) => values.length <= 200 },
  validationStatus: { type: String, enum: VALIDATION_STATUSES, default: 'pending' },
  processingStatus: { type: String, enum: PROCESSING_STATUSES, default: 'not_started' },
  metadata: {
    type: Schema.Types.Mixed, default: () => ({}), select: false,
    validate: { validator(value) { try { return Buffer.byteLength(JSON.stringify(value)) <= 16384; } catch { return false; } }, message: 'Asset metadata must be JSON serializable and at most 16 KiB; file content belongs in external storage.' },
  },
}, { timestamps: true, strict: 'throw', collection: 'dataset_assets', bufferCommands: false });

datasetAssetSchema.pre('validate', function () {
  if (this.dateStart && this.dateEnd && this.dateStart > this.dateEnd) this.invalidate('dateEnd', 'Asset dateEnd must not precede dateStart.');
  if (this.checksum || this.checksumAlgorithm) {
    const length = { sha256: 64, sha512: 128, md5: 32 }[this.checksumAlgorithm];
    if (!length || !this.checksum || !new RegExp(`^[a-fA-F0-9]{${length}}$`).test(this.checksum)) this.invalidate('checksum', 'Checksum must match the declared algorithm.');
  }
});
datasetAssetSchema.index({ assetKey: 1 }, { unique: true, name: 'dataset_asset_key_unique' });
datasetAssetSchema.index({ datasetId: 1, assetType: 1, _id: 1 }, { name: 'dataset_asset_dataset_type' });

export function getDatasetAssetModel(connection) {
  return connection.models.DatasetAsset ?? connection.model('DatasetAsset', datasetAssetSchema);
}
