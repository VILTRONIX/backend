import mongoose from 'mongoose';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../src/config/env.js';
import { validateModisSources, planModisImport, commitModisImport, ModisImportError } from '../src/modules/vegetation/modis-import.service.js';
import { APPROVED_SOURCES, SPATIAL_PROVENANCE } from '../src/modules/vegetation/vegetation.constants.js';

async function main() {
  let connection;
  try {
    const args = process.argv.slice(2);
    if (args.some((arg) => !['--commit', '--dry-run'].includes(arg)) || (args.includes('--commit') && args.includes('--dry-run'))) throw new ModisImportError('Usage: node scripts/ingestModis.js [--dry-run | --commit]. Default is dry-run.');
    const config = loadEnv();
    const sources = await validateModisSources(process.env.TERRAPULSE_DATA_ROOT);
    console.info(JSON.stringify({ phase: 'source-validation', passed: true, monthlyStdRecalculated: false, fingerprints: Object.entries(APPROVED_SOURCES).map(([resolution, source]) => ({ resolution, fileName: source.fileName, sizeBytes: source.sizeBytes, sha256: source.checksum, records: source.rowCount })), monthlyObservationCountSum: sources.reconciliation.observationCountSum, weightedMeanDifferences: sources.reconciliation.maxAbsoluteMeanDifference }));
    if (!config.mongodbUri) throw new ModisImportError('Source gates passed, but MONGODB_URI is missing. Database conflicts cannot be checked; commit is not permitted.');
    connection = mongoose.createConnection();
    connection.on('error', () => {});
    await connection.openUri(config.mongodbUri, { serverSelectionTimeoutMS: 10000, connectTimeoutMS: 5000, autoCreate: false, autoIndex: false });
    const hello = await connection.db.admin().command({ hello: 1 });
    if (hello.logicalSessionTimeoutMinutes == null || (!hello.setName && hello.msg !== 'isdbgrid')) throw new ModisImportError('MongoDB transactions are required. No non-transactional import fallback is permitted.');
    const plan = await planModisImport(connection, sources);
    console.info(JSON.stringify({ phase: 'dry-run', passed: true, transactionSupport: true, counts: plan.counts, ...SPATIAL_PROVENANCE, lifecycleBefore: { acquisition: plan.dataset.acquisition.status, validation: plan.dataset.validation.status, processing: plan.dataset.processing.status } }));
    if (args.includes('--commit')) {
      const result = await commitModisImport(connection, sources);
      console.info(JSON.stringify({ phase: 'commit-and-read-back', passed: true, ...result }));
    } else console.info('Dry-run only: no MongoDB collections, indexes, assets, observations, or lifecycle fields were written.');
  } catch (error) {
    if (error instanceof ModisImportError) {
      console.error(error.message);
      if (error.details) console.error(JSON.stringify(error.details));
    } else if (error.code === 11000) console.error('Import stopped on a duplicate key or concurrent conflict. No conflicting records were overwritten.');
    else console.error('MODIS import failed. Check Atlas connectivity/transaction support, permissions, model validation, and index compatibility. Raw driver errors are suppressed to protect credentials.');
    process.exitCode = 1;
  } finally {
    if (connection) await connection.close().catch(() => { console.error('Unable to close the import database connection.'); process.exitCode = 1; });
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
