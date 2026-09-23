// From "what the line means" (src/lib/captureIntent.ts) to "what to do about it": finds the habit, the
// installment plan, the category or the account the words point at among what the person already has,
// and turns the intent into the API calls (src/lib/captureSteps.ts) that carry it out. Pure — it is
// given a snapshot of the person's data and hands back a description; the caller runs it. The web's
// confirmation card shows the description before anything is saved; the phone runs it straight away
// for a line typed into the widget.
import type { CaptureIntent } from "./captureIntent";
import type { CaptureStep } from "./captureSteps";
import { captureSummary, hhmm, planSaveCapture, type CaptureSummary, type SaveCaptureInput } from "./captureSave";
import { matchCategoryHint, matchProjectHint, type CapturePrefill } from "./smartCapture";
import { CAPTURE_TYPE_LABELS, type ValueType } from "./types";
import { formatJalali } from "./jalali";
import { toPersianDigits } from "./money";

export interface SnapshotCategory {
  id: string;
  name: string;
  isActive: boolean;
  projectId?: string | null;
  kind?: string;
  valueType?: ValueType;
}
export interface SnapshotHabit {
  id: string;
  title: string;
  isActive?: boolean;
  checkedInToday?: boolean;
}
export interface SnapshotPlan {
  id: string;
  title: string;
  installments: Array<{ id: string; index: number; status: string; amount: number }>;
}
export interface SnapshotAccount {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
}

/** The parts of the person's data a line can point at — only the parts the line's intent needs are ever loaded. */
export interface CaptureSnapshot {
  categories: SnapshotCategory[];
  habits: SnapshotHabit[];
  plans: SnapshotPlan[];
  accounts: SnapshotAccount[];
}
export type SnapshotPart = keyof CaptureSnapshot;

const SNAPSHOT_SOURCES: Record<SnapshotPart, string> = {
  categories: "/api/categories",
  habits: "/api/habits",
  plans: "/api/installment-plans",
  accounts: "/api/accounts",
};

function pickPart(part: SnapshotPart, response: unknown): CaptureSnapshot[SnapshotPart] {
  const list = (response as Record<string, unknown> | null)?.[part];
  return (Array.isArray(list) ? list : []) as CaptureSnapshot[SnapshotPart];
}

export function snapshotNeeds(intent: CaptureIntent): SnapshotPart[] {
  switch (intent.kind) {
    case "ENTRY":
      return ["categories"];
    case "INSTALLMENT_PAY":
      return ["plans", "accounts"];
    case "HABIT_CHECKIN":
    case "HABIT_CREATE":
      return ["habits"];
    case "SAVINGS_GOAL":
      return ["accounts"];
    case "PROJECT_CREATE":
    case "BUDGET":
      return ["categories"];
    default:
      return [];
  }
}

function emptySnapshot(): CaptureSnapshot {
  return { categories: [], habits: [], plans: [], accounts: [] };
}

export async function loadSnapshot(needs: SnapshotPart[], get: (url: string) => Promise<unknown>): Promise<CaptureSnapshot> {
  const snapshot = emptySnapshot();
  for (const part of needs) (snapshot as unknown as Record<string, unknown>)[part] = pickPart(part, await get(SNAPSHOT_SOURCES[part]));
  return snapshot;
}

export function loadSnapshotSync(needs: SnapshotPart[], get: (url: string) => unknown): CaptureSnapshot {
  const snapshot = emptySnapshot();
  for (const part of needs) (snapshot as unknown as Record<string, unknown>)[part] = pickPart(part, get(SNAPSHOT_SOURCES[part]));
  return snapshot;
}

export interface CaptureDetail {
  label: string;
  text?: string;
  /** Toman — shown in whatever unit the person chose. */
  money?: number;
}

export interface CaptureResolution {
  /** What will be created, in a word or two: «طرح قسط جدید», «یادداشت». */
  title: string;
  details: CaptureDetail[];
  /** The calls that carry it out — empty when there is nothing to do or it cannot be done. */
  steps: CaptureStep[];
  /** The line named something that is not there («عادتی با این نام پیدا نشد») — nothing can be saved as understood. */
  problem?: string;
  /** It is already so (the habit is already ticked today) — nothing to do, and nothing wrong. */
  alreadyDone?: string;
  /** For an entry: what the Companion reacts to once it is saved, given the answers to `steps`. */
  summarize?: (results: unknown[]) => CaptureSummary | undefined;
}

