// The shapes of «مسیر» — the story page that reads a person's recorded days back as flowing prose.
//
// Three layers, so the words can never disagree between the web and the phone:
//   1. the ROWS below — what happened, as plain facts. Two loaders produce them (Prisma for the web app in
//      src/lib/journeyData.ts, SQLite for the phone in src/local/journeyData.ts) and both must return exactly this;
//   2. the ENGINE (src/lib/journeyEngine.ts) — pure: rows in, prose out, nothing else;
//   3. the screen (src/app/(app)/journey/page.tsx) that lays the prose out.
//
// Everything here is an ISO string or a plain number (never a Date): the rows travel as JSON, and the engine
// groups them into days in the reader's own time zone — the same rule the calendar uses.

export interface JourneyEventRow {
  id: string;
  title: string;
  /** ISO. One row per occurrence of a recurring event. */
  startAt: string;
  endAt: string;
  allDay: boolean;
  location: string | null;
  project: string | null;
  category: string | null;
  /** The occurrence was ticked as done in the calendar. Not ticking it does not mean it did not happen. */
  done: boolean;
}

export interface JourneyTaskRow {
  id: string;
  title: string;
  /** ISO — when it was done: the logged start when there is one, otherwise the completion moment. */
  at: string;
  /** Minutes logged on the task itself (start→end), or null when it carries no time. */
  minutes: number | null;
  project: string | null;
  category: string | null;
}

/** A finished stretch of tracked time (an Activity's time entry). */
export interface JourneyWorkRow {
  id: string;
  title: string;
  /** ISO. */
  startAt: string;
  minutes: number;
  project: string | null;
  category: string | null;
}

export interface JourneyHabitRow {
  /** The check-in's id. */
  id: string;
  habitId: string;
  title: string;
  /** ISO — the day it was checked in for (local midnight). */
  date: string;
  /** ISO — when it was ticked, which orders the day's habits the way the day went (morning ones first). */
  at: string;
  minutes: number | null;
  /** How many days in a row this habit had been done, counting this one (1 = it had been missed the day before). */
  streak: number;
}

export interface JourneyNoteRow {
  id: string;
  /** "YYYY-MM-DD", the local calendar day the note belongs to. */
  day: string;
  text: string;
  /** ISO — when it was written, which tells morning thoughts from last-thing-at-night ones. */
  createdAt: string;
}

/** A project beginning or ending — the landmarks of a path. */
export interface JourneyMilestoneRow {
  id: string;
  kind: "STARTED" | "COMPLETED";
  name: string;
  /** ISO. */
  at: string;
}

export interface JourneyRows {
  events: JourneyEventRow[];
  tasks: JourneyTaskRow[];
  work: JourneyWorkRow[];
  habits: JourneyHabitRow[];
  notes: JourneyNoteRow[];
  milestones: JourneyMilestoneRow[];
  /** "YYYY-MM-DD" of the earliest thing the person ever recorded (over the whole history, not just the asked range); null when there is nothing at all. */
  earliestDay: string | null;
}

export const EMPTY_JOURNEY_ROWS: JourneyRows = { events: [], tasks: [], work: [], habits: [], notes: [], milestones: [], earliestDay: null };

// ---------------------------------------------------------------------------------------------
// What the engine writes

/** One note, set apart from the narration: the person's own words, with the lead-in that introduces them. */
export interface JourneyNoteBlock {
  lead: string;
  text: string;
}

export interface JourneyDay {
  kind: "day";
  /** "YYYY-MM-DD" (local). */
  key: string;
  /** «شنبه ۲۵ مهر». */
  label: string;
  /** «امروز» / «دیروز» — only for those two. */
  relative: string | null;
  paragraphs: string[];
  notes: JourneyNoteBlock[];
  /** A landmark day (a project began or ended) — the screen marks it. */
  landmark: boolean;
}

/** Days with nothing recorded, folded into one quiet line. */
export interface JourneyGap {
  kind: "gap";
  /** First and last day of the run, "YYYY-MM-DD". */
  from: string;
  to: string;
  days: number;
  text: string;
}

export type JourneyEntry = JourneyDay | JourneyGap;

export interface JourneyChapter {
  /** "1405-07" — a Jalali month. */
  key: string;
  jy: number;
  jm: number;
  /** «مهر ۱۴۰۵». */
  title: string;
  /** «ماهِ «سایت آتلیه»» when one project clearly filled the month, otherwise null. */
  subtitle: string | null;
  /** Two or three sentences about the month as a whole; null when nothing was recorded in it. */
  summary: string | null;
  /** Oldest first. */
  entries: JourneyEntry[];
  /** Any day of the month has something in it. */
  hasContent: boolean;
}
