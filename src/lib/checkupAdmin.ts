// What the owner's /dashboard/checkup reads: the research form's answers under a filter, the kit's metrics
// over them (checkup.ts), the free-text answers that are raw material for copywriting, and the contacts.
// Server only (Prisma); the routes that call it run requireAdmin first.
import { prisma } from "./db";
import { OPTIONS, computeCheckupMetrics, suspiciousIds, type CheckupAnswers, type CheckupMetrics, type MetricRow } from "./checkup";

export const GROUP_FILTERS = ["all", "blind", "branded", "unknown"] as const;
export type GroupFilter = (typeof GROUP_FILTERS)[number];

export interface CheckupFilter {
  group: GroupFilter;
  from: Date | null;
  to: Date | null;
  hideSuspicious: boolean;
}

/** Reads ?group=&from=YYYY-MM-DD&to=YYYY-MM-DD&hide=1; anything unreadable falls back to "no filter". */
export function parseFilter(params: URLSearchParams): CheckupFilter {
  const group = (GROUP_FILTERS as readonly string[]).includes(params.get("group") ?? "") ? (params.get("group") as GroupFilter) : "all";
  const day = (v: string | null, endOfDay: boolean) => {
    if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
    const d = new Date(`${v}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+03:30`);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  return { group, from: day(params.get("from"), false), to: day(params.get("to"), true), hideSuspicious: params.get("hide") === "1" };
}

const SELECT = {
  id: true,
  createdAt: true,
  completedAt: true,
  lastPage: true,
  source: true,
  sourceGroup: true,
  durationSec: true,
  ipHash: true,
  awakeMinutes: true,
  namedMinutes: true,
  hiddenMinutes: true,
  restOfDayForgot: true,
  hourlyValue: true,
  hourlyNeverThought: true,
  monthSpendAnswer: true,
  toolsUsed: true,
  toolLastOpened: true,
  paidBefore: true,
  builtHoursKnown: true,
  lastEmptyMonth: true,
  incomeShape: true,
  dependents: true,
  age: true,
  city: true,
  contactTelegram: true,
  contactPhone: true,
  contactEmail: true,
  interviewOk: true,
  reportViewedAt: true,
  sharedAt: true,
  downloadedAt: true,
  inviteTelegramAt: true,
  inviteAppAt: true,
  answersJson: true,
} as const;

export interface LoadedRow extends MetricRow {
  source: string;
  awakeMinutes: number | null;
  namedMinutes: number | null;
  hiddenMinutes: number | null;
  builtHoursKnown: string | null;
  dependents: string | null;
  age: number | null;
  city: string | null;
  contactTelegram: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  interviewOk: boolean | null;
  answers: CheckupAnswers;
  suspicious: boolean;
}

function parseAnswers(json: string): CheckupAnswers {
  try {
    const value = JSON.parse(json);
    return value && typeof value === "object" ? (value as CheckupAnswers) : {};
  } catch {
    return {};
  }
}

export async function loadCheckupRows(filter: CheckupFilter): Promise<{ rows: LoadedRow[]; suspiciousCount: number }> {
  const raw = await prisma.checkupResponse.findMany({
    where: {
      ...(filter.group === "all" ? {} : { sourceGroup: filter.group }),
      ...(filter.from || filter.to ? { createdAt: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lte: filter.to } : {}) } } : {}),
    },
    select: SELECT,
    orderBy: { createdAt: "desc" },
  });
  const rows = raw.map(({ answersJson, ...r }) => {
    const answers = parseAnswers(answersJson);
    return { ...r, answers, answeredRest: (answers.rest ?? []).length > 0, suspicious: false };
  });
  const flagged = suspiciousIds(rows);
  for (const r of rows) r.suspicious = flagged.has(r.id);
  return { rows: filter.hideSuspicious ? rows.filter((r) => !r.suspicious) : rows, suspiciousCount: flagged.size };
}

export interface FreeText {
  id: string;
  at: string;
  sourceGroup: string;
  text: string;
  suspicious: boolean;
}

export interface CheckupDashboard {
  metrics: CheckupMetrics;
  suspiciousCount: number;
  texts: { regret: FreeText[]; whyLeft: FreeText[]; built: FreeText[]; paidWhat: FreeText[] };
  contacts: {
    id: string;
    at: string;
    sourceGroup: string;
    telegram: string | null;
    bale: string | null;
    email: string | null;
    interviewOk: boolean | null;
    income: string | null;
    hiddenMinutes: number | null;
    suspicious: boolean;
  }[];
}

