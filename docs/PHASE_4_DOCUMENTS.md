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

## Deliberate non-goals (v1) / deferred

- **Forms 11 (notice to remedy breach), 12 (notice to leave), 13 (notice of intention to leave),
  R12 (disputed bond)** — their notice/remedy periods are **not yet in the `@pm/rules` seed**.
  Per the anti-invention rule we won't hardcode them; seed + confirm those periods (with sources)
  and the engine can add each form the same way Form 9 was added.
- **Binary PDF + Storage** — render HTML→PDF (e.g. pdf-lib) and upload to a `documents` bucket.
- **Condition reports** — larger structured form; later.

## Runtime DoD (pending live data — same bring-up as Phases 1–3)

- A PM generates a Form 9 entry notice / rent-increase notice for a real tenancy with correct
  computed dates and the rule versions recorded, and prints it.

## Migration added

`0017_documents.sql` — the `documents` table (type, form_id, fields jsonb, content, rule_versions,
status). After applying, run `pnpm db:types` to regenerate `packages/db/src/types.ts` (hand-edited
to match for now).
