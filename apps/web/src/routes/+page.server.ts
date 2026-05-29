import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

// The dashboard's home is the daily queue. Unauthenticated users are already
// bounced to /login by hooks.server.ts before reaching here.
export const load: PageServerLoad = async () => {
  redirect(303, "/queue");
};
