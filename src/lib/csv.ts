function escapeCsvField(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export function toCsv(rows: Record<string, unknown>[], columns: { key: string; header: string }[]): string {
  const header = columns.map((c) => escapeCsvField(c.header)).join(",");
  const body = rows.map((row) => columns.map((c) => escapeCsvField(row[c.key])).join(",")).join("\n");
  return "﻿" + header + "\n" + body; // BOM so Excel opens UTF-8/Persian text correctly
}
