import type { Client } from "@pm/db";

/**
 * Cascade of strategies the matcher tries, in order, to resolve an inbound
 * email to a property / tenant / owner. The first step that produces a
 * confident result wins.
 *
 * Mirrors ARCHITECTURE.md §"Property/tenant matcher". The schema enum of the
 * same shape (`match_source`) is what gets persisted on `ai_drafts.matched_via`.
 */
export type MatchSource =
  | "exact_email"
  | "thread_continuity"
  | "subject_fuzzy"
  | "body_scan"
  | "fallback";

/** Confidence the matcher carries forward to the draft row + dashboard. */
export type MatchConfidence = "high" | "medium" | "low" | "none";

export interface MatchResult {
  propertyId: string | null;
  tenantId: string | null;
  ownerId: string | null;
  confidence: MatchConfidence;
  source: MatchSource;
}

export interface MatcherInput {
  agencyId: string;
  /** Plain email address (no "Name <addr>" wrapping). The parser strips that. */
  fromAddress: string;
  subject: string | null;
  /** First ~500 chars of the plain body; the matcher caps this internally. */
  bodyPreview: string | null;
  gmailThreadId: string;
}

const BODY_SCAN_LIMIT = 500;

// Fuzzy-match thresholds. Values come from a "make the test fixtures land
// where they should" calibration — keep them tight rather than aspirational.
// (Address tokenisation drops short words + stopwords, so the denominator is
// usually 2–4 distinctive tokens.)
const SUBJECT_MEDIUM_THRESHOLD = 0.6; // need ≥60% of address tokens present
const SUBJECT_LOW_THRESHOLD = 0.4; // ≥40% but ambiguous → low confidence
const BODY_LOW_THRESHOLD = 0.5; // body matches are inherently noisier
const AMBIGUITY_MARGIN = 0.9; // if 2nd best ≥ 90% of best → ambiguous

const FALLBACK: MatchResult = {
  propertyId: null,
  tenantId: null,
  ownerId: null,
  confidence: "none",
  source: "fallback",
};

// Common English stopwords + email subject noise ("re:", "fwd:"). Kept small;
// real-world subjects are short and signal-rich.
const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "by",
  "for",
  "fw",
  "fwd",
  "from",
  "in",
  "is",
  "it",
  "no",
  "of",
  "on",
  "or",
  "re",
  "the",
  "to",
  "with",
  "yes",
  "your",
  // Address-document noise
  "st",
  "rd",
  "ave",
  "dr",
  "ln",
  "ct",
  "pl",
  "tce",
  "qld",
  "queensland",
  "australia",
]);

export async function matchEmail(client: Client, input: MatcherInput): Promise<MatchResult> {
  // ---- Step 1: exact email match (tenants, then owners) ------------------
  const byEmail = await tryExactEmailMatch(client, input);
  if (byEmail) return byEmail;

  // ---- Step 2: thread continuity -----------------------------------------
  const byThread = await tryThreadContinuity(client, input);
  if (byThread) return byThread;

  // Steps 3 & 4 share the property list; fetch once.
  const { data: properties, error } = await client
    .from("properties")
    .select("id, address_line1, suburb")
    .eq("agency_id", input.agencyId)
    .is("archived_at", null);
  if (error) {
    throw new Error(`matcher: properties scan failed: ${error.message}`);
  }
  const candidates = properties ?? [];

  // ---- Step 3: subject fuzzy match ---------------------------------------
  const bySubject = tryFuzzyMatch(
    input.subject ?? "",
    candidates,
    "subject_fuzzy",
    SUBJECT_MEDIUM_THRESHOLD,
    SUBJECT_LOW_THRESHOLD,
  );
  if (bySubject) return bySubject;

  // ---- Step 4: body scan (capped to first 500 chars) ---------------------
  const bodyText = (input.bodyPreview ?? "").slice(0, BODY_SCAN_LIMIT);
  const byBody = tryFuzzyMatch(
    bodyText,
    candidates,
    "body_scan",
    // Body matches always cap at low — they're noisier than subject lines.
    BODY_LOW_THRESHOLD + 1, // medium threshold deliberately unreachable
    BODY_LOW_THRESHOLD,
  );
  if (byBody) return byBody;

  // ---- Step 5: fallback ---------------------------------------------------
  return FALLBACK;
}

// ----------------------------------------------------------------------------
// Step 1
// ----------------------------------------------------------------------------

