// Minimal RFC-4180-ish CSV parser — handles quoted fields, escaped quotes,
// embedded commas/newlines, CRLF, and a UTF-8 BOM. No dependency: portfolio
// exports are small (hundreds of rows) and the import UI needs nothing fancier.

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

export function parseCsv(text: string): ParsedCsv {
  const src = text.replace(/^﻿/, "");
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;

  const pushField = () => {
    record.push(field);
    field = "";
  };
  const pushRecord = () => {
    pushField();
    // Skip records that are entirely empty (trailing newline, blank lines).
    if (record.some((f) => f.trim() !== "")) records.push(record);
    record = [];
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      pushField();
    } else if (ch === "\n") {
      pushRecord();
    } else if (ch === "\r") {
      if (src[i + 1] === "\n") i++;
      pushRecord();
    } else {
      field += ch;
    }
  }
  if (field !== "" || record.length > 0) pushRecord();

  const headers = (records.shift() ?? []).map((h) => h.trim());
  return { headers, rows: records };
}
