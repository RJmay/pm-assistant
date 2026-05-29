import { redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

function safeNext(target: string | null): string {
  if (target?.startsWith("/") && !target.startsWith("//")) return target;
  return "/queue";
}

/** OAuth (and magic-link) callback — exchanges the `code` for a session. */
export const GET: RequestHandler = async ({ url, locals }) => {
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));

  if (code) {
    const { error } = await locals.supabase.auth.exchangeCodeForSession(code);
    if (!error) redirect(303, next);
  }
  redirect(303, "/login?error=auth_callback_failed");
};
