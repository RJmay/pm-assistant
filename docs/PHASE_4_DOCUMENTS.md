# Phase 4 — Document + compliance engine

Master spec §10. Generate QLD statutory documents from data + the rules engine. **No statutory
field, date or notice period is ever LLM-generated** (spec §6/§10) — and we never invent a
regulatory fact (§0.3): a document whose statutory basis the rules engine can't confirm simply
isn't generated.

## Milestone 1 (done): the engine + two rules-backed document types

**`@pm/documents`** (new, stack-agnostic package) turns property/tenancy data + `@pm/rules` into a
structured `DocumentModel`, and renders it to a clean, print-ready document. Builders THROW
(`DocumentNotCompliantError`) rather than emit something non-compliant.

| Document | Form | Statutory basis (from `@pm/rules`) |
|---|---|---|
| **Entry Notice** (routine inspection) | RTA **Form 9** | `entryNoticeRequirements` (7-day notice) + `earliestRoutineInspectionDate` (3-month frequency cap) |
| **Notice of Rent Increase** | (no numbered RTA form) | `assessRentIncrease` (2-month notice, once-per-12-months, property basis since 6 Jun 2024) |

The new rent figure is a **commercial input the PM supplies** — never computed or invented. The
engine refuses a rent increase that's too soon, or an entry date inside the notice period.

## Flow

`POST /api/documents` (JWT-authed) → resolve the tenancy's data → build the model (deterministic,
rules-backed) → render → persist a `documents` row with the **rule versions used** → audit. The
dashboard's **/documents** page has a generate form (pick tenancy + type + params), a list, and a
viewer (`/documents/[id]`) that shows the rendered document in a sandboxed iframe with **Print /
Save as PDF**.

## Output format (v1)

Documents are rendered as **self-contained, print-ready HTML** stored inline on the `documents`
row (`content`), not a binary PDF in Storage. The compliance core — correct statutory fields,
computed dates, and the recorded `rule_versions` — is identical regardless of format; the PM
prints to PDF from the viewer. Binary-PDF + Supabase Storage upload is a surfaced follow-up that
swaps only the renderer.

## Forms 11 & 12 — ACTIVE (RTA-confirmed periods, June 2026)

Both generate. The statutory periods were researched from **rta.qld.gov.au** (general tenancies)
and set in `packages/rules/src/seed.ts` with their source URLs (each row's `needsHumanConfirmation`
is now `false`):

| Document | Period | Source |
|---|---|---|
| **Form 11** — Notice to Remedy Breach (rent arrears) | **7 days** to remedy | RTA non-payment-of-rent page |
| **Form 12** — Notice to Leave, unremedied **rent** breach | **7 days** | RTA notice-periods page |
| **Form 12** — Notice to Leave, end of fixed term | **2 MONTHS**; handover = the later of (notice + 2 months) and the lease end date | RTA notice-periods page |

The end-of-fixed-term period is **months** (not days), and the engine computes the handover as the
later of the notice-period end and the lease end date. Generated documents carry the standard "not
legal advice — check every detail" disclaimer; an agency should still verify before issuing.

**Not yet modelled (additive follow-ups, same pattern):** the **general (non-rent) unremedied
breach** Form 12 ground (**14 days** per the RTA — distinct from the 7-day rent ground);
**Form 13** (tenant's notice of intention to leave); **R12** (disputed bond); the 5-day
moveable-dwelling Form 11 remedy variant.

## Deferred

- **Binary PDF + Storage** — render HTML→PDF (e.g. pdf-lib) and upload to a `documents` bucket.
- **Condition reports** — larger structured form; later.

## Runtime DoD (pending live data — same bring-up as Phases 1–3)

- A PM generates a Form 9 entry notice / rent-increase notice for a real tenancy with correct
  computed dates and the rule versions recorded, and prints it.

## Migration added

`0017_documents.sql` — the `documents` table (type, form_id, fields jsonb, content, rule_versions,
status). After applying, run `pnpm db:types` to regenerate `packages/db/src/types.ts` (hand-edited
to match for now).
