import { Router } from 'express';

export function createHealthRouter({ database }) {
  const router = Router();

  router.get('/live', (req, res) => {
    res.json({ success: true, data: { status: 'alive' }, requestId: req.id });
  });

  router.get('/ready', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const databaseStatus = database.getStatus();
    if (!databaseStatus.ready) {
      return res.status(503).json({
        success: false,
        error: {
          code: 'NOT_READY',
          message: 'Service is not ready.',
          details: { database: databaseStatus },
        },
        requestId: req.id,
      });
    }
    res.json({
      success: true,
      data: { status: 'ready', database: databaseStatus },
      requestId: req.id,
    });
  });

  return router;
}
