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

## Forms 11 & 12 — built, but DORMANT until the periods are confirmed

The full machinery for **Form 11 (Notice to Remedy Breach — rent arrears)** and **Form 12 (Notice
to Leave — end of fixed term / unremedied breach)** is built: rule keys, `@pm/rules` accessors,
`@pm/documents` builders, the worker service/route, and the dashboard generate form. They're wired
through migration `0018` (the `document_type` enum) and selectable in `/documents`.

But their **statutory notice/remedy periods are seeded UNCONFIRMED** in `@pm/rules`
(`value: null, needsHumanConfirmation: true`), so the builders **throw `RuleNotConfiguredError`** →
the route returns **409 "the statutory rule needed for this document isn't confirmed yet."** They
won't generate a document until a human confirms the values — anti-invention (§0.3).

**To activate (confirm from rta.qld.gov.au, then edit `packages/rules/src/seed.ts`):**
- `notice_remedy_breach_rent_arrears` → `{ days: N }` (Form 11 rent-arrears remedy period)
- `notice_to_leave_unremedied_breach` → `{ days: N }` (Form 12 notice after an unremedied breach)
- `notice_to_leave_end_of_fixed_term` → `{ days: N }` (Form 12 end-of-fixed-term notice)

For each: set `value`, flip `needsHumanConfirmation: false`, add any new hard date to
`SPEC_ASSERTED_DATES`, and add positive-path tests. **Form 13 (tenant's notice) and R12 (disputed
bond)** follow the same pattern; not yet built (less PM-initiated).

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
