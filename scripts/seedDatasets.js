import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import mongoose from 'mongoose';
import { loadEnv } from '../src/config/env.js';
import { getDatasetModel } from '../src/modules/datasets/dataset.model.js';
import { getDatasetAssetModel } from '../src/modules/datasets/dataset-asset.model.js';
import { DATASET_INVENTORY } from '../data/seed/datasets.js';

// Only these descriptive fields are seed-managed. Evidence, units, coverage, and lifecycle
// updates made after insertion must survive both normal reseeding and concurrent edits.
const DESCRIPTIVE_FIELDS = ['name', 'provider', 'category', 'productId', 'productCollection', 'version', 'description', 'purpose', 'optional', 'limitations', 'tags'];

export async function seedDatasets(Dataset, inventory = DATASET_INVENTORY) {
  const slugs = inventory.map((entry) => entry.slug);
  if (new Set(slugs).size !== slugs.length) throw new Error('Dataset seed contains duplicate slugs.');
  // Validate all input before any writes, including the identity constraints that can be checked locally.
  const validated = await Promise.all(inventory.map(async (entry) => {
    const document = new Dataset(entry);
    await document.validate();
    const { _id, createdAt, updatedAt, __v, ...fields } = document.toObject();
    return fields;
  }));
  const identities = validated.filter((entry) => entry.productId && entry.version).map((entry) => `${entry.provider}:${entry.productId}:${entry.version}`);
  if (new Set(identities).size !== identities.length) throw new Error('Dataset seed contains duplicate provider/product/version identities.');
  const summary = { created: 0, updated: 0, unchanged: 0 };
  for (const entry of validated) {
    const descriptive = Object.fromEntries(DESCRIPTIVE_FIELDS.map((field) => [field, entry[field]]));
    const existing = await Dataset.findOne({ slug: entry.slug }).lean().maxTimeMS(5000);
    if (existing && DESCRIPTIVE_FIELDS.every((field) => isDeepStrictEqual(existing[field], descriptive[field]))) {
      summary.unchanged += 1;
      continue;
    }
    const insertOnly = Object.fromEntries(Object.entries(entry).filter(([key]) => !DESCRIPTIVE_FIELDS.includes(key) && key !== 'slug'));
    const result = await Dataset.updateOne(
      { slug: entry.slug },
      { $set: descriptive, $setOnInsert: { slug: entry.slug, ...insertOnly } },
      { upsert: true, runValidators: true, setDefaultsOnInsert: true },
    ).maxTimeMS(10000);
    if (result.upsertedCount) summary.created += 1;
    else if (result.modifiedCount) summary.updated += 1;
    else summary.unchanged += 1;
  }
  return summary;
}

async function main() {
  let connection;
  try {
    const config = loadEnv();
    if (!config.mongodbUri) { console.error('MONGODB_URI is required for dataset seeding. Configure the private .env file.'); process.exitCode = 1; return; }
    connection = mongoose.createConnection();
    connection.on('error', () => {});
    await connection.openUri(config.mongodbUri, { serverSelectionTimeoutMS: 10000, connectTimeoutMS: 5000, autoIndex: false, autoCreate: false });
    const Dataset = getDatasetModel(connection);
    const Asset = getDatasetAssetModel(connection);
    await Dataset.createCollection();
    await Asset.createCollection();
    await Dataset.createIndexes();
    await Asset.createIndexes();
    const assetsBefore = await Asset.countDocuments().maxTimeMS(5000);
    const summary = await seedDatasets(Dataset);
    if (await Asset.countDocuments().maxTimeMS(5000) !== assetsBefore) throw new Error('Asset count changed during registry seeding.');
    console.info(`Dataset registry seed: created=${summary.created}, updated=${summary.updated}, unchanged=${summary.unchanged}.`);
    console.info('No assets were created. Lifecycle states, coverage evidence, variables/units, and active flags on existing records were preserved.');
    console.info('Dataset and asset indexes are in place. No Study Areas records were written.');
  } catch (error) {
    if (error.code === 11000) console.error('Dataset seed failed: duplicate slug or provider/product/version identity. Review conflicting records; none were deleted.');
    else if (error.name === 'ValidationError' || error.name === 'StrictModeError') console.error('Dataset seed failed: inventory does not satisfy the registry schema.');
    else console.error('Dataset seed failed. Check Atlas access, permissions, environment configuration, and registry input/index definitions.');
    process.exitCode = 1;
  } finally {
    if (connection) await connection.close().catch(() => { console.error('Unable to close registry seed connection.'); process.exitCode = 1; });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
