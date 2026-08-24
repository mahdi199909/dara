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

export const fetcher = <T = unknown>(url: string): Promise<T> => fetch(url).then((res) => handle<T>(res));

export function apiPost<T = unknown>(url: string, body?: unknown): Promise<T> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }).then((res) => handle<T>(res));
}

export function apiPatch<T = unknown>(url: string, body?: unknown): Promise<T> {
  return fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }).then((res) => handle<T>(res));
}

export function apiDelete<T = unknown>(url: string): Promise<T> {
  return fetch(url, { method: "DELETE" }).then((res) => handle<T>(res));
}
