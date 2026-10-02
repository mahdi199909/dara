// Planning a checklist onto the calendar — the simplest useful form of project scheduling.
//
// A "step" is an item with a duration and no sub-items. Each step either names another item of the
// same list it follows, or simply comes after the step before it in the list:
//   AFTER x  — starts when x ends            (finish → start)
//   BEFORE x — ends when x starts             (it must be done before x)
//   WITH x   — starts when x starts           (start → start)
// plus an optional gap (lag) in minutes. x may be a group (an item with sub-items): it then spans from
// the first of its steps to start until the last one ends.
//
// plan() works out every step's start and end from a chosen start moment, optionally keeping steps
// inside working hours (Fridays skipped), and lets the person pin a step to a time of their own — the
// steps that depend on it then move with it. Items that cannot be placed (a circle of dependencies)
// are reported, not guessed. Shared by the checklist screen's «زمان‌بندی» tab and its calendar preview.

export type DepType = "AFTER" | "BEFORE" | "WITH";
export const DEP_TYPES: readonly DepType[] = ["AFTER", "BEFORE", "WITH"];
export const DEP_LABELS: Record<DepType, string> = { AFTER: "بعد از", BEFORE: "قبل از", WITH: "هم‌زمان با شروع" };

export interface PlanItem {
  id: string;
  parentId: string | null;
  title: string;
  sortOrder: number;
  createdAt: string | Date;
  checked: boolean;
  durationMin: number | null;
  depType: DepType | string | null;
  depItemId: string | null;
  lagMin: number;
}

export interface WorkHours {
  startHour: number;
  endHour: number;
  /** Skip Fridays (the Iranian weekend). */
  skipFriday: boolean;
}

export const DEFAULT_WORK_HOURS: WorkHours = { startHour: 9, endHour: 17, skipFriday: true };

export interface PlanOptions {
  start: Date;
  workHours?: WorkHours | null;
  /** Steps the person moved by hand in the preview: they start exactly here. */
  pinned?: Record<string, Date>;
  /** Ticked steps are already done and are left out unless this is true. */
  includeChecked?: boolean;
}

export interface PlannedStep {
  id: string;
  title: string;
  /** The titles of the groups the step sits in, outermost first (without the list itself). */
  path: string[];
  start: Date;
  end: Date;
  durationMin: number;
  /** "بعد از «گرفتن سالن»" — the rule that placed it, or null when it just follows the step before. */
  rule: string | null;
  pinned: boolean;
}

export interface PlanResult {
  steps: PlannedStep[];
  /** Steps that could not be placed, with the reason. */
  problems: { id: string; title: string; message: string }[];
  /** Items under the list with no duration — not planned, listed so the person can give them one. */
  unscheduled: { id: string; title: string }[];
  start: Date | null;
  end: Date | null;
}

const MIN = 60_000;

function time(v: string | Date): number {
  return typeof v === "string" ? new Date(v).getTime() : v.getTime();
}

function orderedChildren(items: PlanItem[]): Map<string | null, PlanItem[]> {
  const byParent = new Map<string | null, PlanItem[]>();
  for (const item of items) {
    const list = byParent.get(item.parentId) ?? [];
    list.push(item);
    byParent.set(item.parentId, list);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.sortOrder - b.sortOrder || time(a.createdAt) - time(b.createdAt) || a.id.localeCompare(b.id));
  return byParent;
}

/** Everything under `rootId`, in list order (depth first), with each item's group path. */
function walk(items: PlanItem[], rootId: string): { item: PlanItem; path: string[]; hasChildren: boolean }[] {
  const byParent = orderedChildren(items);
  const out: { item: PlanItem; path: string[]; hasChildren: boolean }[] = [];
  const seen = new Set<string>([rootId]);
  const visit = (parent: string, path: string[]) => {
    for (const child of byParent.get(parent) ?? []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      const kids = byParent.get(child.id) ?? [];
      out.push({ item: child, path, hasChildren: kids.length > 0 });
      if (kids.length > 0) visit(child.id, [...path, child.title]);
    }
  };
  visit(rootId, []);
  return out;
}

