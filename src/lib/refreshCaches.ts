import { mutate } from "swr";

/** Re-fetches everything a saved, edited or deleted task/event/entry can change on screen. */
export function refreshAllCaches() {
  mutate("/api/dashboard");
  mutate("/api/tasks");
  mutate((key) => typeof key === "string" && key.startsWith("/api/events"));
  mutate((key) => typeof key === "string" && key.startsWith("/api/reports"));
  mutate((key) => typeof key === "string" && key.startsWith("/api/transactions"));
  mutate((key) => typeof key === "string" && key.startsWith("/api/day-activity"));
  mutate((key) => typeof key === "string" && key.startsWith("/api/calendar"));
  mutate("/api/accounts");
  mutate((key) => typeof key === "string" && key.startsWith("/api/virtual-assets"));
  mutate("/api/day-battery");
  mutate("/api/capital");
}

/** Everything a typed capture line can create or change — the entries above, and the rest of what a line can be. */
export function refreshCaptureCaches() {
  refreshAllCaches();
  for (const prefix of ["/api/habits", "/api/installment-plans", "/api/notes", "/api/savings-goals", "/api/budgets", "/api/projects", "/api/categories"]) {
    mutate((key) => typeof key === "string" && key.startsWith(prefix));
  }
}
