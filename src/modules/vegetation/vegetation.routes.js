import { Router } from 'express';
import { AppError } from '../../utils/appError.js';
import { parseVegetationQuery, validPeriodKey } from './vegetation.validation.js';

export function createVegetationRouter(service) {
  const router = Router();
  router.get('/observations/vegetation', async (req, res) => {
    const data = await service.list(parseVegetationQuery(req.query));
    res.json({ success: true, data, requestId: req.id });
  });
  router.get('/observations/vegetation/summary', async (req, res) => {
    const data = await service.summary(parseVegetationQuery(req.query, { summary: true }));
    res.json({ success: true, data, requestId: req.id });
  });
  router.get('/observations/vegetation/:date', async (req, res) => {
    const options = parseVegetationQuery(req.query, { lookup: true });
    if (!validPeriodKey(req.params.date, options.resolution)) throw new AppError(400, 'INVALID_PERIOD', `Period must be a valid ${options.resolution === 'monthly' ? 'YYYY-MM month' : 'YYYY-MM-DD date'}.`);
    const data = await service.getByPeriod(req.params.date, options);
    res.json({ success: true, data, requestId: req.id });
  });
  return router;
}
