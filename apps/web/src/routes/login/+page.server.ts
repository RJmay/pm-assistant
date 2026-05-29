import { fail, redirect } from "@sveltejs/kit";
import type { Actions } from "./$types";

/** Guard against open-redirects: only allow local absolute paths. */
function safeRedirect(target: string | null): string {
  if (target?.startsWith("/") && !target.startsWith("//")) return target;
  return "/queue";
}

export const actions: Actions = {
  login: async ({ request, locals, url }) => {
    const form = await request.formData();
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    if (!email || !password) {
      return fail(400, { error: "Email and password are required.", email });
    }
    const { error } = await locals.supabase.auth.signInWithPassword({ email, password });
    if (error) {
      return fail(400, { error: error.message, email });
    }
    redirect(303, safeRedirect(url.searchParams.get("redirectTo")));
  },

  google: async ({ locals, url }) => {
    const next = safeRedirect(url.searchParams.get("redirectTo"));
    const { data, error } = await locals.supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${url.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    if (error || !data.url) {
      return fail(400, { error: error?.message ?? "Could not start Google sign-in." });
    }
    redirect(303, data.url);
  },
};
