import {
  type CookieMethodsServer,
  createBrowserClient as ssrBrowserClient,
  createServerClient as ssrServerClient,
} from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "./types";

export type { CookieMethodsServer } from "@supabase/ssr";
export type { Database, Json };
export type Client = SupabaseClient<Database>;

export interface ServiceEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

export interface PublicEnv {
  PUBLIC_SUPABASE_URL: string;
  PUBLIC_SUPABASE_ANON_KEY: string;
}

/**
 * Service-role client for the Worker. Bypasses RLS — every query MUST
 * filter `agency_id` explicitly. Sessions/auth refresh disabled because
 * this client never represents a user.
 */
export function createServiceClient(env: ServiceEnv): Client {
  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/**
 * Browser client for the SvelteKit dashboard. RLS-bound via the user's
 * session JWT (which carries `app_metadata.agency_id`).
 */
export function createBrowserClient(env: PublicEnv): Client {
  return ssrBrowserClient<Database>(env.PUBLIC_SUPABASE_URL, env.PUBLIC_SUPABASE_ANON_KEY);
}

/**
 * Server-side client for SvelteKit load functions. Caller adapts SvelteKit's
 * `event.cookies` to the @supabase/ssr `CookieMethodsServer` shape (getAll/setAll).
 * This keeps @pm/db decoupled from any specific framework.
 */
export function createServerClient(env: PublicEnv, cookies: CookieMethodsServer): Client {
  return ssrServerClient<Database>(env.PUBLIC_SUPABASE_URL, env.PUBLIC_SUPABASE_ANON_KEY, {
    cookies,
  });
}
