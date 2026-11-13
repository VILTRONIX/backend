import { Router } from 'express';
import { createStudyAreaController } from './study-area.controller.js';

export function createStudyAreaRouter(service) {
  const router = Router();
  const controller = createStudyAreaController(service);
  router.get('/study-areas', controller.list);
  router.get('/study-areas/:id', controller.getById);
  router.post('/areas/validate', controller.validate);
  return router;
}