// ---- matching a hint to the thing it names ----------------------------------------------------------

/** Compares names loosely: case, the ZWNJ inside «پس‌انداز», Arabic ی/ک and spacing do not count. */
export function looseName(text: string): string {
  return text
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(new RegExp("[\\u200c\\s]+", "g"), " ")
    .trim()
    .toLowerCase();
}

/**
 * The item a hint most plausibly names: the same name, then a name that contains the hint (or that the
 * hint contains), then one that shares a whole word with it. Ties go to the first in the list.
 */
export function bestMatch<T>(hint: string, items: T[], nameOf: (item: T) => string): T | null {
  const wanted = looseName(hint);
  if (!wanted) return null;
  const names = items.map((item) => looseName(nameOf(item)));
  const exact = names.indexOf(wanted);
  if (exact >= 0) return items[exact];
  const contains = names.findIndex((n) => n.length > 0 && (n.includes(wanted) || wanted.includes(n)));
  if (contains >= 0) return items[contains];
  const words = wanted.split(" ").filter((w) => w.length > 1);
  const shared = names.findIndex((n) => n.split(" ").some((w) => words.includes(w)));
  return shared >= 0 ? items[shared] : null;
}

function defaultAccount(accounts: SnapshotAccount[]): SnapshotAccount | null {
  const active = accounts.filter((a) => a.isActive);
  active.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  return active[0] ?? null;
}

const CREATE_DEFAULT_ACCOUNT: CaptureStep = () => ({ method: "POST", url: "/api/accounts", body: { name: "صندوق", type: "CASH" } });
const createdAccountId = (result: unknown) => (result as { account: { id: string } }).account.id;

function unresolved(title: string, problem: string): CaptureResolution {
  return { title, details: [], steps: [], problem };
}

// ---- an entry: task / event / logged time / expense / income ---------------------------------------

function entryKindLabel(prefill: CapturePrefill): string {
  if (prefill.amount != null) return prefill.flowType === "INCOME" ? "درآمد" : "هزینه";
  return CAPTURE_TYPE_LABELS[prefill.entityType];
}

/** What smart capture saves for an entry, matched against the person's categories and projects. */
export function resolveEntry(prefill: CapturePrefill, categories: SnapshotCategory[], now: Date, extra?: { allowOverlap?: boolean }): CaptureResolution {
  const matchedCategory = prefill.categoryHint ? matchCategoryHint(prefill.categoryHint, categories) : null;
  const matchedProject = prefill.projectHint ? matchProjectHint(prefill.projectHint, categories) : null;
  const projectToCreate = prefill.projectHint && !matchedProject ? prefill.projectHint : null;

  let categoryId: string | null = matchedCategory?.id ?? null;
  let projectId: string | null = matchedCategory?.projectId ?? null;
  let categoryKind: string | null = matchedCategory?.kind ?? null;
  const valueType: ValueType = matchedCategory && !matchedCategory.projectId ? matchedCategory.valueType ?? "EXPENSE" : "EXPENSE";
  if (matchedProject) {
    categoryId = matchedProject.id;
    projectId = matchedProject.projectId ?? null;
    categoryKind = matchedProject.kind ?? null;
  }

  const day = prefill.day ?? now;
  const input: SaveCaptureInput = {
    title: prefill.title,
    entityType: prefill.entityType,
    valueType,
    categoryId,
    projectId,
    categoryKind,
    day,
    startTime: prefill.start ? hhmm(prefill.start) : "",
    endTime: prefill.end ? hhmm(prefill.end) : "",
    flowType: prefill.flowType,
    amount: prefill.amount ?? undefined,
    allowOverlap: extra?.allowOverlap,
  };

  const steps: CaptureStep[] = [];
  let summarize = () => captureSummary(input);
  if (projectToCreate) {
    // A new project comes with a category of its own, made in the same transaction — read it back for its id.
    steps.push(() => ({ method: "POST", url: "/api/projects", body: { name: projectToCreate } }));
    steps.push(() => ({ method: "GET", url: "/api/categories" }));
    const ownCategory = (previous: unknown[]) => {
      const project = (previous[0] as { project: { id: string } }).project;
      const created = ((previous[1] as { categories?: SnapshotCategory[] }).categories ?? []).find((c) => c.projectId === project.id);
      return { created, categoryId: created?.id ?? null, projectId: created?.projectId ?? project.id };
    };
    steps.push(...planSaveCapture(input, { now, offset: 2, resolveTargets: ownCategory }));
    summarize = (results?: unknown[]) => captureSummary({ ...input, categoryKind: results ? ownCategory(results).created?.kind ?? null : null });
  } else {
    steps.push(...planSaveCapture(input, { now }));
  }

  const details: CaptureDetail[] = [];
  if (prefill.amount != null) details.push({ label: prefill.flowType === "COST" ? "هزینه" : "درآمد", money: prefill.amount });
  if (matchedCategory) details.push({ label: "دسته", text: matchedCategory.name });
  if (matchedProject) details.push({ label: "پروژه", text: matchedProject.name });
  if (projectToCreate) details.push({ label: "پروژه جدید", text: projectToCreate });

  return { title: entryKindLabel(prefill), details, steps, summarize };
}

