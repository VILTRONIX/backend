import { Router } from 'express';
import { AppError } from '../../utils/appError.js';
import { ENGINE_DATASETS } from './engine.registry.js';

export function createEngineRouter(service) {
  const router = Router();
  router.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  const noQuery = (query) => {
    if (Object.keys(query).length) throw new AppError(400, 'INVALID_ENGINE_QUERY', 'This Engine metadata endpoint does not accept query parameters.');
  };
  router.get('/datasets', async (req, res) => {
    noQuery(req.query);
    res.json({ success: true, data: await service.listDatasets(), requestId: req.id });
  });
  router.get('/datasets/:datasetId', async (req, res) => {
    noQuery(req.query);
    res.json({ success: true, data: await service.getDataset(req.params.datasetId), requestId: req.id });
  });
  for (const definition of ENGINE_DATASETS) {
    router.get(definition.route, async (req, res) => {
      res.json({ success: true, data: await service.readDataset(definition.id, req.query), requestId: req.id });
    });
  }
  return router;
}
