import { AppError } from '../../utils/appError.js';
import { parseListQuery, validateStudyAreaId } from './study-area.validation.js';

export function createStudyAreaController(service) {
  return {
    async list(req, res) {
      const data = await service.list(parseListQuery(req.query));
      res.json({ success: true, data, requestId: req.id });
    },
    async getById(req, res) {
      const data = await service.getById(validateStudyAreaId(req.params.id));
      res.json({ success: true, data, requestId: req.id });
    },
    async validate(req, res) {
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || !Object.hasOwn(req.body, 'geometry')) {
        throw new AppError(400, 'INVALID_INPUT', 'Request body must be an object containing geometry.');
      }
      const data = await service.validate(req.body.geometry);
      res.json({ success: true, data, requestId: req.id });
    },
  };
}
