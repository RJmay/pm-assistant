// Public client config, sourced from BUILD-TIME static env.
//
// On Cloudflare Pages, `$env/dynamic/public` does not read runtime Pages
// variables (it targets Node-style platforms), so the values come back empty
// and the Supabase client fails to construct. These PUBLIC_ values are
// non-secret, so we embed them at build time via `$env/static/public` instead.
// Local dev + CI read them from `.env.local` / the build environment.
//
// Exposed as an `env` object so call sites keep the `env.PUBLIC_*` shape they
// used with `$env/dynamic/public`.
import {
  PUBLIC_SUPABASE_ANON_KEY,
  PUBLIC_SUPABASE_URL,
  PUBLIC_WORKER_URL,
} from "$env/static/public";

export const env = {
  PUBLIC_SUPABASE_URL,
  PUBLIC_SUPABASE_ANON_KEY,
  PUBLIC_WORKER_URL,
};
