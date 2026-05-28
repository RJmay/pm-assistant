import { PubSubVerificationError } from "@pm/shared";
import {
  createLocalJWKSet,
  createRemoteJWKSet,
  type JSONWebKeySet,
  type JWTPayload,
  type JWTVerifyGetKey,
  jwtVerify,
} from "jose";

const GOOGLE_ISSUER = "https://accounts.google.com";
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const KV_KEY = "google-oidc-jwks";
const KV_TTL_SECONDS = 12 * 60 * 60;

interface CachedJwksRecord {
  fetchedAt: number;
  jwks: JSONWebKeySet;
}

/**
 * Returns a JWKS resolver suitable for verifying Pub/Sub OIDC tokens.
 *
 * When a KV namespace is supplied (production path) we serve from a cached
 * copy of Google's JWKS where available; on miss we fetch + store and serve
 * the fresh copy. Without a KV (simple tests / non-Workers contexts), falls
 * back to jose's built-in `createRemoteJWKSet`, which still keeps an in-
 * process cache.
 */
export async function getGoogleJwks(kv?: KVNamespace): Promise<JWTVerifyGetKey> {
  if (!kv) {
    return createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
  }

  const cached = (await kv.get(KV_KEY, "json")) as CachedJwksRecord | null;
  if (cached?.jwks) {
    return createLocalJWKSet(cached.jwks);
  }

  const res = await fetch(GOOGLE_JWKS_URL);
  if (!res.ok) {
    throw new PubSubVerificationError(`Failed to fetch Google JWKS (HTTP ${res.status})`);
  }
  const jwks = (await res.json()) as JSONWebKeySet;
  const record: CachedJwksRecord = { fetchedAt: Date.now(), jwks };
  await kv.put(KV_KEY, JSON.stringify(record), { expirationTtl: KV_TTL_SECONDS });
  return createLocalJWKSet(jwks);
}

export interface VerifyPubSubOpts {
  audience: string;
  serviceAccount: string;
  jwks: JWTVerifyGetKey;
}

export interface PubSubClaims extends JWTPayload {
  email: string;
  email_verified: boolean;
}

/**
 * Verify a Pub/Sub-issued OIDC token. Validates signature + standard claims
 * (iss / aud / exp) via jose, then asserts the `email` and `email_verified`
 * claims Google adds for service-account-impersonated tokens. Throws a
 * typed `PubSubVerificationError` on any failure — the webhook maps that
 * to 401.
 */
export async function verifyPubSubJwt(
  token: string,
  opts: VerifyPubSubOpts,
): Promise<PubSubClaims> {
  let payload: JWTPayload;
  try {
    const result = await jwtVerify(token, opts.jwks, {
      issuer: GOOGLE_ISSUER,
      audience: opts.audience,
    });
    payload = result.payload;
  } catch (cause) {
    const reason =
      cause instanceof Error ? cause.message : "signature or claim verification failed";
    throw new PubSubVerificationError(reason, { cause });
  }

  const email = payload.email;
  if (typeof email !== "string" || email !== opts.serviceAccount) {
    const got = typeof email === "string" ? email : "(missing)";
    throw new PubSubVerificationError(
      `email claim does not match expected service account (got ${got})`,
    );
  }

  if (payload.email_verified !== true) {
    throw new PubSubVerificationError("email_verified claim is not true");
  }

  return { ...payload, email, email_verified: true };
}
