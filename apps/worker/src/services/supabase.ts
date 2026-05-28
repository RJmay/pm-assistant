import { type Client, createServiceClient as createDbServiceClient, type Json } from "@pm/db";
import type { WorkerEnv } from "../lib/env";

/**
 * Build a service-role Supabase client from Worker env. Bypasses RLS, so
 * every caller MUST scope queries with an explicit `agency_id` filter.
 */
export function createServiceClient(env: WorkerEnv): Client {
  return createDbServiceClient({
    SUPABASE_URL: env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
  });
}

export interface AuditLogEntry {
  agency_id: string;
  actor_type: "user" | "system" | "ai";
  actor_id?: string;
  action: string;
  entity_type?: string;
  entity_id?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Insert an `audit_log` row. Throws on insert failure so callers can surface
 * a 500 — better to be loud than to silently miss audit events.
 *
 * `metadata` is cast to `Json` at the boundary: Supabase's generated types
 * use a strict recursive `Json` shape, but callers pass plain object literals
 * we know are JSON-serialisable. Caller's responsibility.
 */
export async function writeAuditLog(client: Client, entry: AuditLogEntry): Promise<void> {
  const { error } = await client.from("audit_log").insert({
    agency_id: entry.agency_id,
    actor_type: entry.actor_type,
    actor_id: entry.actor_id ?? null,
    action: entry.action,
    entity_type: entry.entity_type ?? null,
    entity_id: entry.entity_id ?? null,
    metadata: (entry.metadata ?? {}) as Json,
  });
  if (error) {
    throw new Error(`Failed to write audit_log: ${error.message}`);
  }
}