export async function checkupDashboard(filter: CheckupFilter): Promise<CheckupDashboard> {
  const { rows, suspiciousCount } = await loadCheckupRows(filter);
  const texts = (pick: (a: CheckupAnswers) => string | undefined): FreeText[] =>
    rows
      .filter((r) => pick(r.answers))
      .map((r) => ({ id: r.id, at: r.createdAt.toISOString(), sourceGroup: r.sourceGroup, text: pick(r.answers)!, suspicious: r.suspicious }));
  return {
    metrics: computeCheckupMetrics(rows),
    suspiciousCount,
    texts: { regret: texts((a) => a.regret), whyLeft: texts((a) => a.toolWhyLeft), built: texts((a) => a.built), paidWhat: texts((a) => a.paidWhat) },
    contacts: rows
      .filter((r) => r.contactTelegram || r.contactPhone || r.contactEmail)
      .map((r) => ({
        id: r.id,
        at: r.createdAt.toISOString(),
        sourceGroup: r.sourceGroup,
        telegram: r.contactTelegram,
        bale: r.contactPhone,
        email: r.contactEmail,
        interviewOk: r.interviewOk,
        income: r.incomeShape,
        hiddenMinutes: r.hiddenMinutes,
        suspicious: r.suspicious,
      })),
  };
}

const label = (q: keyof typeof OPTIONS, key: string | null | undefined) => (key ? ((OPTIONS[q] as Record<string, string>)[key] ?? key) : "");

/** One flat row per answer sheet for the CSV export: the queryable columns plus every raw answer. */
export function exportRows(rows: LoadedRow[]): Record<string, unknown>[] {
  return rows.map((r) => {
    const a = r.answers;
    const tasks = a.tasks ?? [];
    return {
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? "",
      lastPage: r.lastPage,
      source: r.source,
      sourceGroup: r.sourceGroup,
      durationSec: r.durationSec ?? "",
      suspicious: r.suspicious ? "yes" : "",
      wake: a.wake ?? "",
      sleep: a.sleep ?? "",
      task1: tasks[0]?.title ?? "",
      task1Hours: tasks[0]?.hours ?? "",
      task2: tasks[1]?.title ?? "",
      task2Hours: tasks[1]?.hours ?? "",
      task3: tasks[2]?.title ?? "",
      task3Hours: tasks[2]?.hours ?? "",
      awakeMinutes: r.awakeMinutes ?? "",
      namedMinutes: r.namedMinutes ?? "",
      hiddenMinutes: r.hiddenMinutes ?? "",
      rest: (a.rest ?? []).map((k) => label("rest", k)).join(" | "),
      restOfDayForgot: r.restOfDayForgot ? "yes" : "",
      hourlyValue: r.hourlyValue ?? "",
      hourlyNeverThought: r.hourlyNeverThought ? "yes" : "",
      regret: a.regretNone ? "پیش نیومده" : (a.regret ?? ""),
      monthSpend: label("monthSpend", r.monthSpendAnswer),
      tools: (a.tools ?? []).map((k) => label("tools", k)).join(" | "),
      toolIran: a.toolIran ?? "",
      toolForeign: a.toolForeign ?? "",
      toolLastOpened: label("toolLastOpened", r.toolLastOpened),
      toolWhyLeft: a.toolWhyLeft ?? "",
      paid: label("paid", r.paidBefore),
      paidWhat: a.paidWhat ?? "",
      built: a.builtNone ? "چیزی به ذهنم نمی‌رسه" : (a.built ?? ""),
      builtHours: label("builtHours", r.builtHoursKnown),
      lastEmpty: label("lastEmpty", r.lastEmptyMonth),
      income: label("income", r.incomeShape),
      dependents: label("dependents", r.dependents),
      age: r.age ?? "",
      city: r.city ?? "",
      contactTelegram: r.contactTelegram ?? "",
      contactBale: r.contactPhone ?? "",
      contactEmail: r.contactEmail ?? "",
      interview: r.interviewOk === null ? "" : r.interviewOk ? "بله" : "نه",
      reportViewedAt: r.reportViewedAt?.toISOString() ?? "",
      sharedAt: r.sharedAt?.toISOString() ?? "",
      downloadedAt: r.downloadedAt?.toISOString() ?? "",
      inviteTelegramAt: r.inviteTelegramAt?.toISOString() ?? "",
      inviteAppAt: r.inviteAppAt?.toISOString() ?? "",
    };
  });
}

export const EXPORT_COLUMNS = [
  "id", "createdAt", "completedAt", "lastPage", "source", "sourceGroup", "durationSec", "suspicious",
  "wake", "sleep", "task1", "task1Hours", "task2", "task2Hours", "task3", "task3Hours",
  "awakeMinutes", "namedMinutes", "hiddenMinutes", "rest", "restOfDayForgot", "hourlyValue", "hourlyNeverThought",
  "regret", "monthSpend", "tools", "toolIran", "toolForeign", "toolLastOpened", "toolWhyLeft", "paid", "paidWhat",
  "built", "builtHours", "lastEmpty", "income", "dependents", "age", "city",
  "contactTelegram", "contactBale", "contactEmail", "interview",
  "reportViewedAt", "sharedAt", "downloadedAt", "inviteTelegramAt", "inviteAppAt",
].map((key) => ({ key, header: key }));
