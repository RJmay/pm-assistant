// See https://svelte.dev/docs/kit/types#app.d.ts
import type { Client } from "@pm/db";
import type { Session, User } from "@supabase/supabase-js";

declare global {
  namespace App {
    interface Locals {
      /** Cookie-bound server Supabase client (RLS-enforced via the user JWT). */
      supabase: Client;
      /**
       * Verifies the session against the auth server (getUser) rather than
       * trusting the cookie's JWT blindly. Returns the agency claim too.
       */
      safeGetSession: () => Promise<{
        session: Session | null;
        user: User | null;
        agencyId: string | null;
      }>;
      session: Session | null;
      user: User | null;
      agencyId: string | null;
    }
    interface PageData {
      session: Session | null;
      user: User | null;
      agencyId: string | null;
    }
    // interface Error {}
    // interface PageState {}
    // interface Platform {}
  }
}
