// The optional «حالت‌ها» (modes) a person switches on to bring in a part of the app that most people do not need:
// the athlete's calorie meter, and the two ways of planning a day — time blocking and time boxing. They are kept in
// Settings.modes (comma separated, synced with the account like the other preferences) and decide which entries the
// «بیشتر» menu shows. The monthly cycle is not one of these: its data stays on the device, so its switch does too
// (see src/lib/cycleStore.ts) — it only needs the gender the person chose in Settings.gender.
//
// Pure, so the settings screen, the menu and the tests share one definition.

export const MODES = ["athlete", "timeBlocking", "timeBoxing"] as const;
export type Mode = (typeof MODES)[number];

export const MODE_INFO: Record<Mode, { label: string; hint: string }> = {
  athlete: {
    label: "ورزشکار",
    hint: "کالری‌شمار وعده‌ها با هدف روزانه. فقط روی همین دستگاه می‌ماند و به سرور نمی‌رود.",
  },
  timeBlocking: {
    label: "تایم‌بلاکینگ",
    hint: "روزت را به بلوک‌های زمانی تقسیم می‌کنی و کارها را روی خط زمانی می‌چینی.",
  },
  timeBoxing: {
    label: "تایم‌باکسینگ",
    hint: "برای هر کار یک «جعبهٔ زمانی» می‌گذاری و با شمارش معکوس همان‌قدر رویش کار می‌کنی.",
  },
};

export const GENDERS = ["FEMALE", "MALE"] as const;
export type Gender = (typeof GENDERS)[number];
export const GENDER_LABELS: Record<Gender, string> = { FEMALE: "زن", MALE: "مرد" };

/** The device-only switch of the monthly cycle section (see src/lib/cycleStore.ts). */
export const CYCLE_ENABLED_KEY = "parva.cycle.enabled.v1";

export function isMode(value: unknown): value is Mode {
  return typeof value === "string" && (MODES as readonly string[]).includes(value);
}

export function isGender(value: unknown): value is Gender {
  return typeof value === "string" && (GENDERS as readonly string[]).includes(value);
}

/** "athlete,timeBoxing" → the modes it names, in the order of MODES; a word that is not a mode is dropped, and so is a repeat. */
export function parseModes(text: string | null | undefined): Mode[] {
  const wanted = new Set((text ?? "").split(",").map((word) => word.trim()));
  return MODES.filter((mode) => wanted.has(mode));
}

/** What is stored: the words joined by commas in the order of MODES, or null for none. */
export function serializeModes(modes: readonly Mode[]): string | null {
  const wanted = new Set(modes);
  const words = MODES.filter((mode) => wanted.has(mode));
  return words.length > 0 ? words.join(",") : null;
}

/** Whether every word of the text is a mode — what the settings route accepts. An empty text is fine (no modes). */
export function isModesText(text: string): boolean {
  return text
    .split(",")
    .map((word) => word.trim())
    .filter((word) => word !== "")
    .every(isMode);
}

export function withMode(modes: readonly Mode[], mode: Mode, on: boolean): Mode[] {
  const wanted = new Set(modes);
  if (on) wanted.add(mode);
  else wanted.delete(mode);
  return MODES.filter((m) => wanted.has(m));
}

/** What decides which entries of the «بیشتر» menu show. */
export interface ModeState {
  modes: readonly Mode[];
  /** Settings.gender; null when the person has not said. */
  gender: Gender | null;
  /** The device-only switch of the monthly cycle section. */
  cycleOn: boolean;
}

export const NO_MODES: ModeState = { modes: [], gender: null, cycleOn: false };

/** The monthly cycle is offered only to someone who chose «زن» in Settings and switched the section on, on this device. */
export function cycleAvailable(state: Pick<ModeState, "gender" | "cycleOn">): boolean {
  return state.gender === "FEMALE" && state.cycleOn;
}

export type NavMode = Mode | "cycle";

/** A menu entry's own condition: with none it always shows; with several, any one of them is enough. */
export function navItemVisible(requires: readonly NavMode[] | undefined, state: ModeState): boolean {
  if (!requires || requires.length === 0) return true;
  return requires.some((need) => (need === "cycle" ? cycleAvailable(state) : state.modes.includes(need)));
}
