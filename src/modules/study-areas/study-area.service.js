import { AppError } from '../../utils/appError.js';
import { getStudyAreaModel } from './study-area.model.js';
import { validateGeometry } from './study-area.validation.js';

export function createStudyAreaService({ database, model }) {
  const getModel = () => model ?? getStudyAreaModel(database.getConnection());
  async function queryDatabase(operation) {
    if (!database.isReady()) throw new AppError(503, 'DATABASE_UNAVAILABLE', 'Database is not ready.');
    try {
      return await operation(getModel());
    } catch (error) {
      if (!database.isReady() || /^Mongo(Network|ServerSelection|TopologyClosed|NotConnected)/.test(error.name) || error.code === 50) {
        throw new AppError(503, 'DATABASE_UNAVAILABLE', 'Database is temporarily unavailable.');
      }
      throw error;
    }
  }

  async function list({ page, limit, filter, includeGeometry }) {
    return queryDatabase(async (StudyArea) => {
      const [items, total] = await Promise.all([
        StudyArea.find(filter).select(includeGeometry ? '-__v' : '-geometry -__v')
          .sort({ name: 1, _id: 1 }).skip((page - 1) * limit).limit(limit).maxTimeMS(5000).lean(),
        StudyArea.countDocuments(filter).maxTimeMS(5000),
      ]);
      return { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
    });
  }

  async function getById(id) {
    const area = await queryDatabase((StudyArea) => StudyArea.findOne({ _id: id, isActive: true }).select('-__v').maxTimeMS(5000).lean());
    if (!area) throw new AppError(404, 'STUDY_AREA_NOT_FOUND', 'Study area was not found.');
    return area;
  }

  async function validate(geometry) {
    const result = validateGeometry(geometry);
    result.pilotIntersection = { status: 'unavailable', intersects: null, fullContainment: 'not_evaluated' };
    if (!result.valid) {
      result.pilotIntersection.reason = 'STRUCTURAL_VALIDATION_FAILED';
      return result;
    }
    if (!database.isReady()) {
      result.pilotIntersection.reason = 'DATABASE_UNAVAILABLE';
      return result;
    }
    try {
      await queryDatabase(async (StudyArea) => {
        const county = await StudyArea.findOne({
          countryCode: 'US', areaType: 'county', geoid: '19169', isActive: true,
          geometryStatus: 'official', geometry: { $exists: true, $ne: null },
        }).select('_id').maxTimeMS(5000).lean();
        if (!county) {
          result.pilotIntersection.reason = 'OFFICIAL_COUNTY_NOT_AVAILABLE';
          return;
        }
        const match = await StudyArea.exists({
          _id: county._id,
          geometry: { $geoIntersects: { $geometry: { type: geometry.type, coordinates: geometry.coordinates } } },
        }).maxTimeMS(5000);
        result.pilotIntersection = {
          status: 'evaluated', intersects: Boolean(match), fullContainment: 'not_evaluated',
          geoid: '19169', operator: '$geoIntersects',
        };
        result.warnings.push('Intersection does not establish full containment. Boundary-only contact may not be reported by MongoDB.');
      });
    } catch (error) {
      if (error instanceof AppError && error.code === 'DATABASE_UNAVAILABLE') {
        result.pilotIntersection.reason = 'DATABASE_UNAVAILABLE';
      } else if (error.name === 'MongoServerError' && [2, 16755, 14031].includes(error.code)) {
        result.pilotIntersection.reason = 'GEOSPATIAL_QUERY_REJECTED';
        result.warnings.push('MongoDB rejected the geospatial query. Structural validity does not establish topological validity.');
      } else {
        throw error;
      }
    }
    return result;
  }

  return { list, getById, validate };
}
