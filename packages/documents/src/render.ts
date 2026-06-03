import type { DocumentModel } from "./model";

// ============================================================================
// HTML renderer — turns a DocumentModel into a clean, print-ready document.
// ============================================================================
// Self-contained HTML (inline CSS, A4 print styles) so it can be viewed,
// printed, or saved to PDF from the browser. All interpolated values are HTML-
// escaped. A binary-PDF renderer can replace this later without touching the
// model builders.
// ============================================================================

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function partyBlock(label: string, name: string, lines: string[]): string {
  const extra = lines
    .filter((l) => l.trim() !== "")
    .map((l) => `<div>${esc(l)}</div>`)
    .join("");
  return `<div class="party"><div class="party-label">${esc(label)}</div><div class="party-name">${esc(name)}</div>${extra}</div>`;
}

export function renderDocumentHtml(model: DocumentModel): string {
  const fieldRows = model.fields
    .map((f) => `<tr><th scope="row">${esc(f.label)}</th><td>${esc(f.value)}</td></tr>`)
    .join("");

  const sections = model.sections
    .map((s) => {
      const heading = s.heading ? `<h2>${esc(s.heading)}</h2>` : "";
      const paras = s.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("");
      return `<section>${heading}${paras}</section>`;
    })
    .join("");

  const formBadge = model.formId ? `<div class="form-id">RTA Form ${esc(model.formId)}</div>` : "";

  const rules =
    model.ruleVersions.length > 0
      ? `<div class="rules">Compliance rule versions: ${esc(model.ruleVersions.join(", "))}</div>`
      : "";

  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(model.title)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #111; margin: 0; background: #f5f5f5; }
  .page { max-width: 800px; margin: 24px auto; background: #fff; padding: 48px; box-shadow: 0 1px 4px rgba(0,0,0,.12); }
  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 2px solid #111; padding-bottom: 12px; }
  h1 { font-size: 22px; margin: 0; }
  .form-id { font-size: 12px; font-weight: 600; color: #555; white-space: nowrap; }
  .meta { font-size: 13px; color: #555; margin-top: 4px; }
  .parties { display: flex; gap: 32px; margin: 24px 0; }
  .party-label { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #777; }
  .party-name { font-weight: 600; }
  table.fields { width: 100%; border-collapse: collapse; margin: 16px 0 24px; }
  table.fields th, table.fields td { text-align: left; vertical-align: top; padding: 8px 10px; border-bottom: 1px solid #e5e5e5; font-size: 14px; }
  table.fields th { width: 38%; color: #555; font-weight: 600; }
  section { margin: 16px 0; }
  h2 { font-size: 15px; margin: 16px 0 6px; }
  p { font-size: 14px; line-height: 1.55; margin: 8px 0; }
  footer { margin-top: 32px; border-top: 1px solid #e5e5e5; padding-top: 12px; font-size: 11px; color: #777; }
  .rules { margin-bottom: 6px; }
  @media print {
    body { background: #fff; }
    .page { box-shadow: none; margin: 0; max-width: none; padding: 24px; }
  }
</style>
</head>
<body>
  <div class="page">
    <header>
      <div>
        <h1>${esc(model.title)}</h1>
        <div class="meta">Issued ${esc(model.generatedDate)}</div>
      </div>
      ${formBadge}
    </header>

    <div class="parties">
      ${partyBlock("From", model.from.name, model.from.addressLines)}
      ${partyBlock("To", model.to.name, model.to.addressLines)}
    </div>

    <table class="fields"><tbody>${fieldRows}</tbody></table>

    ${sections}

    <footer>
      ${rules}
      <div>${esc(model.disclaimer)}</div>
    </footer>
  </div>
</body>
</html>`;
}
