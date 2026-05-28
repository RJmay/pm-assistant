import type { Client } from "@pm/db";

/**
 * Store a per-agency Gmail refresh token in Supabase Vault. Idempotent —
 * if a token already exists for this agency the underlying vault secret is
 * updated in place, otherwise a new secret + mapping row are created.
 *
 * Calls the SECURITY DEFINER wrapper added in migration 0003; service_role
 * is the only role with execute permission.
 */
export async function storeGmailRefreshToken(
  client: Client,
  agencyId: string,
  refreshToken: string,
): Promise<void> {
  const { error } = await client.rpc("store_gmail_refresh_token", {
    p_agency_id: agencyId,
    p_token: refreshToken,
  });
  if (error) {
    throw new Error(`Failed to store Gmail refresh token: ${error.message}`);
  }
}

/**
 * Fetch the decrypted Gmail refresh token for an agency. Returns null when
 * the agency has never connected a mailbox.
 */
export async function getGmailRefreshToken(
  client: Client,
  agencyId: string,
): Promise<string | null> {
  const { data, error } = await client.rpc("get_gmail_refresh_token", {
    p_agency_id: agencyId,
  });
  if (error) {
    throw new Error(`Failed to read Gmail refresh token: ${error.message}`);
  }
  return (data as string | null) ?? null;
}

/**
 * Remove the mapping row + the underlying vault secret. Called when an
 * agency disconnects its mailbox (M10 onboarding flow).
 */
export async function deleteGmailRefreshToken(client: Client, agencyId: string): Promise<void> {
  const { error } = await client.rpc("delete_gmail_refresh_token", {
    p_agency_id: agencyId,
  });
  if (error) {
    throw new Error(`Failed to delete Gmail refresh token: ${error.message}`);
  }
}
