// Generates a one-page A4 sales leave-behind PDF at docs/PM-Assistant-onepager.pdf.
// Re-run after edits:  node packages/documents/scripts/make-onepager.mjs
import { writeFile } from "node:fs/promises";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

const A4 = [595.28, 841.89];
const M = 50;
const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);
const page = doc.addPage(A4);
const W = A4[0];
const contentW = W - M * 2;
const teal = rgb(0.07, 0.3, 0.34);
const gray = rgb(0.42, 0.42, 0.42);
const black = rgb(0.12, 0.12, 0.12);
let y = A4[1] - M;

function wrap(str, f, size, maxW) {
  const lines = [];
  let line = "";
  for (const w of str.split(/\s+/)) {
    const t = line ? `${line} ${w}` : w;
    if (line && f.widthOfTextAtSize(t, size) > maxW) {
      lines.push(line);
      line = w;
    } else {
      line = t;
    }
  }
  if (line) lines.push(line);
  return lines;
}
function para(str, { f = font, size = 10.5, color = black, lh = 14 } = {}) {
  for (const ln of wrap(str, f, size, contentW)) {
    page.drawText(ln, { x: M, y, size, font: f, color });
    y -= lh;
  }
}
function heading(str) {
  y -= 8;
  para(str, { f: bold, size: 11.5, color: teal, lh: 15 });
  y -= 1;
}
function bullet(str) {
  const indent = 13;
  const lines = wrap(str, font, 10.5, contentW - indent);
  page.drawText("•", { x: M, y, size: 10.5, font: bold, color: teal });
  for (const ln of lines) {
    page.drawText(ln, { x: M + indent, y, size: 10.5, font, color: black });
    y -= 13.5;
  }
}
function rule() {
  y -= 6;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: teal });
  y -= 12;
}

page.drawText("PM Assistant", { x: M, y, size: 26, font: bold, color: teal });
y -= 26;
para("AI email drafting for Queensland property managers", { size: 11.5, color: gray, lh: 16 });
rule();

para(
  "Every tenant and owner email - replied to, compliant, and in your voice. Your property manager reviews and sends. The AI never sends on its own.",
  { f: bold, size: 11, lh: 15 },
);

heading("The problem");
para(
  "Property managers lose hours every day to the inbox - and a wrong answer on notice periods, entry rules, or an after-hours emergency is a real compliance risk under the 2024-25 Queensland rental reforms.",
);

heading("What it does");
bullet("Reads every inbound email and drafts a ready-to-send reply");
bullet(
  "Categorises and triages urgency; flags statutory emergencies (e.g. no hot water = s214) and raises owner alerts",
);
bullet("Applies QLD tenancy law (RTRA Act + 2024-25 reforms) to notice periods and entry rules");
bullet("Lands in a daily review queue - your PM edits, approves, and sends");

heading("Why property managers choose it");
bullet("Around 1.5-2.5 hours back, per property manager, per day");
bullet("Handle more doors without hiring another PM");
bullet("Fewer compliance slips and less after-hours stress");
bullet(
  "Also: one-click statutory documents, maintenance coordination, and automated arrears / renewal / inspection reminders",
);

heading("Built on trust");
para(
  "The AI drafts; your PM decides. Nothing is ever sent automatically, each agency's data is fully isolated, and every document is a draft to review - not legal advice.",
);

heading("Simple pricing");
para(
  "Per door, per month. Start with a no-commitment pilot: we connect one mailbox, you review the drafts, and you decide.",
);

rule();
para("See it work on a live email in 10 minutes.", { f: bold, size: 12, color: teal, lh: 16 });
para("ryanmay065@gmail.com", { size: 11, lh: 15 });
y -= 4;
para(
  "Drafts are for review only and are not legal advice. PM Assistant is an early-stage pilot product.",
  { size: 8.5, color: gray, lh: 11 },
);

const bytes = await doc.save();
const out = new URL("../../../docs/PM-Assistant-onepager.pdf", import.meta.url);
await writeFile(out, bytes);
console.log(`wrote ${out.pathname} (${bytes.length} bytes)`);
