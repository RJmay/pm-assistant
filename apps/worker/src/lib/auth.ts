import { jwtVerify } from "jose";

// ============================================================================
// Dashboard JWT verification (M9 send path)
// ============================================================================
// The dashboard forwards the user's Supabase access token (HS256, signed with
// the project JWT secret) as a Bearer token on the send route. We verify it
// here and extract the caller's identity: `sub` (auth.users.id) and
// `app_metadata.agency_id`. The Worker uses the service-role key downstream,
// which BYPASSES RLS, so the route MUST scope every query by this agencyId.
//
// If the Supabase project later switches to asymmetric signing keys, swap the
// symmetric secret for JWKS verification (the Worker already has a JWKS helper
// in services/pubsub.ts to model that on).
// ============================================================================

export class AuthError extends Error {
  override readonly name = "AuthError";
  readonly status: 401 | 403;
  readonly reason: string;
  constructor(reason: string, status: 401 | 403 = 401, opts?: { cause?: unknown }) {
    super(`Auth failed: ${reason}`, { cause: opts?.cause });
    this.reason = reason;
    this.status = status;
  }
}

export interface DashboardIdentity {
  /** Supabase auth.users.id — the JWT `sub`. */
  authUserId: string;
  /** `app_metadata.agency_id` — the tenant the caller belongs to. */
  agencyId: string;
}

export interface VerifyDashboardJwtOpts {
  jwtSecret: string;
  /** Supabase project URL; used to derive the expected issuer when present. */
  supabaseUrl?: string;
}

/**
 * Verify a dashboard-issued Supabase access token and return the caller's
 * identity. Throws `AuthError` (401 bad token / 403 missing agency claim).
 */
export async function verifyDashboardJwt(
  token: string,
  opts: VerifyDashboardJwtOpts,
): Promise<DashboardIdentity> {
  if (!token) throw new AuthError("missing bearer token", 401);

  const key = new TextEncoder().encode(opts.jwtSecret);
  const verifyOpts: { algorithms: string[]; audience: string; issuer?: string } = {
    algorithms: ["HS256"], // pin the alg to avoid algorithm-confusion attacks
    audience: "authenticated",
  };
  if (opts.supabaseUrl) {
    verifyOpts.issuer = `${opts.supabaseUrl.replace(/\/+$/, "")}/auth/v1`;
  }

  let payload: Awaited<ReturnType<typeof jwtVerify>>["payload"];
  try {
    ({ payload } = await jwtVerify(token, key, verifyOpts));
  } catch (cause) {
    throw new AuthError(cause instanceof Error ? cause.message : "verification failed", 401, {
      cause,
    });
  }

  const authUserId = typeof payload.sub === "string" ? payload.sub : null;
  if (!authUserId) throw new AuthError("token missing sub claim", 401);

  const appMeta = payload.app_metadata;
  const agencyIdRaw =
    appMeta !== null && typeof appMeta === "object" && "agency_id" in appMeta
      ? (appMeta as Record<string, unknown>).agency_id
      : undefined;
  if (typeof agencyIdRaw !== "string" || agencyIdRaw.length === 0) {
    throw new AuthError("token missing app_metadata.agency_id", 403);
  }

  return { authUserId, agencyId: agencyIdRaw };
}
