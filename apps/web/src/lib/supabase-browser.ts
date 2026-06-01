import { type Client, createBrowserClient } from "@pm/db";
import { env } from "$lib/public-env";

// Singleton browser client. @supabase/ssr's browser client reads the auth
// session from document.cookie (set server-side by hooks.server.ts), so
// realtime subscriptions inherit the authenticated user and RLS applies.
let client: Client | undefined;

export function getBrowserClient(): Client {
  if (!client) {
    client = createBrowserClient({
      PUBLIC_SUPABASE_URL: env.PUBLIC_SUPABASE_URL ?? "",
      PUBLIC_SUPABASE_ANON_KEY: env.PUBLIC_SUPABASE_ANON_KEY ?? "",
    });
  }
  return client;
}
