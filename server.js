import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createApp } from './src/server/app.js';
import { readConfig } from './src/server/config.js';
import { createServerServices } from './src/server/supabase-admin.js';

const rootDirectory = dirname(fileURLToPath(import.meta.url));
const distDirectory = join(rootDirectory, 'dist');
const config = readConfig(process.env);
const services = config.nodeEnv === 'test' ? {} : createServerServices(config);

export const app = createApp({ services, config });

if (existsSync(distDirectory)) {
  app.use(express.static(distDirectory));
}

if (!process.env.VERCEL) {
  app.listen(Number(process.env.PORT ?? 3000));
}

export default app;
