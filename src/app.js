import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { requestId } from './middleware/requestId.js';
import { notFound } from './middleware/notFound.js';
import { createErrorHandler } from './middleware/errorHandler.js';
import { createHealthRouter } from './modules/health/health.routes.js';
import { createApiRouter } from './routes/index.js';
import { createEngineService } from './modules/engine/engine.service.js';

morgan.token('request-id', (req) => req.id);
// Log registered route patterns only; raw paths and query strings may contain secrets.
morgan.token('route', (req) => req.route?.path ?? '[unmatched]');

export function createApp({ config, database, logger = console, studyAreaService, datasetService, vegetationService, engineService }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);
  app.use(requestId);
  app.use(helmet());
  app.use(morgan(':method :route :status :response-time ms requestId=:request-id', {
    stream: { write: (message) => logger.info(message.trimEnd()) },
  }));
  app.use(cors({
    origin(origin, callback) {
      // CLI clients, probes, and server-to-server requests may omit Origin.
      if (!origin || config.clientOrigins.includes(origin)) return callback(null, true);
      const error = new Error('Origin is not allowed.');
      error.code = 'CORS_ORIGIN_DENIED';
      callback(error);
    },
    exposedHeaders: ['X-Request-ID'],
  }));
  app.use('/api/v1/areas/validate', express.json({ limit: '1mb' }));
  app.use(express.json({ limit: '100kb' }));

  app.get('/', (req, res) => {
    res.json({
      success: true,
      data: { message: 'Welcome to the TerraPulse API.', apiVersion: 'v1' },
      requestId: req.id,
    });
  });
  const engine = engineService ?? createEngineService({ engineRoot: config.engineRoot, featuresRoot: config.featuresRoot, schemasRoot: config.schemasRoot });
  app.use('/health', createHealthRouter({ database, engineService: engine }));
  app.use('/api/v1', createApiRouter({ config, database, studyAreaService, datasetService, vegetationService, engineService: engine }));
  app.use(notFound);
  app.use(createErrorHandler({ logger }));

  return app;
}
