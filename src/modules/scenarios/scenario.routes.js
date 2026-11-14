import { Router } from 'express';
import { getScenarioCatalog, getScenarioReadiness } from './scenario.catalog.js';
import { validatePreferenceRequest } from './scenario.validation.js';

export function createScenarioRouter(comparisonService) {
  const router = Router();
  router.get('/scenarios', (req, res) => {
    res.json({ success: true, data: getScenarioCatalog(), requestId: req.id });
  });
  router.get('/scenarios/comparison', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const data = await comparisonService.compare(req.query);
    res.json({ success: true, data, requestId: req.id });
  });
  router.post('/scenarios/preferences/validate', (req, res) => {
    const result = validatePreferenceRequest(req.body);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data: { ...result, readiness: getScenarioReadiness() }, requestId: req.id });
  });
  return router;
}
