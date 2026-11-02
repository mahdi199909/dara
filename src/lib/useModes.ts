"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/apiClient";
import { useDeviceJson } from "@/lib/deviceStore";
import { CYCLE_ENABLED_KEY, isGender, parseModes, type ModeState } from "@/lib/modes";

/**
 * Which modes are on for this person: the ones kept with the account (Settings.modes, Settings.gender — the same
 * "/api/settings" every screen already reads) and the device-only switch of the monthly cycle. "loaded" is false until
 * the settings arrive, so a screen can wait instead of flashing "this mode is off".
 */
export function useModes(): ModeState & { loaded: boolean } {
  const { data } = useSWR<{ settings?: { gender?: string | null; modes?: string | null } }>("/api/settings", fetcher);
  const [cycleOn] = useDeviceJson<boolean>(CYCLE_ENABLED_KEY, false);
  const gender = data?.settings?.gender;
  const modesText = data?.settings?.modes;
  return useMemo(
    () => ({ modes: parseModes(modesText), gender: isGender(gender) ? gender : null, cycleOn: cycleOn === true, loaded: data !== undefined }),
    [modesText, gender, cycleOn, data]
  );
}
