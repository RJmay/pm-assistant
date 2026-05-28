import { PubSubVerificationError } from "@pm/shared";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWK,
  type JWTVerifyGetKey,
  SignJWT,
} from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { verifyPubSubJwt } from "../src/services/pubsub";

const AUDIENCE = "https://worker.example/webhook/gmail/";
const SERVICE_ACCOUNT = "pubsub-worker-pusher@example-project.iam.gserviceaccount.com";
const ISSUER = "https://accounts.google.com";

let privateKey: CryptoKey;
let jwks: JWTVerifyGetKey;

beforeAll(async () => {
  const { privateKey: priv, publicKey } = await generateKeyPair("ES256", { extractable: true });
  privateKey = priv as CryptoKey;
  const publicJwk = (await exportJWK(publicKey)) as JWK;
  publicJwk.kid = "test-key";
  publicJwk.alg = "ES256";
  publicJwk.use = "sig";
  jwks = createLocalJWKSet({ keys: [publicJwk] });
});

interface TokenOverrides {
  audience?: string;
  email?: string;
  email_verified?: boolean;
  issuer?: string;
  iat?: number;
  exp?: number;
}

async function signToken(overrides: TokenOverrides = {}): Promise<string> {
  const builder = new SignJWT({
    email: overrides.email ?? SERVICE_ACCOUNT,
    email_verified: overrides.email_verified ?? true,
  })
    .setProtectedHeader({ alg: "ES256", kid: "test-key" })
    .setIssuer(overrides.issuer ?? ISSUER)
    .setAudience(overrides.audience ?? AUDIENCE);

  if (overrides.iat !== undefined) {
    builder.setIssuedAt(overrides.iat);
  } else {
    builder.setIssuedAt();
  }
  if (overrides.exp !== undefined) {
    builder.setExpirationTime(overrides.exp);
  } else {
    builder.setExpirationTime("1h");
  }
  return builder.sign(privateKey);
}

const opts = () => ({ audience: AUDIENCE, serviceAccount: SERVICE_ACCOUNT, jwks });

describe("verifyPubSubJwt", () => {
  it("accepts a properly-signed token with correct claims", async () => {
    const token = await signToken();
    const claims = await verifyPubSubJwt(token, opts());
    expect(claims.email).toBe(SERVICE_ACCOUNT);
    expect(claims.email_verified).toBe(true);
    expect(claims.iss).toBe(ISSUER);
  });

  it("rejects a token with the wrong issuer", async () => {
    const token = await signToken({ issuer: "https://impersonator.example" });
    await expect(verifyPubSubJwt(token, opts())).rejects.toBeInstanceOf(PubSubVerificationError);
  });

  it("rejects a token with the wrong audience", async () => {
    const token = await signToken({ audience: "https://wrong.example/" });
    await expect(verifyPubSubJwt(token, opts())).rejects.toBeInstanceOf(PubSubVerificationError);
  });

  it("rejects a token whose email claim != configured service account", async () => {
    const token = await signToken({ email: "intruder@elsewhere.iam.gserviceaccount.com" });
    await expect(verifyPubSubJwt(token, opts())).rejects.toBeInstanceOf(PubSubVerificationError);
  });

  it("rejects a token where email_verified is not true", async () => {
    const token = await signToken({ email_verified: false });
    await expect(verifyPubSubJwt(token, opts())).rejects.toBeInstanceOf(PubSubVerificationError);
  });

  it("rejects an expired token", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signToken({ iat: now - 36000, exp: now - 32400 });
    await expect(verifyPubSubJwt(token, opts())).rejects.toBeInstanceOf(PubSubVerificationError);
  });

  it("rejects a tampered signature", async () => {
    const token = await signToken();
    const parts = token.split(".");
    const sig = parts[2] ?? "";
    // Replace the signature entirely with all-zeros (still a valid base64url
    // string of the right length, but won't match any real ES256 signature).
    // Flipping a single trailing character is flaky because base64url's last
    // char encodes only a few significant bits.
    const tampered = `${parts[0]}.${parts[1]}.${"A".repeat(sig.length)}`;
    await expect(verifyPubSubJwt(tampered, opts())).rejects.toBeInstanceOf(PubSubVerificationError);
  });
});
