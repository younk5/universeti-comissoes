import { z } from 'zod';

const rejectedLegacyProviderEnvironmentPrefix = ['FIRE', 'BASE_'].join('');
const rejectedLegacyProviderName = ['Fire', 'base'].join('');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SUPABASE_URL: z.string().url().regex(/^https:\/\/[a-z0-9-]+\.supabase\.co$/),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

const testSchema = schema.partial({
  SUPABASE_URL: true,
  SUPABASE_PUBLISHABLE_KEY: true,
  SUPABASE_SERVICE_ROLE_KEY: true,
});

export function readConfig(env) {
  if (Object.keys(env).some((name) => name.startsWith(rejectedLegacyProviderEnvironmentPrefix))) {
    throw new Error(`Variáveis ${rejectedLegacyProviderName} não são aceitas.`);
  }

  const input = (env.NODE_ENV === 'test' ? testSchema : schema).parse(env);
  return {
    nodeEnv: input.NODE_ENV,
    supabaseUrl: input.SUPABASE_URL,
    supabasePublishableKey: input.SUPABASE_PUBLISHABLE_KEY,
    supabaseServiceRoleKey: input.SUPABASE_SERVICE_ROLE_KEY,
    sessionCookieName: input.NODE_ENV === 'production' ? '__Host-galaxy-smart-refresh' : 'galaxy-smart-refresh',
    secureCookies: input.NODE_ENV === 'production',
  };
}
