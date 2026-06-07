import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from "pdf-lib";
import type { DocumentModel } from "./model";

// ============================================================================
// PDF renderer for a DocumentModel (Phase 4 follow-up)
// ============================================================================
// Pure pdf-lib — no external fonts, no network, so it runs on Cloudflare
// Workers. Mirrors renderDocumentHtml's content with a simple, deterministic
// A4 layout. Additive: the HTML renderer is untouched.
// ============================================================================

const PAGE = { width: 595.28, height: 841.89 }; // A4 portrait, points
const MARGIN = 56;
const CONTENT_WIDTH = PAGE.width - MARGIN * 2;
const INK = rgb(0.1, 0.1, 0.1);
const MUTED = rgb(0.42, 0.42, 0.42);

type Seg = { text: string; font: PDFFont };

export async function renderDocumentPdf(model: DocumentModel): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const oblique = await pdf.embedFont(StandardFonts.HelveticaOblique);
  pdf.setTitle(model.title);

  let page: PDFPage = pdf.addPage([PAGE.width, PAGE.height]);
  let y = PAGE.height - MARGIN;

  const ensure = (needed: number) => {
    if (y - needed < MARGIN) {
      page = pdf.addPage([PAGE.width, PAGE.height]);
      y = PAGE.height - MARGIN;
    }
  };

  // Draw rich (mixed-font) segments with word wrap. Words inherit their
  // segment's font; whitespace at a line start is dropped.
  const drawRich = (segs: Seg[], size: number, indent = 0, color = INK, gap = 5) => {
    const maxWidth = CONTENT_WIDTH - indent;
    const tokens: Seg[] = [];
    for (const s of segs) {
      for (const p of s.text.split(/(\s+)/)) if (p.length) tokens.push({ text: p, font: s.font });
    }
    let line: Seg[] = [];
    let lineWidth = 0;
    const flush = () => {
      // trim a trailing space token
      while (line.length > 0 && line[line.length - 1]?.text.trim() === "") line.pop();
      ensure(size + gap);
      y -= size;
      let x = MARGIN + indent;
      for (const t of line) {
        page.drawText(t.text, { x, y, size, font: t.font, color });
        x += t.font.widthOfTextAtSize(t.text, size);
      }
      y -= gap;
      line = [];
      lineWidth = 0;
    };
    for (const t of tokens) {
      const w = t.font.widthOfTextAtSize(t.text, size);
      const isSpace = t.text.trim() === "";
      if (line.length === 0 && isSpace) continue; // no leading space
      if (lineWidth + w > maxWidth && line.length > 0 && !isSpace) flush();
      if (line.length === 0 && isSpace) continue;
      line.push(t);
      lineWidth += w;
    }
    if (line.length) flush();
  };

  const para = (text: string, size = 10, indent = 0, color = INK) => {
    for (const block of text.split("\n"))
      drawRich([{ text: block || " ", font }], size, indent, color);
  };
  const gap = (h: number) => {
    ensure(h);
    y -= h;
  };
  const rule = () => {
    ensure(10);
    y -= 6;
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE.width - MARGIN, y },
      thickness: 0.5,
      color: MUTED,
    });
    y -= 8;
  };

  // --- Title + meta ---
  drawRich([{ text: model.title, font: bold }], 17, 0, INK, 7);
  drawRich([{ text: `Generated: ${model.generatedDate}`, font }], 9, 0, MUTED);
  gap(6);

  // --- Parties ---
  drawRich(
    [
      { text: "From: ", font: bold },
      { text: model.from.name, font },
    ],
    10,
  );
  for (const l of model.from.addressLines) para(l, 10, 12);
  gap(3);
  drawRich(
    [
      { text: "To: ", font: bold },
      { text: model.to.name, font },
    ],
    10,
  );
  for (const l of model.to.addressLines) para(l, 10, 12);
  rule();

  // --- Fields (bold label : value, inline-wrapped) ---
  for (const f of model.fields) {
    drawRich(
      [
        { text: `${f.label}: `, font: bold },
        { text: f.value, font },
      ],
      10,
    );
  }
  gap(4);

  // --- Sections ---
  for (const s of model.sections) {
    rule();
    if (s.heading) {
      drawRich([{ text: s.heading, font: bold }], 12, 0, INK, 6);
      gap(2);
    }
    for (const p of s.paragraphs) {
      para(p, 10);
      gap(4);
    }
  }

  // --- Disclaimer ---
  gap(8);
  rule();
  drawRich([{ text: model.disclaimer, font: oblique }], 8, 0, MUTED);

  return pdf.save();
}
