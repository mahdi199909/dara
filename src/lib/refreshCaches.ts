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
