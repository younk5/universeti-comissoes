import { createClient as defaultCreateClient } from '@supabase/supabase-js';

const serverAuthOptions = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
};

export function createServerServices(config, { createClient = defaultCreateClient } = {}) {
  return {
    authClient: createClient(config.supabaseUrl, config.supabasePublishableKey, { auth: serverAuthOptions }),
    adminClient: createClient(config.supabaseUrl, config.supabaseServiceRoleKey, { auth: serverAuthOptions }),
  };
}
