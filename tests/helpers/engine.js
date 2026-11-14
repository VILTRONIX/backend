import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

export const ENGINE_FIXTURES = fileURLToPath(new URL('../fixtures/engine/', import.meta.url));
// Only writes inside a freshly created synthetic-fixture directory, never an Engine output root.
export async function engineFixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'terrapulse-synthetic-engine-'));
  await cp(ENGINE_FIXTURES, root, { recursive: true });
  t.after(async () => {
    const target = path.resolve(root), relative = path.relative(path.resolve(tmpdir()), target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)
      || !path.basename(target).startsWith('terrapulse-synthetic-engine-')) throw new Error('Unsafe synthetic fixture cleanup path.');
    const { rm } = await import('node:fs/promises');
    await rm(target, { recursive: true, force: true });
  });
  const manifest = JSON.parse(await readFile(path.join(root, 'feature_manifest.json'), 'utf8'));
  const schema = JSON.parse(await readFile(path.join(root, 'record.schema.json'), 'utf8'));
  const records = JSON.parse(await readFile(path.join(root, 'samples.json'), 'utf8'));
  return {
    root, manifest, schema, records,
    writeManifest: () => writeFile(path.join(root, 'feature_manifest.json'), JSON.stringify(manifest)),
    writeSchema: () => writeFile(path.join(root, 'record.schema.json'), JSON.stringify(schema)),
    writeRecords: () => writeFile(path.join(root, 'samples.ndjson'), records.map((record) => JSON.stringify(record)).join('\n')),
  };
}
