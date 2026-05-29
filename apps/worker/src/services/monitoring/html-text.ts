// ============================================================================
// Minimal HTML → text extraction for source diffing (spec §12)
// ============================================================================
// Not a full parser — just enough to turn a fetched page into stable, diffable
// text: drop scripts/styles, strip tags, decode the common entities, collapse
// whitespace. Pure + deterministic.
// ============================================================================

const BLOCK_ELEMENTS = /<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1>/gi;
const TAGS = /<[^>]+>/g;
const ENTITY = /&(?:[a-zA-Z]+|#\d+);/g;

const NAMED_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
  "&mdash;": "—",
  "&ndash;": "–",
};

export function extractText(html: string): string {
  const withoutBlocks = html.replace(BLOCK_ELEMENTS, " ");
  const withoutTags = withoutBlocks.replace(TAGS, " ");
  const decoded = withoutTags.replace(ENTITY, (m) => NAMED_ENTITIES[m] ?? " ");
  return decoded.replace(/\s+/g, " ").trim();
}
