import { error, redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

// Magic-link landing: Supabase redirects here with either a PKCE `code` or a
// `token_hash`+`type` pair. The SERVER client must do the exchange so the
// session cookies are written; then we hand off to the wizard (or wherever
// `next` points — same-origin paths only).

export const GET: RequestHandler = async ({ url, locals }) => {
  // Open-redirect hardening: resolve `next` against our own origin and accept
  // it only if the origin is unchanged (catches //evil.com, /\evil.com,
  // percent-encoding tricks — URL resolution normalises them all).
  const rawNext = url.searchParams.get("next") ?? "/onboarding";
  let safeNext = "/onboarding";
  try {
    const resolved = new URL(rawNext, url.origin);
    if (resolved.origin === url.origin) {
      safeNext = resolved.pathname + resolved.search + resolved.hash;
    }
  } catch {
    // keep the default
  }

  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");

  if (code) {
    const { error: err } = await locals.supabase.auth.exchangeCodeForSession(code);
    if (err) error(400, `Sign-in link is invalid or expired: ${err.message}`);
  } else if (tokenHash && type) {
    const { error: err } = await locals.supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as "email",
    });
    if (err) error(400, `Sign-in link is invalid or expired: ${err.message}`);
  } else {
    error(400, "Missing sign-in parameters — request a new link.");
  }

  redirect(303, safeNext);
};
