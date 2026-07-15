import express from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import { authRouter } from './auth/routes.js';
import { restRouter } from './rest/routes.js';
import { rpcRouter } from './rest/rpc.js';
import { storageRouter } from './storage/routes.js';
import { functionsRouter } from './functions/routes.js';

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: env.corsOrigins.length ? env.corsOrigins : true,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '25mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.get('/health', (_req, res) => res.json({ ok: true }));

  app.use('/auth', authRouter);
  app.use('/rest', restRouter);
  app.use('/rest/rpc', rpcRouter);
  app.use('/storage/v1', storageRouter);
  app.use('/functions/v1', functionsRouter);

  return app;
}
