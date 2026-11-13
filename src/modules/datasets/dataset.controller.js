import { validateStudyAreaId } from '../study-areas/study-area.validation.js';
import { validateSlug, parseDatasetQuery, parseAssetQuery } from './dataset.validation.js';

export function createDatasetController(service) {
  const respond = (req, res, data) => res.json({ success: true, data, requestId: req.id });
  return {
    async list(req, res) { respond(req, res, await service.list(parseDatasetQuery(req.query))); },
    async detail(req, res) { respond(req, res, await service.getBySlug(validateSlug(req.params.slug))); },
    async assets(req, res) { respond(req, res, await service.listAssets(validateSlug(req.params.slug), parseAssetQuery(req.query))); },
    async coverage(req, res) { respond(req, res, await service.getCoverage(validateSlug(req.params.slug))); },
    async areaCoverage(req, res) { respond(req, res, await service.getAreaCoverage(validateStudyAreaId(req.params.areaId), parseDatasetQuery(req.query))); },
  };
}
