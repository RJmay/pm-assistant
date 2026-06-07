import type { Client, Json } from "@pm/db";
import {
  buildEntryNoticeDocument,
  buildGeneralBreachNotice,
  buildNoticeOfIntentionToLeave,
  buildNoticeToLeave,
  buildRemedyBreachNotice,
  buildRentIncreaseNoticeDocument,
  type DocumentModel,
  DocumentNotCompliantError,
  renderDocumentHtml,
  renderDocumentPdf,
} from "@pm/documents";
import { RuleNotConfiguredError, RuleNotFoundError } from "@pm/rules";
import type { DocumentType } from "@pm/shared";
import type { Logger } from "../lib/log";
import { writeAuditLog } from "./supabase";

// ============================================================================
// Document generation service (Phase 4, spec §10)
// ============================================================================
// Resolves a tenancy's data, builds a statutory document deterministically via
// @pm/documents (all dates/periods from @pm/rules), renders it, and persists a
// `documents` row with the rule versions used. Refuses (typed error) rather
// than emit a non-compliant document or one whose statutory basis the rules
// engine can't confirm. Agency-scoped (service-role bypasses RLS).
// ============================================================================

const AEST_OFFSET_MS = 10 * 60 * 60 * 1000;

function aestToday(now: Date): string {
  return new Date(now.getTime() + AEST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Base64-encode bytes using Web APIs only (works on Workers + Node, no Buffer). */
function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export type GenerateDocumentInput =
  | {
      agencyId: string;
      type: "entry_notice";
      tenancyId: string;
      createdByPmId: string;
      entryDate?: string;
      entryWindow?: string;
    }
  | {
      agencyId: string;
      type: "rent_increase_notice";
      tenancyId: string;
      createdByPmId: string;
      newRentCents: number;
      effectiveDate?: string;
    }
  | {
      agencyId: string;
      type: "notice_to_remedy_breach";
      tenancyId: string;
      createdByPmId: string;
      breach?: "rent" | "general";
      dwelling?: "general" | "moveable";
      amountOwedCents?: number;
      breachDescription?: string;
    }
  | {
      agencyId: string;
      type: "notice_to_leave";
      tenancyId: string;
      createdByPmId: string;
      ground: "unremedied_breach" | "unremedied_general_breach" | "end_of_fixed_term";
    }
  | {
      agencyId: string;
      type: "notice_of_intention_to_leave";
      tenancyId: string;
      createdByPmId: string;
      ground: "periodic" | "end_of_fixed_term" | "unremedied_breach";
    };

export interface GenerateDocumentResult {
  documentId: string;
  type: DocumentType;
  formId: string | null;
  title: string;
}

export async function generateDocument(
  client: Client,
  input: GenerateDocumentInput,
  deps: { logger: Logger; now?: () => Date },
): Promise<GenerateDocumentResult> {
  const now = deps.now ?? (() => new Date());
  const noticeDate = aestToday(now());

  // ---- Resolve tenancy + property + tenants + agency ----
  const { data: tenancy, error: tErr } = await client
    .from("tenancies")
    .select(
      "id, property_id, end_date, rent_amount_cents, rent_frequency, last_rent_increase_date, last_routine_inspection_date",
    )
    .eq("agency_id", input.agencyId)
    .eq("id", input.tenancyId)
    .maybeSingle();
  if (tErr) throw new Error(`tenancies lookup failed: ${tErr.message}`);
  if (!tenancy) throw new DocumentError("tenancy_not_found", "tenancy not found");

  const [{ data: property }, tenantsRes, { data: agency }] = await Promise.all([
    tenancy.property_id
      ? client
          .from("properties")
          .select("address_line1, suburb")
          .eq("agency_id", input.agencyId)
          .eq("id", tenancy.property_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    client
      .from("tenants")
      .select("full_name, is_primary")
      .eq("agency_id", input.agencyId)
      .eq("tenancy_id", input.tenancyId),
    client.from("agencies").select("name").eq("id", input.agencyId).maybeSingle(),
  ]);
  if (tenantsRes.error) throw new Error(`tenants lookup failed: ${tenantsRes.error.message}`);

  const propertyAddress = property
    ? [property.address_line1, property.suburb].filter((p) => p && p.trim() !== "").join(", ")
    : "the premises";
  const tenantNames = (tenantsRes.data ?? [])
    .slice()
    .sort((a, b) => (a.is_primary === b.is_primary ? 0 : a.is_primary ? -1 : 1))
    .map((t) => t.full_name);
  const agencyName = agency?.name ?? "";

  // ---- Build the document model (deterministic, rules-backed) ----
  const common = { agencyName, tenantNames, propertyAddress, noticeDate };
  let model: DocumentModel;
  try {
    if (input.type === "entry_notice") {
      model = buildEntryNoticeDocument({
        ...common,
        entryDate: input.entryDate,
        entryWindow: input.entryWindow,
        lastInspectionDate: tenancy.last_routine_inspection_date,
      });
    } else if (input.type === "rent_increase_notice") {
      if (tenancy.rent_amount_cents == null || tenancy.rent_frequency == null) {
        throw new DocumentError(
          "missing_data",
          "the tenancy has no current rent or rent frequency on file",
        );
      }
      model = buildRentIncreaseNoticeDocument({
        ...common,
        currentRentCents: tenancy.rent_amount_cents,
        newRentCents: input.newRentCents,
        rentFrequency: tenancy.rent_frequency,
        effectiveDate: input.effectiveDate,
        lastIncreaseDate: tenancy.last_rent_increase_date,
      });
    } else if (input.type === "notice_to_remedy_breach") {
      const breach = input.breach ?? "rent";
      if (breach === "general") {
        if (!input.breachDescription) {
          throw new DocumentError("missing_data", "describe the breach to be remedied");
        }
        model = buildGeneralBreachNotice({
          ...common,
          breachDescription: input.breachDescription,
          dwelling: input.dwelling,
        });
      } else {
        if (input.amountOwedCents == null) {
          throw new DocumentError("missing_data", "enter the rent amount owing");
        }
        model = buildRemedyBreachNotice({
          ...common,
          amountOwedCents: input.amountOwedCents,
          dwelling: input.dwelling,
        });
      }
    } else if (input.type === "notice_to_leave") {
      model = buildNoticeToLeave({
        ...common,
        ground: input.ground,
        leaseEndDate: tenancy.end_date,
      });
    } else {
      model = buildNoticeOfIntentionToLeave({
        ...common,
        ground: input.ground,
        leaseEndDate: tenancy.end_date,
      });
    }
  } catch (err) {
    if (err instanceof DocumentNotCompliantError) {
      throw new DocumentError("not_compliant", err.message);
    }
    if (err instanceof RuleNotConfiguredError || err instanceof RuleNotFoundError) {
      throw new DocumentError(
        "rule_not_configured",
        "the statutory rule needed for this document isn't confirmed yet",
      );
    }
    throw err;
  }

  const content = renderDocumentHtml(model);

  // Render a PDF too (additive). A PDF failure must NEVER block document
  // creation — log and fall back to HTML-only.
  let pdfBase64: string | null = null;
  try {
    pdfBase64 = bytesToBase64(await renderDocumentPdf(model));
  } catch (err) {
    deps.logger.warn("pdf render failed; storing HTML only", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // ---- Persist ----
  const { data: doc, error: insErr } = await client
    .from("documents")
    .insert({
      agency_id: input.agencyId,
      type: model.type,
      form_id: model.formId,
      property_id: tenancy.property_id,
      tenancy_id: input.tenancyId,
      title: model.title,
      fields: model.fields as unknown as Json,
      content,
      content_type: "text/html",
      pdf_base64: pdfBase64,
      rule_versions: model.ruleVersions,
      created_by: input.createdByPmId,
    })
    .select("id")
    .single();
  if (insErr || !doc) {
    throw new Error(`documents insert failed: ${insErr?.message ?? "no row"}`);
  }

  await writeAuditLog(client, {
    agency_id: input.agencyId,
    actor_type: "user",
    actor_id: input.createdByPmId,
    action: "document.generated",
    entity_type: "documents",
    entity_id: doc.id,
    metadata: {
      type: model.type,
      form_id: model.formId,
      tenancy_id: input.tenancyId,
      rule_versions: model.ruleVersions,
    },
  });

  deps.logger.info("document generated", {
    document_id: doc.id,
    type: model.type,
    form_id: model.formId,
  });
  return { documentId: doc.id, type: model.type, formId: model.formId, title: model.title };
}

/** Typed error so the route can map a known cause to the right HTTP status. */
export class DocumentError extends Error {
  override readonly name = "DocumentError";
  readonly code: "tenancy_not_found" | "missing_data" | "not_compliant" | "rule_not_configured";
  constructor(code: DocumentError["code"], message: string) {
    super(message);
    this.code = code;
  }
}