export function lagLabel(lagMin: number): string {
  if (!lagMin) return "";
  const fa = (n: number) => String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
  if (lagMin % (7 * 24 * 60) === 0) return `${fa(lagMin / (7 * 24 * 60))} هفته`;
  if (lagMin % (24 * 60) === 0) return `${fa(lagMin / (24 * 60))} روز`;
  if (lagMin % 60 === 0) return `${fa(lagMin / 60)} ساعت`;
  return `${fa(lagMin)} دقیقه`;
}

/**
 * The rule as a person would say it: «بعد از «گرفتن سالن»», «۲ روز بعد از «گرفتن سالن»»,
 * «۳ ساعت قبل از «سفر»», «هم‌زمان با شروع «برگزاری»», «۲ ساعت بعد از شروع «برگزاری»».
 */
export function describeRule(depType: string | null, targetTitle: string | null, lagMin: number): string | null {
  if (!depType || !targetTitle || !(DEP_TYPES as readonly string[]).includes(depType)) return null;
  const target = `«${targetTitle}»`;
  if (!lagMin) return `${DEP_LABELS[depType as DepType]} ${target}`;
  const lag = lagLabel(lagMin);
  if (depType === "BEFORE") return `${lag} قبل از ${target}`;
  if (depType === "WITH") return `${lag} بعد از شروع ${target}`;
  return `${lag} بعد از ${target}`;
}

// --- working hours ----------------------------------------------------------------------------

function atHour(d: Date, hour: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, 0, 0, 0);
}

function isOff(d: Date, wh: WorkHours): boolean {
  return wh.skipFriday && d.getDay() === 5;
}

/** The first moment at or after `start` where `durationMin` fits inside a working day. */
export function snapForward(start: Date, durationMin: number, wh: WorkHours): Date {
  const windowMin = (wh.endHour - wh.startHour) * 60;
  let s = new Date(start);
  for (let i = 0; i < 400; i++) {
    if (isOff(s, wh)) {
      s = atHour(new Date(s.getFullYear(), s.getMonth(), s.getDate() + 1), wh.startHour);
      continue;
    }
    const open = atHour(s, wh.startHour);
    const close = atHour(s, wh.endHour);
    if (s < open) s = open;
    // A step longer than a whole working day starts at the beginning of one and runs over.
    if (s.getTime() + durationMin * MIN <= close.getTime() || (durationMin > windowMin && s.getTime() === open.getTime())) return s;
    s = atHour(new Date(s.getFullYear(), s.getMonth(), s.getDate() + 1), wh.startHour);
  }
  return s;
}

/** The latest end at or before `end` such that the whole step lies inside a working day. */
export function snapBackward(end: Date, durationMin: number, wh: WorkHours): Date {
  const windowMin = (wh.endHour - wh.startHour) * 60;
  let e = new Date(end);
  for (let i = 0; i < 400; i++) {
    if (isOff(e, wh)) {
      e = atHour(new Date(e.getFullYear(), e.getMonth(), e.getDate() - 1), wh.endHour);
      continue;
    }
    const open = atHour(e, wh.startHour);
    const close = atHour(e, wh.endHour);
    if (e > close) e = close;
    if (e.getTime() - durationMin * MIN >= open.getTime() || (durationMin > windowMin && e.getTime() === close.getTime())) return e;
    e = atHour(new Date(e.getFullYear(), e.getMonth(), e.getDate() - 1), wh.endHour);
  }
  return e;
}

// --- planning ---------------------------------------------------------------------------------

