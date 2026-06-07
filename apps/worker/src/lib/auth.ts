import { createRemoteJWKSet, decodeProtectedHeader, type JWTVerifyGetKey, jwtVerify } from "jose";

// ============================================================================
// Dashboard JWT verification (M9 send path)
// ============================================================================
// The dashboard forwards the user's Supabase access token as a Bearer token on
// the send route. We verify it and extract the caller's identity: `sub`
// (auth.users.id) and `app_metadata.agency_id`. The Worker uses the
// service-role key downstream, which BYPASSES RLS, so the route MUST scope
// every query by this agencyId.
//
// Supabase signs access tokens with EITHER the legacy symmetric secret (HS256)
// OR — the current default — asymmetric signing keys (ES256, exposed via the
// project JWKS). We branch on the token's `alg`: HS256 → verify with the
// shared secret; ES256/RS256 → verify against the project JWKS.
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
  /** Supabase project URL; the issuer + the JWKS endpoint are derived from it. */
  supabaseUrl?: string;
  /** Test seam: a JWK key set (e.g. a local key resolver) used instead of the remote JWKS. */
  jwks?: JWTVerifyGetKey;
}

// Cache the remote JWKS resolver per project URL across requests in the same
// isolate (createRemoteJWKSet fetches + caches the keys itself).
const remoteJwksCache = new Map<string, JWTVerifyGetKey>();
function remoteJwks(supabaseUrl: string): JWTVerifyGetKey {
  const base = supabaseUrl.replace(/\/+$/, "");
  let jwks = remoteJwksCache.get(base);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${base}/auth/v1/.well-known/jwks.json`));
    remoteJwksCache.set(base, jwks);
  }
  return jwks;
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

  const baseOpts: { audience: string; issuer?: string } = { audience: "authenticated" };
  if (opts.supabaseUrl) {
    baseOpts.issuer = `${opts.supabaseUrl.replace(/\/+$/, "")}/auth/v1`;
  }

  // Branch on the token's signing algorithm (pinned per branch to avoid
  // algorithm-confusion): HS256 → shared secret; ES256/RS256 → project JWKS.
  let alg: string | undefined;
  try {
    alg = decodeProtectedHeader(token).alg;
  } catch (cause) {
    throw new AuthError("malformed token", 401, { cause });
  }

  let payload: Awaited<ReturnType<typeof jwtVerify>>["payload"];
  try {
    if (alg === "HS256") {
      const key = new TextEncoder().encode(opts.jwtSecret);
      ({ payload } = await jwtVerify(token, key, { ...baseOpts, algorithms: ["HS256"] }));
    } else {
      const keyset = opts.jwks ?? (opts.supabaseUrl ? remoteJwks(opts.supabaseUrl) : null);
      if (!keyset) {
        throw new AuthError(`unsupported token alg '${alg}' and no JWKS source configured`, 401);
      }
      ({ payload } = await jwtVerify(token, keyset, {
        ...baseOpts,
        algorithms: ["ES256", "RS256"],
      }));
    }
  } catch (cause) {
    if (cause instanceof AuthError) throw cause;
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
