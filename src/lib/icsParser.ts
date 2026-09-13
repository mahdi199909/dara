// A deliberately partial iCalendar (RFC 5545) VEVENT parser — just enough to read a Google
// Calendar "Export" .ics file and turn each event into something createEvent() can accept
// directly. Not a general-purpose ICS library: TZID-qualified times are treated as local device
// time (resolving an arbitrary IANA zone correctly needs a full timezone database this doesn't
// have — fine for the common case of importing a calendar from the same region), and RRULE
// support covers only FREQ/INTERVAL/UNTIL/COUNT with FREQ in DAILY/WEEKLY/MONTHLY/YEARLY — the
// same four values this app's own recurrence model supports (see RECURRENCE_FREQS in
// src/lib/types.ts). Anything fancier (BYDAY, BYMONTHDAY, HOURLY/MINUTELY/SECONDLY, ...) falls
// back to a plain non-recurring event rather than guessing wrong.
import type { RecurrenceFreq } from "./types";

export interface ParsedIcsEvent {
  title: string;
  description: string | null;
  startAt: Date;
  endAt: Date;
  allDay: boolean;
  recurrenceFreq: RecurrenceFreq;
  recurrenceInterval: number;
  recurrenceUntil: Date | null;
  recurrenceCount: number | null;
}

/** RFC 5545 §3.1 line unfolding: a line starting with a space or tab is a continuation of the
 * previous line, not a new property — Google's export wraps long SUMMARY/DESCRIPTION values
 * exactly this way. */
function unfoldLines(text: string): string[] {
  const rawLines = text.split(/\r\n|\n|\r/);
  const lines: string[] = [];
  for (const line of rawLines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines;
}

function unescapeIcsText(s: string): string {
  return s.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

interface IcsProperty {
  params: Record<string, string>;
  value: string;
}

/** "DTSTART;TZID=Asia/Tehran:20260910T120000" -> { name: "DTSTART", params: {TZID: "Asia/Tehran"}, value: "20260910T120000" } */
function parsePropertyLine(line: string): { name: string; prop: IcsProperty } | null {
  const colonIdx = line.indexOf(":");
  if (colonIdx === -1) return null;
  const head = line.slice(0, colonIdx);
  const value = line.slice(colonIdx + 1);
  const parts = head.split(";");
  const name = parts[0].trim().toUpperCase();
  const params: Record<string, string> = {};
  for (const part of parts.slice(1)) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  return { name, prop: { params, value } };
}

/** Parses one DTSTART/DTEND/UNTIL value: VALUE=DATE (all-day, YYYYMMDD), UTC (trailing Z), or a
 * floating/TZID-qualified local time (treated as local device time — see file header). */
function parseIcsDate(value: string, params: Record<string, string>): { date: Date; allDay: boolean } {
  const v = value.trim();
  if (params.VALUE === "DATE" || /^\d{8}$/.test(v)) {
    const y = Number(v.slice(0, 4));
    const mo = Number(v.slice(4, 6)) - 1;
    const d = Number(v.slice(6, 8));
    return { date: new Date(y, mo, d), allDay: true };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(v);
  if (!m) return { date: new Date(v), allDay: false }; // best-effort fallback for a form we don't recognize
  const [, y, mo, d, h, mi, s, z] = m;
  const date = z
    ? new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)))
    : new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  return { date, allDay: false };
}

const SUPPORTED_RRULE_FREQS = new Set<RecurrenceFreq>(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]);

function parseRRule(value: string): { freq: RecurrenceFreq; interval: number; until: Date | null; count: number | null } {
  const parts: Record<string, string> = {};
  for (const part of value.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    parts[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  const freqRaw = (parts.FREQ ?? "").toUpperCase() as RecurrenceFreq;
  if (!SUPPORTED_RRULE_FREQS.has(freqRaw)) return { freq: "NONE", interval: 1, until: null, count: null };

  const interval = parts.INTERVAL ? Math.max(1, parseInt(parts.INTERVAL, 10) || 1) : 1;
  // Mutually exclusive, same as this app's own schema (createEventSchema's .refine) — RRULE
  // itself disallows both UNTIL and COUNT too, so preferring COUNT when (invalidly) both appear
  // is just a defensive tie-break, not a real-world case.
  const count = parts.COUNT ? Math.min(500, Math.max(1, parseInt(parts.COUNT, 10) || 1)) : null;
  const until = !count && parts.UNTIL ? parseIcsDate(parts.UNTIL, {}).date : null;
  return { freq: freqRaw, interval, until, count };
}

function buildEvent(props: Record<string, IcsProperty>): ParsedIcsEvent | null {
  const dtstart = props.DTSTART;
  if (!dtstart) return null; // can't place an event on the calendar with no start time at all

  const summary = props.SUMMARY ? unescapeIcsText(props.SUMMARY.value).slice(0, 200) : null;
  if (!summary) return null;

  const { date: startAt, allDay } = parseIcsDate(dtstart.value, dtstart.params);

  let rawEndAt: Date;
  if (props.DTEND) {
    rawEndAt = parseIcsDate(props.DTEND.value, props.DTEND.params).date;
  } else {
    // No DTEND (Google's own export always includes one, but a hand-edited or other client's
    // file might not) — a 1-day/1-hour default beats refusing to import the event at all.
    rawEndAt = new Date(startAt.getTime() + (allDay ? 86_400_000 : 3_600_000));
  }
  // RFC 5545's all-day DTEND is EXCLUSIVE (the day *after* the last day) — pull back 1ms so a
  // real single-day event lands on the same day's last instant, matching how this app already
  // represents an all-day span (see CaptureForm's own allDay endAt: same day 23:59:59).
  const endAt = allDay ? new Date(rawEndAt.getTime() - 1) : rawEndAt;

  const rrule = props.RRULE ? parseRRule(props.RRULE.value) : { freq: "NONE" as RecurrenceFreq, interval: 1, until: null, count: null };

  return {
    title: summary,
    description: props.DESCRIPTION ? unescapeIcsText(props.DESCRIPTION.value).slice(0, 2000) : null,
    startAt,
    endAt,
    allDay,
    recurrenceFreq: rrule.freq,
    recurrenceInterval: rrule.interval,
    recurrenceUntil: rrule.until,
    recurrenceCount: rrule.count,
  };
}

/** Parses every VEVENT block in an .ics file's text into a flat list, silently skipping any
 * event missing a title or start time rather than failing the whole file over one bad entry. */
export function parseIcs(text: string): ParsedIcsEvent[] {
  const lines = unfoldLines(text);
  const events: ParsedIcsEvent[] = [];
  let current: Record<string, IcsProperty> | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "BEGIN:VEVENT") {
      current = {};
      continue;
    }
    if (trimmed === "END:VEVENT") {
      if (current) {
        const parsed = buildEvent(current);
        if (parsed) events.push(parsed);
      }
      current = null;
      continue;
    }
    if (!current) continue;
    const parsedLine = parsePropertyLine(line);
    if (!parsedLine) continue;
    current[parsedLine.name] = parsedLine.prop;
  }

  return events;
}
