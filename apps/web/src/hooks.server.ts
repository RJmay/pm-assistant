import { createServerClient } from "@pm/db";
import { type Handle, redirect } from "@sveltejs/kit";
import { env } from "$lib/public-env";

// Routes reachable without an authenticated session. Everything else
// redirects to /login.
const PUBLIC_PREFIXES = ["/login", "/signup", "/auth"];

function isPublic(path: string): boolean {
  return PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

export const handle: Handle = async ({ event, resolve }) => {
  const supabase = createServerClient(
    {
      PUBLIC_SUPABASE_URL: env.PUBLIC_SUPABASE_URL ?? "",
      PUBLIC_SUPABASE_ANON_KEY: env.PUBLIC_SUPABASE_ANON_KEY ?? "",
    },
    {
      getAll: () => event.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value, options } of cookiesToSet) {
          event.cookies.set(name, value, { ...options, path: "/" });
        }
      },
    },
  );
  event.locals.supabase = supabase;

  // getSession() reads the cookie; getUser() re-validates it against the auth
  // server. We only trust a session once getUser confirms it.
  event.locals.safeGetSession = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return { session: null, user: null, agencyId: null };

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error || !user) return { session: null, user: null, agencyId: null };

    const agencyId =
      typeof user.app_metadata?.agency_id === "string" ? user.app_metadata.agency_id : null;
    return { session, user, agencyId };
  };

  const { session, user, agencyId } = await event.locals.safeGetSession();
  event.locals.session = session;
  event.locals.user = user;
  event.locals.agencyId = agencyId;

  const path = event.url.pathname;
  if (!isPublic(path) && !user) {
    redirect(303, `/login?redirectTo=${encodeURIComponent(path + event.url.search)}`);
  }
  if ((path === "/login" || path === "/signup") && user) {
    redirect(303, agencyId ? "/queue" : "/onboarding");
  }
  // A signed-in user with no agency yet (fresh magic-link signup) can only be
  // in the onboarding wizard — every other page needs a tenant.
  if (user && !agencyId && !isPublic(path) && path !== "/onboarding") {
    redirect(303, "/onboarding");
  }

  return resolve(event, {
    // Supabase needs these response headers passed through to the client.
    filterSerializedResponseHeaders: (name) =>
      name === "content-range" || name === "x-supabase-api-version",
  });
};
