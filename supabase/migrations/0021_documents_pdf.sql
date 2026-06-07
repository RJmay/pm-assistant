-- ============================================================================
-- 0021 — store a rendered PDF alongside the HTML (Phase 4 follow-up, spec §10)
-- ============================================================================
-- The document engine still stores print-ready HTML in `content`; this adds an
-- optional base64-encoded PDF (rendered via @pm/documents renderDocumentPdf).
-- base64 text (not bytea) keeps it trivial to read over PostgREST. Nullable +
-- additive: existing rows and the HTML path are unaffected.
-- ============================================================================

alter table documents add column if not exists pdf_base64 text;
