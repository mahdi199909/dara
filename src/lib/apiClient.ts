export class ApiClientError extends Error {
  status: number;
  details?: unknown;
  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = "خطایی رخ داد. دوباره تلاش کنید.";
    let details: unknown;
    try {
      const body = await res.json();
      message = body.error ?? message;
      details = body.details;
    } catch {
      // ignore non-JSON error bodies
    }
    throw new ApiClientError(message, res.status, details);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// True only inside the Capacitor Android shell (Phase 6) — false in the browser/dev-server
// path, including this very repo's own `next dev`/Railway deployment, so every existing web
// behavior is completely unchanged until that shell actually exists.
function isNativePlatform(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());
}

async function handleLocal<T>(method: string, url: string, body?: unknown): Promise<T> {
  const { dispatchLocal } = await import("./localDispatcher");
  const { status, json } = dispatchLocal(method, url, body);
  if (status >= 400) {
    const err = json as { error?: string; details?: unknown };
    throw new ApiClientError(err.error ?? "خطایی رخ داد. دوباره تلاش کنید.", status, err.details);
  }
  return json as T;
}

export const fetcher = <T = unknown>(url: string): Promise<T> =>
  isNativePlatform() ? handleLocal<T>("GET", url) : fetch(url).then((res) => handle<T>(res));

export function apiPost<T = unknown>(url: string, body?: unknown): Promise<T> {
  if (isNativePlatform()) return handleLocal<T>("POST", url, body);
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }).then((res) => handle<T>(res));
}

export function apiPatch<T = unknown>(url: string, body?: unknown): Promise<T> {
  if (isNativePlatform()) return handleLocal<T>("PATCH", url, body);
  return fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }).then((res) => handle<T>(res));
}

export function apiDelete<T = unknown>(url: string): Promise<T> {
  if (isNativePlatform()) return handleLocal<T>("DELETE", url);
  return fetch(url, { method: "DELETE" }).then((res) => handle<T>(res));
}
