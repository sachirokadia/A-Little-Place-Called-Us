import { Router } from 'express';
import { prisma } from '../db.js';
import { storage } from '../lib/storage.js';

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  res.json({ data: { status: 'ok' } });
});

healthRouter.get('/health/ready', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    // Storage reachability only (no write, no details in the response).
    storage();
    res.json({ data: { status: 'ready' } });
  } catch {
    res.status(503).json({ data: { status: 'not-ready' } });
  }
});
