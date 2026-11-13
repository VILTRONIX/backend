import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import mongoose from 'mongoose';
import { loadEnv } from '../src/config/env.js';
import { getStudyAreaModel, studyAreaSchema } from '../src/modules/study-areas/study-area.model.js';
import { validateGeometry } from '../src/modules/study-areas/study-area.validation.js';

const defaultSeedFile = fileURLToPath(new URL('../data/seed/story-county.geojson', import.meta.url));

class SeedInputError extends Error {}

export async function readStoryCountySeed(file = defaultSeedFile) {
  let feature;
  try {
    if ((await stat(file)).size > 2 * 1024 * 1024) throw new SeedInputError('Seed file exceeds the 2 MiB limit.');
    feature = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error instanceof SeedInputError) throw error;
    if (error.code === 'ENOENT') throw new SeedInputError('Official GeoJSON is missing: data/seed/story-county.geojson. Acquire the Census boundary before seeding.');
    throw new SeedInputError('Seed file cannot be read or is not valid JSON.');
  }
  const properties = feature?.properties;
  const source = properties?.geometrySource;
  if (feature?.type !== 'Feature' || properties?.geoid !== '19169' || properties?.name !== 'Story County'
      || properties?.areaType !== 'county' || properties?.countryCode !== 'US' || properties?.stateCode !== 'IA'
      || properties?.geometryStatus !== 'official' || properties?.crs !== 'EPSG:4326') {
    throw new SeedInputError('Seed must be an official EPSG:4326 Story County Feature with GEOID 19169, state IA, country US.');
  }
  if (source?.provider !== 'US Census Bureau' || source?.sourceIdentifier !== '19169'
      || !/^20\d{2}$/.test(source?.vintage ?? '') || typeof source?.dataset !== 'string' || !source.dataset.startsWith('TIGER/Line')
      || !Number.isFinite(Date.parse(source?.retrievedAt))
      || source?.sourceUrl !== `https://www2.census.gov/geo/tiger/TIGER${source.vintage}/COUNTY/tl_${source.vintage}_us_county.zip`) {
    throw new SeedInputError('Seed requires complete official Census TIGER/Line provenance, vintage, retrieval date, and county archive URL.');
  }
  const validation = validateGeometry(feature.geometry);
  if (!validation.valid) throw new SeedInputError(`Seed geometry is invalid: ${validation.validationErrors.join(' ')}`);
  return feature;
}

export async function seedStoryCounty(StudyArea, feature) {
  const { properties, geometry } = feature;
  // Explicitly whitelist fields; never persist arbitrary GeoJSON properties as model paths.
  const area = {
    name: 'Story County', slug: 'story-county-iowa', areaType: 'county', geoid: '19169',
    state: 'Iowa', stateCode: 'IA', country: 'United States', countryCode: 'US',
    geometry, geometryStatus: 'official', geometrySource: properties.geometrySource,
    isActive: true, metadata: { ...properties.metadata, crs: 'EPSG:4326' },
  };
  await new StudyArea(area).validate();
  await StudyArea.createCollection();
  // Add required indexes without dropping existing indexes or deleting conflicting records.
  await StudyArea.createIndexes();
  const saved = await StudyArea.findOneAndUpdate(
    { countryCode: 'US', areaType: 'county', geoid: '19169' },
    { $set: area },
    { upsert: true, returnDocument: 'after', runValidators: true, setDefaultsOnInsert: true },
  ).maxTimeMS(10000);
  const stored = await StudyArea.findById(saved._id).lean().maxTimeMS(5000);
  const indexes = await StudyArea.listIndexes();
  const countyCount = await StudyArea.countDocuments({ countryCode: 'US', areaType: 'county', geoid: '19169' }).maxTimeMS(5000);
  const expectedSource = { ...area.geometrySource, retrievedAt: new Date(area.geometrySource.retrievedAt) };
  const indexesMatch = studyAreaSchema.indexes().every(([key, options]) => indexes.some((index) =>
    index.name === options.name && isDeepStrictEqual(index.key, key)
      && Boolean(index.unique) === Boolean(options.unique)
      && isDeepStrictEqual(index.partialFilterExpression, options.partialFilterExpression)));
  if (!stored || !validateGeometry(stored.geometry).valid || !isDeepStrictEqual(stored.geometry, geometry)
      || !isDeepStrictEqual(stored.geometrySource, expectedSource)
      || !isDeepStrictEqual(stored.metadata, area.metadata) || !indexesMatch || countyCount !== 1) {
    throw new SeedInputError('Seed verification failed: stored geometry, full provenance, required indexes, or county count does not match.');
  }
  return stored;
}

async function main() {
  let connection;
  try {
    const feature = await readStoryCountySeed();
    const config = loadEnv();
    if (!config.mongodbUri) throw new SeedInputError('MONGODB_URI is required for seeding. Configure your private .env file.');
    connection = mongoose.createConnection();
    connection.on('error', () => {}); // The sanitized catch below handles errors without logging driver messages.
    await connection.openUri(config.mongodbUri, {
      serverSelectionTimeoutMS: 10000, connectTimeoutMS: 5000, autoIndex: false, autoCreate: false,
    });
    const stored = await seedStoryCounty(getStudyAreaModel(connection), feature);
    console.info(`Seed verified: official Story County, GEOID 19169, TIGER/Line ${stored.geometrySource.vintage}, database ${connection.db.databaseName}, id ${stored._id}.`);
    console.info('Stored geometry read back successfully; unique indexes and geometry 2dsphere index are in place.');
  } catch (error) {
    if (error instanceof SeedInputError) console.error(error.message);
    else if (error.code === 11000) console.error('Seeding failed: duplicate slug or county GEOID. Review existing records; no conflicting records were deleted.');
    else if (error.name === 'ValidationError' || [2, 16755].includes(error.code)) console.error('Seeding failed: schema or MongoDB geospatial validation rejected the geometry. Review the official seed file.');
    else console.error('Seeding failed. Check environment configuration, Atlas credentials, IP access, permissions, and index compatibility.');
    process.exitCode = 1;
  } finally {
    if (connection) await connection.close().catch(() => {
      console.error('Unable to close the seed database connection.');
      process.exitCode = 1;
    });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
