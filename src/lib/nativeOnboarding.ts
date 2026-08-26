// Orchestrates the Android app's one-time first-run flow — see src/components/native/FirstRunGate.tsx
// (the only intended caller). Checks the local license cache; if none exists, logs in/registers
// against the real remote deployment (src/lib/remoteAuth.ts), fetches license status, and caches
// it locally via the ordinary local-dispatcher path (src/lib/apiClient.ts already routes these
// two calls through dispatchLocal on native, same as every other resource).
import { fetcher, apiPost } from "./apiClient";
import { remoteLogin, remoteRegister, fetchRemoteLicenseStatus } from "./remoteAuth";
import type { LicenseCache } from "@/local/repositories/licenseCache";

export async function getCachedLicense(): Promise<LicenseCache | null> {
  const { license } = await fetcher<{ license: LicenseCache | null }>("/api/local/license-cache");
  return license;
}

export interface FirstRunInput {
  mode: "login" | "register";
  name?: string;
  email: string;
  password: string;
}

export async function completeFirstRun(input: FirstRunInput): Promise<LicenseCache> {
  const { user, token } =
    input.mode === "register" ? await remoteRegister(input.name ?? "", input.email, input.password) : await remoteLogin(input.email, input.password);

  const status = await fetchRemoteLicenseStatus(token);

  const { license } = await apiPost<{ license: LicenseCache }>("/api/local/license-cache", {
    status: status.status,
    trialDaysRemaining: status.trialDaysRemaining,
    trialEndsAt: status.trialEndsAt,
    currentPeriodEnd: status.currentPeriodEnd,
    remoteUserId: user.id,
    remoteEmail: user.email,
  });

  return license;
}
