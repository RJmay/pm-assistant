// ============================================================================
// Twilio inbound webhook signature verification (Phase 5)
// ============================================================================
// Twilio signs each webhook with X-Twilio-Signature = base64(HMAC-SHA1(
//   authToken, fullUrl + each POST param appended as key+value in key-sorted
//   order)). We recompute and compare in constant time. Never trust an inbound
// SMS payload without verifying it (same posture as the Pub/Sub webhook).
// ============================================================================

export class SmsVerificationError extends Error {
  override readonly name = "SmsVerificationError";
  readonly reason: string;
  constructor(reason: string) {
    super(`Twilio signature verification failed: ${reason}`);
    this.reason = reason;
  }
}

function toBase64(bytes: ArrayBuffer): string {
  let bin = "";
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i] as number);
  return btoa(bin);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export interface VerifyTwilioOpts {
  authToken: string;
  /** The exact URL Twilio POSTed to (scheme+host+path+query). */
  url: string;
  /** The form-encoded POST params. */
  params: Record<string, string>;
  /** The X-Twilio-Signature header value. */
  signature: string;
}

/** Returns true when the signature is valid. Throws `SmsVerificationError` on a missing signature. */
export async function verifyTwilioSignature(opts: VerifyTwilioOpts): Promise<boolean> {
  if (!opts.signature) throw new SmsVerificationError("missing X-Twilio-Signature");
  const sortedKeys = Object.keys(opts.params).sort();
  let data = opts.url;
  for (const k of sortedKeys) data += k + opts.params[k];

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(opts.authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return timingSafeEqual(toBase64(sig), opts.signature);
}