// ---- everything else -------------------------------------------------------------------------------

export function resolveCapture(intent: CaptureIntent, snapshot: CaptureSnapshot, now: Date, options?: { allowOverlap?: boolean }): CaptureResolution {
  switch (intent.kind) {
    case "ENTRY":
      return resolveEntry(intent.prefill, snapshot.categories, now, { allowOverlap: options?.allowOverlap });

    case "REMINDER": {
      return {
        title: "یادآوری",
        details: [
          { label: "عنوان", text: intent.title },
          { label: "زمان", text: formatJalali(intent.start, { withTime: true }) },
        ],
        steps: [
          () => ({
            method: "POST",
            url: "/api/events",
            body: {
              title: intent.title,
              startAt: intent.start.toISOString(),
              endAt: intent.end.toISOString(),
              allDay: false,
              reminderOffsets: [0],
              allowOverlap: true,
            },
          }),
        ],
      };
    }

    case "INSTALLMENT_PLAN": {
      if (intent.installmentAmount < 1) return unresolved("طرح قسط جدید", "مبلغ هر قسط از یک تومان کمتر می‌شود.");
      return {
        title: "طرح قسط جدید",
        details: [
          { label: "عنوان", text: intent.title },
          { label: "تعداد اقساط", text: toPersianDigits(intent.count) },
          { label: "هر قسط", money: intent.installmentAmount },
          { label: "مجموع", money: intent.totalAmount },
          { label: "سررسید", text: `روز ${toPersianDigits(intent.dueDay)} هر ماه` },
        ],
        steps: [
          () => ({
            method: "POST",
            url: "/api/installment-plans",
            body: {
              title: intent.title,
              totalAmount: intent.totalAmount,
              installmentAmount: intent.installmentAmount,
              numberOfInstallments: intent.count,
              dueDay: intent.dueDay,
            },
          }),
        ],
      };
    }

    case "INSTALLMENT_PAY": {
      const open = snapshot.plans.filter((p) => p.installments.some((i) => i.status !== "PAID"));
      const plan = intent.planHint ? bestMatch(intent.planHint, open, (p) => p.title) : open.length === 1 ? open[0] : null;
      if (!plan) {
        return unresolved(
          "پرداخت قسط",
          intent.planHint ? `طرح قسطی با نام «${intent.planHint}» که قسط پرداخت‌نشده داشته باشد پیدا نشد.` : "برای کدام طرح قسط؟ نام آن را هم بنویس."
        );
      }
      const next = [...plan.installments].filter((i) => i.status !== "PAID").sort((a, b) => a.index - b.index)[0];
      const account = defaultAccount(snapshot.accounts);
      const pay = (accountId: (previous: unknown[]) => string): CaptureStep => (previous) => ({
        method: "POST",
        url: `/api/installments/${next.id}/pay`,
        body: { accountId: accountId(previous) },
      });
      return {
        title: "پرداخت قسط",
        details: [
          { label: "طرح", text: plan.title },
          { label: "قسط", text: `${toPersianDigits(next.index)} از ${toPersianDigits(plan.installments.length)}` },
          { label: "مبلغ", money: next.amount },
          { label: "از حساب", text: account?.name ?? "صندوق" },
        ],
        steps: account ? [pay(() => account.id)] : [CREATE_DEFAULT_ACCOUNT, pay((previous) => createdAccountId(previous[0]))],
      };
    }

    case "HABIT_CHECKIN": {
      const habits = snapshot.habits.filter((h) => h.isActive !== false);
      const habit = bestMatch(intent.habitHint, habits, (h) => h.title);
      if (!habit) return unresolved("ثبت عادت", `عادتی با نام «${intent.habitHint}» پیدا نشد.`);
      const details: CaptureDetail[] = [{ label: "عادت", text: habit.title }];
      if (habit.checkedInToday) return { title: "ثبت عادت", details, steps: [], alreadyDone: "امروز قبلاً برایش ثبت شده است." };
      return {
        title: "ثبت عادت",
        details,
        steps: [() => ({ method: "POST", url: `/api/habits/${habit.id}/checkin`, body: { date: intent.date.toISOString() } })],
      };
    }

    case "HABIT_CREATE": {
      const same = snapshot.habits.find((h) => looseName(h.title) === looseName(intent.title));
      if (same) return { title: "عادت جدید", details: [{ label: "عادت", text: same.title }], steps: [], alreadyDone: "این عادت از قبل هست." };
      return {
        title: "عادت جدید",
        details: [{ label: "عادت", text: intent.title }],
        steps: [() => ({ method: "POST", url: "/api/habits", body: { title: intent.title } })],
      };
    }

    case "NOTE":
      return {
        title: "یادداشت",
        details: [{ label: "متن", text: intent.content }],
        steps: [() => ({ method: "POST", url: "/api/notes", body: { day: intent.day, content: intent.content } })],
      };

    case "SAVINGS_GOAL": {
      const account = defaultAccount(snapshot.accounts);
      const create = (accountId: (previous: unknown[]) => string): CaptureStep => (previous) => ({
        method: "POST",
        url: "/api/savings-goals",
        body: { title: intent.title, targetAmount: intent.targetAmount, accountId: accountId(previous) },
      });
      return {
        title: "هدف پس‌انداز",
        details: [
          { label: "هدف", text: intent.title },
          { label: "مبلغ", money: intent.targetAmount },
          { label: "حساب", text: account?.name ?? "صندوق" },
        ],
        steps: account ? [create(() => account.id)] : [CREATE_DEFAULT_ACCOUNT, create((previous) => createdAccountId(previous[0]))],
      };
    }

    case "PROJECT_CREATE": {
      const same = snapshot.categories.find((c) => c.projectId && looseName(c.name) === looseName(intent.name));
      if (same) return { title: "پروژه جدید", details: [{ label: "پروژه", text: same.name }], steps: [], alreadyDone: "این پروژه از قبل هست." };
      return {
        title: "پروژه جدید",
        details: [{ label: "پروژه", text: intent.name }],
        steps: [() => ({ method: "POST", url: "/api/projects", body: { name: intent.name } })],
      };
    }

    case "BUDGET": {
      const category = bestMatch(intent.categoryHint, snapshot.categories.filter((c) => c.isActive && !c.projectId), (c) => c.name);
      if (!category) return unresolved("بودجه ماهانه", `دسته‌ای با نام «${intent.categoryHint}» پیدا نشد.`);
      return {
        title: "بودجه ماهانه",
        details: [
          { label: "دسته", text: category.name },
          { label: "سقف ماهانه", money: intent.monthlyCap },
        ],
        steps: [() => ({ method: "POST", url: "/api/budgets", body: { categoryId: category.id, monthlyCap: intent.monthlyCap } })],
      };
    }
  }
}
