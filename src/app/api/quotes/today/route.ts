import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { corsPreflight, withCors } from "@/lib/nativeCors";

// Content lives outside src/ on purpose — it's editable copy, not code, and the whole point is
// that whoever runs this app can update it without touching TypeScript. Read fresh on every
// request (not cached at module load) so a redeploy with new quotes takes effect immediately.
const QUOTES_FILE = join(process.cwd(), "content", "quotes.md");

function loadQuotes(): string[] {
  let raw: string;
  try {
    raw = readFileSync(QUOTES_FILE, "utf8");
  } catch {
    return [];
  }
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

// A stable, deterministic pick per calendar day (UTC) — same quote for every user all day,
// changing at midnight UTC, with no need to persist "today's pick" anywhere.
function dayOfYear(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const diff = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - start;
  return Math.floor(diff / 86_400_000);
}

export async function OPTIONS() {
  return corsPreflight();
}

// Public and unauthenticated on purpose: the text itself isn't user-specific (every user on a
// given day gets the same quote), so there's nothing here worth gating behind a session. The
// client alone decides whether to display it, based on the viewer's own cached license status.
export async function GET() {
  const quotes = loadQuotes();
  if (quotes.length === 0) return withCors(NextResponse.json({ quote: null }));
  const quote = quotes[dayOfYear(new Date()) % quotes.length];
  return withCors(NextResponse.json({ quote }));
}
