import { createClient } from '@supabase/supabase-js';
import type { SupabaseClientOptions } from '@supabase/supabase-js';
import type { Database } from './contracts';

export function createLynxrClient(url: string, key: string, storage: NonNullable<SupabaseClientOptions<'public'>['auth']>['storage'],
  request?: typeof fetch) {
  return createClient<Database>(url, key, {
    auth: { storage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    global: request ? { fetch: request } : undefined,
  });
}