async function tryExactEmailMatch(
  client: Client,
  input: MatcherInput,
): Promise<MatchResult | null> {
  const email = input.fromAddress.trim();
  if (!email) return null;

  // 1a. tenants — case-insensitive (the schema has a lower(email) index)
  const { data: tenants, error: tenantsErr } = await client
    .from("tenants")
    .select("id, tenancy_id")
    .eq("agency_id", input.agencyId)
    .ilike("email", email);
  if (tenantsErr) {
    throw new Error(`matcher: tenants scan failed: ${tenantsErr.message}`);
  }
  if (tenants && tenants.length === 1) {
    const t = tenants[0];
    // Chain to tenancy → property (if any). Tenant identity alone isn't
    // enough — we want a property_id to attach the draft to.
    let propertyId: string | null = null;
    if (t?.tenancy_id) {
      const { data: tenancy, error: tenancyErr } = await client
        .from("tenancies")
        .select("property_id")
        .eq("agency_id", input.agencyId)
        .eq("id", t.tenancy_id)
        .maybeSingle();
      if (tenancyErr) {
        throw new Error(`matcher: tenancies lookup failed: ${tenancyErr.message}`);
      }
      propertyId = tenancy?.property_id ?? null;
    }
    return {
      propertyId,
      tenantId: t?.id ?? null,
      ownerId: null,
      // Tenant identity is high-confidence even if the tenancy has no property
      // attached yet — the PM dashboard surfaces it for triage.
      confidence: propertyId ? "high" : "medium",
      source: "exact_email",
    };
  }

  // 1b. owners — one owner may have many properties, so we set ownerId but
  // only set propertyId when the owner unambiguously has exactly one.
  const { data: owners, error: ownersErr } = await client
    .from("owners")
    .select("id")
    .eq("agency_id", input.agencyId)
    .is("archived_at", null)
    .ilike("email", email);
  if (ownersErr) {
    throw new Error(`matcher: owners scan failed: ${ownersErr.message}`);
  }
  if (owners && owners.length === 1) {
    const o = owners[0];
    if (!o) return null;
    const { data: theirProperties, error: propsErr } = await client
      .from("properties")
      .select("id")
      .eq("agency_id", input.agencyId)
      .eq("owner_id", o.id)
      .is("archived_at", null);
    if (propsErr) {
      throw new Error(`matcher: owner properties scan failed: ${propsErr.message}`);
    }
    const onlyProperty = theirProperties?.length === 1 ? theirProperties[0]?.id : null;
    return {
      propertyId: onlyProperty ?? null,
      tenantId: null,
      ownerId: o.id,
      confidence: onlyProperty ? "high" : "medium",
      source: "exact_email",
    };
  }

  return null;
}

// ----------------------------------------------------------------------------
// Step 2
// ----------------------------------------------------------------------------

async function tryThreadContinuity(
  client: Client,
  input: MatcherInput,
): Promise<MatchResult | null> {
  const { data: thread, error } = await client
    .from("email_threads")
    .select("property_id, property_match_confidence")
    .eq("agency_id", input.agencyId)
    .eq("gmail_thread_id", input.gmailThreadId)
    .maybeSingle();
  if (error) {
    throw new Error(`matcher: email_threads lookup failed: ${error.message}`);
  }
  if (!thread?.property_id) return null;
  // Inherit the thread's confidence — if a previous match was low, we don't
  // launder it back up to high just by virtue of continuity.
  const inherited = thread.property_match_confidence ?? "none";
  return {
    propertyId: thread.property_id,
    tenantId: null,
    ownerId: null,
    confidence: inherited === "none" ? "medium" : inherited,
    source: "thread_continuity",
  };
}

// ----------------------------------------------------------------------------
// Steps 3 & 4 — fuzzy match against properties.address_line1 + suburb
// ----------------------------------------------------------------------------

interface PropertyCandidate {
  id: string;
  address_line1: string;
  suburb: string | null;
}

function tryFuzzyMatch(
  text: string,
  candidates: PropertyCandidate[],
  source: "subject_fuzzy" | "body_scan",
  mediumThreshold: number,
  lowThreshold: number,
): MatchResult | null {
  if (!text || candidates.length === 0) return null;
  const haystack = tokenise(text);
  if (haystack.size === 0) return null;

  const scored = candidates
    .map((p) => {
      const needle = tokenise(`${p.address_line1} ${p.suburb ?? ""}`);
      return { id: p.id, score: overlapScore(needle, haystack) };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return null;

  const top = scored[0];
  if (!top) return null;
  // Ambiguity check: if the runner-up is close to the leader, we can't pick
  // confidently. Drop a confidence tier rather than guess.
  const ambiguous = scored.length > 1 && (scored[1]?.score ?? 0) >= top.score * AMBIGUITY_MARGIN;

  if (top.score >= mediumThreshold && !ambiguous) {
    return {
      propertyId: top.id,
      tenantId: null,
      ownerId: null,
      confidence: "medium",
      source,
    };
  }
  if (top.score >= lowThreshold) {
    return {
      propertyId: ambiguous ? null : top.id,
      tenantId: null,
      ownerId: null,
      confidence: "low",
      source,
    };
  }
  return null;
}

function tokenise(text: string): Set<string> {
  const cleaned = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
  return new Set(cleaned);
}

function overlapScore(needle: Set<string>, haystack: Set<string>): number {
  if (needle.size === 0) return 0;
  let hits = 0;
  for (const t of needle) {
    if (haystack.has(t)) hits += 1;
  }
  return hits / needle.size;
}
