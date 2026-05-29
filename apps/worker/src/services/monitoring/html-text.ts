// ============================================================================
// Minimal HTML → text extraction for source diffing (spec §12)
// ============================================================================
// Not a full parser — just enough to turn a fetched page into stable, diffable
// text: drop scripts/styles, strip tags, decode the common entities, collapse
// whitespace. Pure + deterministic.
// ============================================================================

const BLOCK_ELEMENTS = /<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1>/gi;
const TAGS = /<[^>]+>/g;
// Named OR numeric (decimal `&#8217;` / hex `&#x2019;`) entities.
const ENTITY = /&(?:#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g;

const NAMED_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&nbsp;": " ",
  "&mdash;": "—",
  "&ndash;": "–",
};

function fromCodePoint(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return " "; // out-of-range code point
  }
}

function decodeEntity(m: string): string {
  const named = NAMED_ENTITIES[m];
  if (named !== undefined) return named;
  if (m.startsWith("&#x") || m.startsWith("&#X")) {
    const code = Number.parseInt(m.slice(3, -1), 16);
    return Number.isNaN(code) ? " " : fromCodePoint(code);
  }
  if (m.startsWith("&#")) {
    const code = Number.parseInt(m.slice(2, -1), 10);
    return Number.isNaN(code) ? " " : fromCodePoint(code);
  }
  return " "; // unknown named entity
}

export function extractText(html: string): string {
  const withoutBlocks = html.replace(BLOCK_ELEMENTS, " ");
  const withoutTags = withoutBlocks.replace(TAGS, " ");
  const decoded = withoutTags.replace(ENTITY, decodeEntity);
  return decoded.replace(/\s+/g, " ").trim();
}
