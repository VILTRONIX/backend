import path from 'node:path';
import { open, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export class EngineIssue extends Error {
  constructor(status, reason) { super(reason); this.status = status; this.reason = reason; }
}
export const fail = (status, reason) => { throw new EngineIssue(status, reason); };
export const checksum = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function validateReference(reference) {
  if (typeof reference !== 'string' || reference.length > 512
    || reference.split('/').some((part) => !/^[a-zA-Z0-9_][a-zA-Z0-9._-]*$/.test(part) || ['.', '..'].includes(part))) {
    fail('validation_failed', 'unsafe_reference');
  }
  return reference;
}
const contained = (root, file) => {
  const relative = path.relative(root, file);
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};
const same = (a, b) => ['size', 'mtimeMs', 'ctimeMs', 'ino', 'dev'].every((key) => a[key] === b[key]);

// Cache guards retain metadata only, never a closed file handle or read stream.
function metadataGuard(root, anchor, requested, resolved, before) {
  return async () => {
    if (await realpath(root) !== anchor || await realpath(requested) !== resolved || !same(before, await stat(resolved))) {
      fail('validation_failed', 'source_changed');
    }
  };
}

export async function openSource(root, reference, missingStatus = 'missing_file') {
  validateReference(reference);
  let handle;
  try {
    const anchor = await realpath(root);
    const requested = path.resolve(anchor, reference);
    const resolved = await realpath(requested);
    if (!contained(anchor, resolved)) fail('validation_failed', 'unsafe_reference');
    handle = await open(resolved, 'r');
    const before = await handle.stat();
    if (!before.isFile()) fail('validation_failed', 'not_regular_file');
    const verifyPathUnchanged = metadataGuard(root, anchor, requested, resolved, before);
    return {
      handle, size: before.size,
      async verifyUnchanged() {
        await verifyPathUnchanged();
        if (!same(before, await handle.stat())) {
          fail('validation_failed', 'source_changed');
        }
      },
      verifyPathUnchanged,
      close: () => handle.close(),
    };
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error instanceof EngineIssue) throw error;
    if (['ENOENT', 'ENOTDIR'].includes(error.code)) fail(missingStatus, missingStatus);
    fail('validation_failed', 'source_unreadable');
  }
}

export async function readDocument(root, reference, { maxBytes, missingStatus, invalidStatus }) {
  const source = await openSource(root, reference, missingStatus);
  try {
    if (source.size > maxBytes) fail(invalidStatus, 'document_too_large');
    // Bounded reads also enforce the limit if a file grows after opening.
    const chunks = []; let bytesRead = 0;
    for await (const chunk of source.handle.createReadStream({ autoClose: false, highWaterMark: 65536 })) {
      bytesRead += chunk.length;
      if (bytesRead > maxBytes) fail(invalidStatus, 'document_too_large');
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    let value;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { fail(invalidStatus, 'invalid_json_document'); }
    await source.verifyUnchanged();
    return { value, checksum: checksum(bytes), verifyUnchanged: source.verifyPathUnchanged };
  } finally { await source.close(); }
}