export function planChecklist(items: PlanItem[], rootId: string, options: PlanOptions): PlanResult {
  const all = walk(items, rootId);
  const byId = new Map(all.map((w) => [w.item.id, w]));
  const isStep = (w: { item: PlanItem; hasChildren: boolean }) => !w.hasChildren && (w.item.durationMin ?? 0) > 0 && (options.includeChecked || !w.item.checked);
  const steps = all.filter(isStep);
  const stepIds = new Set(steps.map((s) => s.item.id));
  const unscheduled = all.filter((w) => !w.hasChildren && !(w.item.durationMin && w.item.durationMin > 0) && (options.includeChecked || !w.item.checked)).map((w) => ({ id: w.item.id, title: w.item.title }));

  // The steps under a group (or the step itself).
  const descendantsCache = new Map<string, string[]>();
  const stepsUnder = (id: string): string[] => {
    if (descendantsCache.has(id)) return descendantsCache.get(id)!;
    if (stepIds.has(id)) return [id];
    const byParent = orderedChildren(items);
    const out: string[] = [];
    const stack = [id];
    const seen = new Set<string>();
    while (stack.length) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const child of byParent.get(cur) ?? []) {
        if (stepIds.has(child.id)) out.push(child.id);
        stack.push(child.id);
      }
    }
    descendantsCache.set(id, out);
    return out;
  };

  /** A usable explicit rule: a known type pointing at another item of this list that has steps to time against. */
  const ownTarget = (item: PlanItem): string | null => {
    if (!item.depType || !item.depItemId || !(DEP_TYPES as readonly string[]).includes(item.depType)) return null;
    if (item.depItemId === item.id || !byId.has(item.depItemId)) return null;
    if (stepsUnder(item.depItemId).includes(item.id) || stepsUnder(item.id).includes(item.depItemId)) return null;
    return stepsUnder(item.depItemId).length > 0 ? item.depItemId : null;
  };

  /**
   * The rule a step follows: its own, or — when it is the first step of a group that has a rule
   * («سخنران‌ها بعد از گرفتن سالن») — that group's. The rest of the group then follows on as usual.
   */
  const ruleOf = (item: PlanItem): PlanItem | null => {
    if (ownTarget(item)) return item;
    for (let p = item.parentId; p && p !== rootId; p = byId.get(p)?.item.parentId ?? null) {
      const group = byId.get(p)?.item;
      if (!group) break;
      if (stepsUnder(group.id)[0] !== item.id) break;
      if (ownTarget(group)) return group;
    }
    return null;
  };
  const explicitTarget = (item: PlanItem): string | null => {
    const holder = ruleOf(item);
    return holder ? ownTarget(holder) : null;
  };

  // Does `a` (through its explicit rules) end up waiting on `b`? Used so the "after the previous step"
  // default never creates a circle with a rule the person set.
  const dependsOn = (a: string, b: string, seen = new Set<string>()): boolean => {
    if (seen.has(a)) return false;
    seen.add(a);
    const target = explicitTarget(byId.get(a)!.item);
    if (!target) return false;
    const under = stepsUnder(target);
    return under.includes(b) || under.some((s) => dependsOn(s, b, seen));
  };

  // Each step's reference: an explicit rule, or "after the nearest earlier step that is not waiting on it".
  type Ref = { kind: "START" } | { kind: "RULE"; type: DepType; target: string; lag: number } | { kind: "PREV"; target: string };
  const refs = new Map<string, Ref>();
  steps.forEach((s, index) => {
    const holder = ruleOf(s.item);
    const target = holder ? ownTarget(holder) : null;
    if (holder && target) {
      refs.set(s.item.id, { kind: "RULE", type: holder.depType as DepType, target, lag: Math.max(0, holder.lagMin || 0) });
      return;
    }
    for (let j = index - 1; j >= 0; j--) {
      const prev = steps[j].item.id;
      if (!dependsOn(prev, s.item.id)) {
        refs.set(s.item.id, { kind: "PREV", target: prev });
        return;
      }
    }
    refs.set(s.item.id, { kind: "START" });
  });

  const placed = new Map<string, { start: Date; end: Date }>();
  const span = (id: string): { start: Date; end: Date } | null => {
    const under = stepsUnder(id);
    if (under.length === 0 || under.some((s) => !placed.has(s))) return null;
    const times = under.map((s) => placed.get(s)!);
    return { start: new Date(Math.min(...times.map((t) => t.start.getTime()))), end: new Date(Math.max(...times.map((t) => t.end.getTime()))) };
  };

  const wh = options.workHours ?? null;
  let progress = true;
  while (progress) {
    progress = false;
    for (const s of steps) {
      const id = s.item.id;
      if (placed.has(id)) continue;
      const dur = s.item.durationMin!;
      const pin = options.pinned?.[id];
      if (pin) {
        placed.set(id, { start: new Date(pin), end: new Date(pin.getTime() + dur * MIN) });
        progress = true;
        continue;
      }
      const ref = refs.get(id)!;
      let start: Date;
      if (ref.kind === "START") {
        start = wh ? snapForward(options.start, dur, wh) : new Date(options.start);
      } else {
        const t = span(ref.target);
        if (!t) continue;
        if (ref.kind === "PREV") {
          start = wh ? snapForward(t.end, dur, wh) : t.end;
        } else if (ref.type === "AFTER") {
          const s0 = new Date(t.end.getTime() + ref.lag * MIN);
          start = wh ? snapForward(s0, dur, wh) : s0;
        } else if (ref.type === "WITH") {
          const s0 = new Date(t.start.getTime() + ref.lag * MIN);
          start = wh ? snapForward(s0, dur, wh) : s0;
        } else {
          const e0 = new Date(t.start.getTime() - ref.lag * MIN);
          const end = wh ? snapBackward(e0, dur, wh) : e0;
          start = new Date(end.getTime() - dur * MIN);
        }
      }
      placed.set(id, { start, end: new Date(start.getTime() + dur * MIN) });
      progress = true;
    }
  }

  const titleOf = (id: string) => byId.get(id)?.item.title ?? "";
  const problems = steps
    .filter((s) => !placed.has(s.item.id))
    .map((s) => ({ id: s.item.id, title: s.item.title, message: "ترتیبش دور می‌زند: این مورد (مستقیم یا غیرمستقیم) به خودش وابسته است." }));

  const planned: PlannedStep[] = steps
    .filter((s) => placed.has(s.item.id))
    .map((s) => {
      const ref = refs.get(s.item.id)!;
      const t = placed.get(s.item.id)!;
      return {
        id: s.item.id,
        title: s.item.title,
        path: s.path,
        start: t.start,
        end: t.end,
        durationMin: s.item.durationMin!,
        rule: ref.kind === "RULE" ? describeRule(ref.type, titleOf(ref.target), ref.lag) : null,
        pinned: Boolean(options.pinned?.[s.item.id]),
      };
    })
    .sort((a, b) => a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime());

  return {
    steps: planned,
    problems,
    unscheduled,
    start: planned.length ? planned[0].start : null,
    end: planned.length ? new Date(Math.max(...planned.map((p) => p.end.getTime()))) : null,
  };
}

/** Items a rule may point at: every other item of the same list, except the item's own sub-items. */
export function dependencyCandidates<T extends { id: string; parentId: string | null; title: string }>(items: T[], rootId: string, itemId: string): T[] {
  const byParent = new Map<string | null, T[]>();
  for (const i of items) byParent.set(i.parentId, [...(byParent.get(i.parentId) ?? []), i]);
  const under = (id: string): Set<string> => {
    const out = new Set<string>();
    const stack = [id];
    while (stack.length) for (const c of byParent.get(stack.pop()!) ?? []) if (!out.has(c.id)) out.add(c.id), stack.push(c.id);
    return out;
  };
  const inList = under(rootId);
  const own = under(itemId);
  // Its own groups too: a step waiting on the group it belongs to would be waiting on itself.
  const byId = new Map(items.map((i) => [i.id, i]));
  const ancestors = new Set<string>();
  for (let p = byId.get(itemId)?.parentId ?? null; p && !ancestors.has(p); p = byId.get(p)?.parentId ?? null) ancestors.add(p);
  return items.filter((i) => inList.has(i.id) && i.id !== itemId && !own.has(i.id) && !ancestors.has(i.id));
}
