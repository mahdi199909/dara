import useSWR from "swr";
import { fetcher } from "./apiClient";

export function useCategories() {
  const { data, error, isLoading, mutate } = useSWR<{ categories: any[] }>("/api/categories", fetcher);
  return { categories: data?.categories ?? [], error, isLoading, mutate };
}

export function useProjects() {
  const { data, error, isLoading, mutate } = useSWR<{ projects: any[] }>("/api/projects", fetcher);
  return { projects: data?.projects ?? [], error, isLoading, mutate };
}

export function useAccounts() {
  const { data, error, isLoading, mutate } = useSWR<{ accounts: any[] }>("/api/accounts", fetcher);
  return { accounts: data?.accounts ?? [], error, isLoading, mutate };
}

export function useDashboard() {
  const { data, error, isLoading, mutate } = useSWR<any>("/api/dashboard", fetcher, {
    refreshInterval: 60000,
  });
  return { data, error, isLoading, mutate };
}

export function useNotifications() {
  const { data, error, mutate } = useSWR<{ notifications: any[] }>("/api/notifications", fetcher, {
    refreshInterval: 30000,
  });
  return { notifications: data?.notifications ?? [], error, mutate };
}

export function useHabits() {
  const { data, error, isLoading, mutate } = useSWR<{ habits: any[]; series: any[]; currentStreak: number }>(
    "/api/habits",
    fetcher
  );
  return {
    habits: data?.habits ?? [],
    series: data?.series ?? [],
    currentStreak: data?.currentStreak ?? 0,
    error,
    isLoading,
    mutate,
  };
}
