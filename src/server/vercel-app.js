import { createApp } from './app.js';
import { readConfig } from './config.js';
import { createServerServices } from './supabase-admin.js';

export function createVercelApp({ config = readConfig(process.env), services } = {}) {
  const initializedServices = services ?? (config.nodeEnv === 'test' ? {} : createServerServices(config));
  return createApp({ services: initializedServices, config });
}

export const app = createVercelApp();
