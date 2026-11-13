import mongoose from 'mongoose';
import { AREA_TYPES, GEOMETRY_STATUSES, validateGeometry } from './study-area.validation.js';

const { Schema } = mongoose;
const geometrySchema = new Schema({
  type: { type: String, enum: ['Polygon', 'MultiPolygon'], required: true },
  coordinates: { type: Schema.Types.Mixed, required: true },
}, { _id: false, strict: 'throw' });

const sourceSchema = new Schema({
  provider: { type: String, required: true, trim: true, maxlength: 200 },
  dataset: { type: String, required: true, trim: true, maxlength: 300 },
  vintage: { type: String, required: true, trim: true, maxlength: 100 },
  sourceUrl: {
    type: String, required: true, maxlength: 2000,
    validate: {
      validator(value) {
        try {
          const url = new URL(value);
          return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
        } catch { return false; }
      },
      message: 'sourceUrl must be an HTTP(S) URL without credentials.',
    },
  },
  retrievedAt: { type: Date, required: true },
  sourceIdentifier: { type: String, required: true, trim: true, maxlength: 200 },
}, { _id: false, strict: 'throw' });

export const studyAreaSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 200 },
  slug: { type: String, required: true, trim: true, lowercase: true, maxlength: 200, match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ },
  areaType: { type: String, enum: AREA_TYPES, required: true },
  geoid: { type: String, match: /^\d{5}$/, required() { return this.areaType === 'county'; } },
  state: { type: String, trim: true, maxlength: 100 },
  stateCode: { type: String, match: /^[A-Z]{2}$/ },
  country: { type: String, required: true, trim: true, maxlength: 100 },
  countryCode: { type: String, required: true, match: /^[A-Z]{2}$/ },
  geometry: {
    type: geometrySchema,
    required() { return this.geometryStatus !== 'pending'; },
    validate: {
      validator(value) { return !value || validateGeometry(value.toObject()).valid; },
      message: 'Geometry failed structural Polygon/MultiPolygon validation.',
    },
  },
  geometrySource: { type: sourceSchema, required() { return ['official', 'verified'].includes(this.geometryStatus); } },
  geometryStatus: {
    type: String, enum: GEOMETRY_STATUSES, default: 'pending',
    validate: {
      validator(value) { return this.areaType !== 'illustrative_demo' || value === 'illustrative'; },
      message: 'Illustrative demo areas must use illustrative geometry status.',
    },
  },
  isActive: { type: Boolean, default: true },
  metadata: { type: Schema.Types.Mixed, default: () => ({}) },
}, { timestamps: true, strict: 'throw', collection: 'study_areas', bufferCommands: false });

studyAreaSchema.index({ slug: 1 }, { unique: true, name: 'study_area_slug_unique' });
studyAreaSchema.index({ countryCode: 1, geoid: 1 }, {
  unique: true,
  name: 'study_area_county_geoid_unique',
  partialFilterExpression: { areaType: 'county', geoid: { $type: 'string' } },
});
studyAreaSchema.index({ geometry: '2dsphere' }, { name: 'study_area_geometry_2dsphere' });

// Bind to the server's explicit connection, never the unused global Mongoose connection.
export function getStudyAreaModel(connection) {
  return connection.models.StudyArea ?? connection.model('StudyArea', studyAreaSchema);
}
