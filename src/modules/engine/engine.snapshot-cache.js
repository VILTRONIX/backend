// Private, process-local snapshots. Failed/oversized builds are never retained.
export const DEFAULT_SNAPSHOT_CACHE = Object.freeze({ enabled: true, maxEntries: 8, maxBytes: 16 * 1024 * 1024, maxRecords: 100000 });

export function createSnapshotCache(options = {}) {
  if (Object.keys(options).some((key) => !Object.hasOwn(DEFAULT_SNAPSHOT_CACHE, key))) throw new Error('Invalid Engine cache option.');
  const limits = { ...DEFAULT_SNAPSHOT_CACHE, ...options };
  if (typeof limits.enabled !== 'boolean' || ['maxEntries', 'maxBytes', 'maxRecords'].some((key) => !Number.isSafeInteger(limits[key]) || limits[key] < 1)) {
    throw new Error('Invalid Engine cache limits.');
  }
  const entries = new Map(), flights = new Map();
  let bytes = 0, records = 0, generation = 0;
  const counts = { hits: 0, misses: 0, coalesced: 0, invalidations: 0, evictions: 0 };
  function remove(key) {
    const entry = entries.get(key);
    if (entry) { bytes -= entry.value.byteSize; records -= entry.value.recordCount; entries.delete(key); }
  }
  return {
    limits,
    clear() { counts.invalidations += entries.size; entries.clear(); bytes = 0; records = 0; generation += 1; },
    stats: () => ({ ...counts, entries: entries.size, bytes, records, inFlight: flights.size, ...limits }),
    async get(key, token, build) {
      const pending = flights.get(key);
      if (pending) {
        counts.coalesced += 1;
        if (pending.token === token) return pending.promise;
        // A previous manifest generation must finish before this dataset refreshes.
        await pending.promise.catch(() => {});
        return this.get(key, token, build);
      }
      const epoch = generation;
      const promise = (async () => {
        const entry = entries.get(key);
        if (entry) {
          try {
            if (entry.token !== token) throw new Error('Snapshot generation changed.');
            await entry.value.verify();
            if (entries.get(key) !== entry || epoch !== generation) throw new Error('Snapshot invalidated.');
            entries.delete(key); entries.set(key, entry); counts.hits += 1;
            return entry.value;
          } catch { remove(key); counts.invalidations += 1; }
        }
        counts.misses += 1;
        const value = await build();
        if (value.verify) await value.verify();
        if (value.metadata && value.records) {
          if (epoch === generation && value.byteSize <= limits.maxBytes && value.recordCount <= limits.maxRecords) {
            while (entries.size && (entries.size >= limits.maxEntries || bytes + value.byteSize > limits.maxBytes || records + value.recordCount > limits.maxRecords)) {
              remove(entries.keys().next().value); counts.evictions += 1;
            }
            // One synchronous publication after every validation and fingerprint check.
            entries.set(key, { token, value }); bytes += value.byteSize; records += value.recordCount;
          }
        }
        return value;
      })();
      flights.set(key, { token, promise });
      const clear = () => { if (flights.get(key)?.promise === promise) flights.delete(key); };
      void promise.then(clear, clear);
      return promise;
    },
  };
}
