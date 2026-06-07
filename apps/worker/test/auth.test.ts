import { generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { AuthError, verifyDashboardJwt } from "../src/lib/auth";

const SECRET = "test-supabase-jwt-secret-0123456789";
const SUPABASE_URL = "http://127.0.0.1:54321";
const key = new TextEncoder().encode(SECRET);

interface TokenOpts {
  sub?: string | null;
  agencyId?: string | null;
  audience?: string;
  issuer?: string;
  alg?: "HS256";
  secret?: Uint8Array;
}

async function makeToken(opts: TokenOpts = {}): Promise<string> {
  const appMetadata: Record<string, unknown> = {};
  if (opts.agencyId !== null) appMetadata.agency_id = opts.agencyId ?? "agency-aaa";
  const jwt = new SignJWT({ app_metadata: appMetadata })
    .setProtectedHeader({ alg: opts.alg ?? "HS256" })
    .setAudience(opts.audience ?? "authenticated")
    .setIssuer(opts.issuer ?? `${SUPABASE_URL}/auth/v1`)
    .setExpirationTime("1h");
  if (opts.sub !== null) jwt.setSubject(opts.sub ?? "auth-user-1");
  return jwt.sign(opts.secret ?? key);
}

const opts = { jwtSecret: SECRET, supabaseUrl: SUPABASE_URL };

describe("verifyDashboardJwt", () => {
  it("extracts authUserId + agencyId from a valid token", async () => {
    const token = await makeToken({ sub: "user-9", agencyId: "agency-xyz" });
    const identity = await verifyDashboardJwt(token, opts);
    expect(identity).toEqual({ authUserId: "user-9", agencyId: "agency-xyz" });
  });

  it("rejects a missing token (401)", async () => {
    await expect(verifyDashboardJwt("", opts)).rejects.toMatchObject({ status: 401 });
  });

  it("rejects a token signed with the wrong secret (401)", async () => {
    const token = await makeToken({
      secret: new TextEncoder().encode("a-different-secret-000000000000"),
    });
    await expect(verifyDashboardJwt(token, opts)).rejects.toBeInstanceOf(AuthError);
  });

  it("rejects a wrong issuer (401)", async () => {
    const token = await makeToken({ issuer: "https://evil.example/auth/v1" });
    await expect(verifyDashboardJwt(token, opts)).rejects.toMatchObject({ status: 401 });
  });

  it("rejects a wrong audience (401)", async () => {
    const token = await makeToken({ audience: "anon" });
    await expect(verifyDashboardJwt(token, opts)).rejects.toMatchObject({ status: 401 });
  });

  it("rejects a token without an agency_id claim (403)", async () => {
    const token = await makeToken({ agencyId: null });
    await expect(verifyDashboardJwt(token, opts)).rejects.toMatchObject({ status: 403 });
  });

  it("verifies without issuer check when supabaseUrl is omitted", async () => {
    const token = await makeToken();
    const identity = await verifyDashboardJwt(token, { jwtSecret: SECRET });
    expect(identity.agencyId).toBe("agency-aaa");
  });

  // Supabase's default is now asymmetric signing keys (ES256, verified via JWKS).
  it("verifies an ES256 token via the JWKS", async () => {
    const { publicKey, privateKey } = await generateKeyPair("ES256");
    const token = await new SignJWT({ app_metadata: { agency_id: "agency-es" } })
      .setProtectedHeader({ alg: "ES256" })
      .setSubject("user-es")
      .setAudience("authenticated")
      .setIssuer(`${SUPABASE_URL}/auth/v1`)
      .setExpirationTime("1h")
      .sign(privateKey);
    const identity = await verifyDashboardJwt(token, { ...opts, jwks: async () => publicKey });
    expect(identity).toEqual({ authUserId: "user-es", agencyId: "agency-es" });
  });

  it("rejects an ES256 token signed by a different key (401)", async () => {
    const signer = await generateKeyPair("ES256");
    const other = await generateKeyPair("ES256");
    const token = await new SignJWT({ app_metadata: { agency_id: "agency-es" } })
      .setProtectedHeader({ alg: "ES256" })
      .setSubject("user-es")
      .setAudience("authenticated")
      .setIssuer(`${SUPABASE_URL}/auth/v1`)
      .setExpirationTime("1h")
      .sign(signer.privateKey);
    await expect(
      verifyDashboardJwt(token, { ...opts, jwks: async () => other.publicKey }),
    ).rejects.toBeInstanceOf(AuthError);
  });
});
