import { Router } from 'express';
import { createStudyAreaService } from '../modules/study-areas/study-area.service.js';
import { createStudyAreaRouter } from '../modules/study-areas/study-area.routes.js';
import { createDatasetService } from '../modules/datasets/dataset.service.js';
import { createDatasetRouter } from '../modules/datasets/dataset.routes.js';
import { createVegetationRouter } from '../modules/vegetation/vegetation.routes.js';
import { createVegetationService } from '../modules/vegetation/vegetation.service.js';

export function createApiRouter({ config, database, studyAreaService, datasetService, vegetationService }) {
  const router = Router();

  router.get('/meta', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      success: true,
      data: {
        project: 'TerraPulse',
        apiVersion: 'v1',
        pilotLocation: 'Story County, Iowa, USA',
        environment: config.nodeEnv,
        serviceStatus: database.isReady() ? 'ready' : 'degraded',
      },
      requestId: req.id,
    });
  });

  router.use(createStudyAreaRouter(studyAreaService ?? createStudyAreaService({ database })));
  router.use(createDatasetRouter(datasetService ?? createDatasetService({ database })));
  router.use(createVegetationRouter(vegetationService ?? createVegetationService({ database })));
  return router;
}
