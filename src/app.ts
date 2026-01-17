import express from 'express';
import cors from 'cors';

// Routes
import router from './route';

// Middlewares
import { errorHandler } from './middlewares/errorHandler';

// Scalar
import { apiReference } from '@scalar/express-api-reference';
import openapiSpecification from './config/openapi';

const app = express();

app.set('trust proxy', 1); // trust first proxy (Nginx)

// CORS middleware - enables frontend requests
app.use(
  cors({
    origin: true, // Allow all origins in development (or specify frontend URL)
    credentials: true,
  }),
);

app.use(express.json());

// Serve OpenAPI JSON
app.get('/openapi.json', (req, res) => {
  res.json(openapiSpecification);
});

// Setup Scalar API Reference
app.use(
  '/docs',
  apiReference({
    url: '/openapi.json',
  }),
);

// Entry routes
app.get('/', (req: express.Request, res: express.Response) => {
  res.send({
    status: 'success',
    data: {
      message: 'Playtipus API',
    },
  });
});

// Routes
app.use('/v1', router);

// Global error handler (should be after routes)
app.use(
  (
    err: Error,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    errorHandler(err, req, res, next);
  },
);

export default app;