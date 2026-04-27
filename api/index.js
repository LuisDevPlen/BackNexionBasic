/**
 * Entrada serverless na Vercel — exporta a app Express.
 * Variáveis: DATABASE_URL (Neon), JWT_SECRET, CORS_ORIGIN, etc.
 */
import app from '../src/server.js';

export default app;
