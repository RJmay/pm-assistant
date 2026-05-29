import type { Client } from "@pm/db";
import type { WorkerEnv } from "../lib/env";
import { refreshAccessToken } from "./gmail";
import { getGmailRefreshToken } from "./vault";

// ============================================================================
// Send identity (M9) — the single seam for "which mailbox sends the reply"
// ============================================================================
// v1 DECISION (recorded in HANDOFF.md / memory): send from the shared AGENCY
// mailbox using the agency-level Gmail refresh token M5 already stores in
// Vault. The From display name carries the PM's name + agency so the reply
// still reads as personal. When per-PM Gmail is wanted later (agency_users
// .gmail_oauth_vault_key gets populated during onboarding), this is the ONE
// function to change — resolve the PM's token here instead. Everything
// downstream (route, mime builder) is identity-agnostic.
// ============================================================================

export class SendIdentityError extends Error {
  override readonly name = "SendIdentityError";
  constructor(message: string, opts?: { cause?: unknown }) {
    super(message, { cause: opts?.cause });
  }
}

export interface SendIdentity {
  accessToken: string;
  /** the address the reply is sent from (agency mailbox in v1) */
  fromAddress: string;
  /** "PM Name — Agency Name" */
  fromDisplayName: string;
}

export interface ResolveSendIdentityInput {
  agencyId: string;
  pmFullName: string;
  agencyName: string;
  mailboxAddress: string;
}

export async function resolveSendIdentity(
  client: Client,
  env: WorkerEnv,
  input: ResolveSendIdentityInput,
): Promise<SendIdentity> {
  const refreshToken = await getGmailRefreshToken(client, input.agencyId);
  if (!refreshToken) {
    throw new SendIdentityError(`no agency Gmail refresh token for agency ${input.agencyId}`);
  }

  let accessToken: string;
  try {
    const tokens = await refreshAccessToken({
      refreshToken,
      clientId: env.GMAIL_OAUTH_CLIENT_ID,
      clientSecret: env.GMAIL_OAUTH_CLIENT_SECRET,
    });
    accessToken = tokens.access_token;
  } catch (cause) {
    throw new SendIdentityError("failed to refresh agency Gmail access token", { cause });
  }

  const displayName = input.agencyName
    ? `${input.pmFullName} — ${input.agencyName}`
    : input.pmFullName;

  return { accessToken, fromAddress: input.mailboxAddress, fromDisplayName: displayName };
}
