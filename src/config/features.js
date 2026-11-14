import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_FEATURES_ROOT = fileURLToPath(new URL('../../data/processed/features/', import.meta.url));
const BACKEND_ROOT = fileURLToPath(new URL('../../', import.meta.url));

function localRoot(configured, name) {
  if (typeof configured !== 'string' || !configured.trim() || configured.includes('\0')
    || !path.isAbsolute(configured) || /^[/\\]{2}/.test(configured)
    || configured.split(/[/\\]/).includes('..') || configured.includes('%')) {
    throw new Error(`${name} must be an absolute local directory without traversal.`);
  }
  const resolved = path.resolve(configured);
  if (resolved === path.parse(resolved).root) throw new Error(`${name} must not be a filesystem root.`);
  return resolved;
}

export function resolveEnginePaths(environment = {}) {
  const engineRoot = environment.TERRAPULSE_ENGINE_ROOT === undefined ? null
    : localRoot(environment.TERRAPULSE_ENGINE_ROOT, 'TERRAPULSE_ENGINE_ROOT');
  return {
    engineRoot,
    featuresRoot: localRoot(environment.TERRAPULSE_FEATURES_ROOT ?? path.join(engineRoot ?? BACKEND_ROOT, 'data/processed/features'), 'TERRAPULSE_FEATURES_ROOT'),
    schemasRoot: localRoot(environment.TERRAPULSE_SCHEMAS_ROOT ?? path.join(engineRoot ?? BACKEND_ROOT, 'src/schemas'), 'TERRAPULSE_SCHEMAS_ROOT'),
  };
}

export const resolveFeaturesRoot = (environment = {}) => resolveEnginePaths(environment).featuresRoot;
