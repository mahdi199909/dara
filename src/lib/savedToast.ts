// A tiny same-tab pub/sub for "this actually landed in the database" feedback — deliberately not
// SWR-based (see UpgradeToast.tsx for that pattern): this needs to fire the instant a specific
// write succeeds, not whenever some polled/mutated endpoint next happens to resolve, so a plain
// CustomEvent is the more direct fit. See src/components/SavedToast.tsx for the listener.
const EVENT_NAME = "parva:saved";

export function notifySaved(message = "ذخیره شد"): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<string>(EVENT_NAME, { detail: message }));
}

export function subscribeSaved(handler: (message: string) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (e: Event) => handler((e as CustomEvent<string>).detail);
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}
