import { Router } from 'express';
import { createDatasetController } from './dataset.controller.js';

export function createDatasetRouter(service) {
  const router = Router();
  const controller = createDatasetController(service);
  router.get('/datasets', controller.list);
  router.get('/datasets/:slug', controller.detail);
  router.get('/datasets/:slug/assets', controller.assets);
  router.get('/datasets/:slug/coverage', controller.coverage);
  router.get('/study-areas/:areaId/coverage', controller.areaCoverage);
  return router;
}
