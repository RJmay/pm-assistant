import type { Client } from "@pm/db";
import type { MaintenanceQuote } from "@pm/shared";

// Server queries for the maintenance-jobs views. Agency-scoped via RLS (the
// dashboard uses the authed anon client).

export interface MaintenanceJobListItem {
  id: string;
  issue: string;
  classification: string;
  state: string;
  trade: string | null;
  owner_approval_state: string;
  scheduled_for: string | null;
  created_at: string;
  property_address: string | null;
  quote_count: number;
}

interface JobRow {
  id: string;
  issue: string;
  classification: string;
  state: string;
  trade: string | null;
  owner_approval_state: string;
  scheduled_for: string | null;
  created_at: string;
  property_id: string | null;
  quotes: unknown;
}

async function propertyAddresses(
  client: Client,
  agencyId: string,
  propertyIds: string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(propertyIds)];
  if (ids.length === 0) return new Map();
  const { data } = await client
    .from("properties")
    .select("id, address_line1, suburb")
    .eq("agency_id", agencyId)
    .in("id", ids);
  return new Map(
    (data ?? []).map((p) => [
      p.id,
      [p.address_line1, p.suburb].filter((x) => x && x.trim() !== "").join(", "),
    ]),
  );
}

function quoteCount(quotes: unknown): number {
  return Array.isArray(quotes) ? quotes.length : 0;
}

/** All maintenance jobs for the agency, newest first. */
export async function fetchMaintenanceJobs(
  client: Client,
  agencyId: string,
): Promise<MaintenanceJobListItem[]> {
  const { data, error } = await client
    .from("maintenance_jobs")
    .select(
      "id, issue, classification, state, trade, owner_approval_state, scheduled_for, created_at, property_id, quotes",
    )
    .eq("agency_id", agencyId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`maintenance_jobs fetch failed: ${error.message}`);
  const rows = (data ?? []) as JobRow[];
  const addrs = await propertyAddresses(
    client,
    agencyId,
    rows.map((r) => r.property_id).filter((id): id is string => id !== null),
  );
  return rows.map((r) => ({
    id: r.id,
    issue: r.issue,
    classification: r.classification,
    state: r.state,
    trade: r.trade,
    owner_approval_state: r.owner_approval_state,
    scheduled_for: r.scheduled_for,
    created_at: r.created_at,
    property_address: r.property_id ? (addrs.get(r.property_id) ?? null) : null,
    quote_count: quoteCount(r.quotes),
  }));
}

export interface MaintenanceJobDetail extends MaintenanceJobListItem {
  source_draft_id: string | null;
  quotes: MaintenanceQuote[];
  drafts: Array<{
    id: string;
    recipient_name: string | null;
    status: string;
    draft_subject: string | null;
  }>;
}

/** One job with its quotes + the outbound quote-request drafts it produced. */
export async function fetchMaintenanceJob(
  client: Client,
  agencyId: string,
  jobId: string,
): Promise<MaintenanceJobDetail | null> {
  const { data: job, error } = await client
    .from("maintenance_jobs")
    .select(
      "id, issue, classification, state, trade, owner_approval_state, scheduled_for, created_at, property_id, quotes, source_draft_id",
    )
    .eq("agency_id", agencyId)
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw new Error(`maintenance_jobs fetch failed: ${error.message}`);
  if (!job) return null;

  const addrs = await propertyAddresses(client, agencyId, job.property_id ? [job.property_id] : []);
  const { data: drafts } = await client
    .from("ai_drafts")
    .select("id, recipient_name, status, draft_subject")
    .eq("agency_id", agencyId)
    .eq("maintenance_job_id", jobId)
    .order("created_at", { ascending: true });

  return {
    id: job.id,
    issue: job.issue,
    classification: job.classification,
    state: job.state,
    trade: job.trade,
    owner_approval_state: job.owner_approval_state,
    scheduled_for: job.scheduled_for,
    created_at: job.created_at,
    property_address: job.property_id ? (addrs.get(job.property_id) ?? null) : null,
    quote_count: quoteCount(job.quotes),
    source_draft_id: job.source_draft_id,
    quotes: (Array.isArray(job.quotes) ? job.quotes : []) as unknown as MaintenanceQuote[],
    drafts: (drafts ?? []).map((d) => ({
      id: d.id,
      recipient_name: d.recipient_name,
      status: d.status,
      draft_subject: d.draft_subject,
    })),
  };
}
