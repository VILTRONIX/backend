import { AppError } from '../../utils/appError.js';

export const AREA_TYPES = ['county', 'user_drawn', 'verified_field', 'illustrative_demo'];
export const GEOMETRY_STATUSES = ['official', 'verified', 'pending', 'illustrative'];
export const MAX_GEOMETRY_BYTES = 512 * 1024;
export const MAX_COORDINATES = 20000;

export function validateGeometry(geometry) {
  const result = {
    valid: false,
    geometryType: null,
    coordinateCount: 0,
    validationErrors: [],
    warnings: [
      'Structural validation only. Self-intersections, hole placement, and full topological validity are not checked.',
      'Coordinates are interpreted as [longitude, latitude] in EPSG:4326. Swapped values within valid ranges cannot be detected.',
    ],
  };
  const fail = (message) => {
    if (result.validationErrors.length < 25) result.validationErrors.push(message);
  };
  if (!geometry || typeof geometry !== 'object' || Array.isArray(geometry)) {
    fail('geometry must be a GeoJSON geometry object.');
    return result;
  }
  if (['Polygon', 'MultiPolygon'].includes(geometry.type)) result.geometryType = geometry.type;
  else fail('geometry.type must be Polygon or MultiPolygon.');
  if (Object.hasOwn(geometry, 'crs')) fail('Custom CRS is not supported. Supply EPSG:4326 longitude/latitude coordinates.');
  try {
    if (Buffer.byteLength(JSON.stringify(geometry), 'utf8') > MAX_GEOMETRY_BYTES) {
      fail('Geometry exceeds the 512 KiB size limit.');
      return result;
    }
  } catch {
    fail('geometry must be JSON serializable.');
    return result;
  }
  if (!result.geometryType) return result;
  if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) {
    fail('geometry.coordinates must be a non-empty array.');
    return result;
  }
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  for (const [polygonIndex, polygon] of polygons.entries()) {
    if (!Array.isArray(polygon) || polygon.length === 0) {
      fail(`Polygon ${polygonIndex} must contain at least one ring.`);
      continue;
    }
    for (const [ringIndex, ring] of polygon.entries()) {
      const label = `Polygon ${polygonIndex}, ring ${ringIndex}`;
      if (!Array.isArray(ring)) {
        fail(`${label} must contain at least four positions, including the closing position.`);
        continue;
      }
      result.coordinateCount += ring.length;
      if (result.coordinateCount > MAX_COORDINATES) {
        fail(`Geometry exceeds the ${MAX_COORDINATES} coordinate limit.`);
        return result;
      }
      if (ring.length < 4) {
        fail(`${label} must contain at least four positions, including the closing position.`);
        continue;
      }
      let positionsValid = true;
      for (const [positionIndex, position] of ring.entries()) {
        if (!Array.isArray(position) || position.length !== 2 || !position.every((value) => typeof value === 'number' && Number.isFinite(value))) {
          fail(`${label}, position ${positionIndex} must contain exactly two finite numbers [longitude, latitude].`);
          positionsValid = false;
        } else if (position[0] < -180 || position[0] > 180 || position[1] < -90 || position[1] > 90) {
          fail(`${label}, position ${positionIndex} is outside longitude [-180, 180] or latitude [-90, 90].`);
          positionsValid = false;
        }
      }
      if (positionsValid) {
        const first = ring[0];
        const last = ring.at(-1);
        if (first[0] !== last[0] || first[1] !== last[1]) fail(`${label} must be closed: first and last positions must match.`);
        if (new Set(ring.map((position) => `${position[0]},${position[1]}`)).size < 3) fail(`${label} must contain at least three distinct positions.`);
      }
    }
  }
  result.valid = result.validationErrors.length === 0;
  return result;
}

export function parseListQuery(query) {
  const permitted = ['page', 'limit', 'areaType', 'geoid', 'includeGeometry'];
  if (Object.keys(query).some((key) => !permitted.includes(key))) {
    throw new AppError(400, 'INVALID_QUERY', 'Unsupported query parameter.');
  }
  const positiveInteger = (name, fallback, maximum) => {
    if (query[name] === undefined) return fallback;
    if (typeof query[name] !== 'string' || !/^[1-9]\d*$/.test(query[name]) || Number(query[name]) > maximum) {
      throw new AppError(400, 'INVALID_QUERY', `${name} must be an integer between 1 and ${maximum}.`);
    }
    return Number(query[name]);
  };
  const page = positiveInteger('page', 1, 10000);
  const limit = positiveInteger('limit', 20, 100);
  const filter = { isActive: true };
  if (query.areaType !== undefined) {
    if (!AREA_TYPES.includes(query.areaType)) throw new AppError(400, 'INVALID_QUERY', 'areaType is not supported.');
    filter.areaType = query.areaType;
  }
  if (query.geoid !== undefined) {
    if (typeof query.geoid !== 'string' || !/^\d{5}$/.test(query.geoid)) throw new AppError(400, 'INVALID_QUERY', 'geoid must be a five-digit string.');
    filter.geoid = query.geoid;
  }
  if (query.includeGeometry !== undefined && !['true', 'false'].includes(query.includeGeometry)) {
    throw new AppError(400, 'INVALID_QUERY', 'includeGeometry must be true or false.');
  }
  return { page, limit, filter, includeGeometry: query.includeGeometry === 'true' };
}

export function validateStudyAreaId(id) {
  if (typeof id !== 'string' || !/^[a-fA-F0-9]{24}$/.test(id)) {
    throw new AppError(400, 'INVALID_ID', 'Study area id must be a 24-character hexadecimal ObjectId.');
  }
  return id;
}
