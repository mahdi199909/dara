import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("./apiClient", () => ({
  fetcher: vi.fn(),
  apiPost: vi.fn(),
}));
vi.mock("./remoteAuth", () => ({
  remoteLogin: vi.fn(),
  remoteRegister: vi.fn(),
  fetchRemoteLicenseStatus: vi.fn(),
}));

import { fetcher, apiPost } from "./apiClient";
import { remoteLogin, remoteRegister, fetchRemoteLicenseStatus } from "./remoteAuth";
import { completeFirstRun, getCachedLicense, refreshLicenseStatus } from "./nativeOnboarding";

describe("nativeOnboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getCachedLicense reads through the local dispatcher path (fetcher)", async () => {
    vi.mocked(fetcher).mockResolvedValue({ license: { status: "TRIAL" } });
    const license = await getCachedLicense();
    expect(fetcher).toHaveBeenCalledWith("/api/local/license-cache");
    expect(license).toEqual({ status: "TRIAL" });
  });

  it("completeFirstRun logs in, fetches remote license status, and caches it locally in that order", async () => {
    const calls: string[] = [];
    vi.mocked(remoteLogin).mockImplementation(async () => {
      calls.push("login");
      return { user: { id: "user_1", name: "Ali", email: "a@example.com" }, token: "jwt-1" };
    });
    vi.mocked(fetchRemoteLicenseStatus).mockImplementation(async () => {
      calls.push("status");
      return { status: "TRIAL", trialDaysRemaining: 30, trialEndsAt: "2026-09-24T00:00:00.000Z", currentPeriodEnd: null };
    });
    vi.mocked(apiPost).mockImplementation(async (..._args: any[]) => {
      calls.push("cache");
      return { license: { status: "TRIAL" } };
    });

    const result = await completeFirstRun({ mode: "login", email: "a@example.com", password: "secret" });

    expect(calls).toEqual(["login", "status", "cache"]);
    expect(remoteLogin).toHaveBeenCalledWith("a@example.com", "secret");
    expect(fetchRemoteLicenseStatus).toHaveBeenCalledWith("jwt-1");
    expect(remoteRegister).not.toHaveBeenCalled();
    expect(apiPost).toHaveBeenCalledWith("/api/local/license-cache", {
      status: "TRIAL",
      trialDaysRemaining: 30,
      trialEndsAt: "2026-09-24T00:00:00.000Z",
      currentPeriodEnd: null,
      remoteUserId: "user_1",
      remoteEmail: "a@example.com",
      token: "jwt-1",
    });
    expect(result).toEqual({ status: "TRIAL" });
  });

  it("completeFirstRun calls remoteRegister instead of remoteLogin when mode is 'register'", async () => {
    vi.mocked(remoteRegister).mockResolvedValue({ user: { id: "user_2", name: "Sara", email: "s@example.com" }, token: "jwt-2" });
    vi.mocked(fetchRemoteLicenseStatus).mockResolvedValue({ status: "TRIAL", trialDaysRemaining: 30, trialEndsAt: null, currentPeriodEnd: null });
    vi.mocked(apiPost).mockResolvedValue({ license: { status: "TRIAL" } });

    await completeFirstRun({ mode: "register", name: "Sara", email: "s@example.com", password: "secret123" });

    expect(remoteRegister).toHaveBeenCalledWith("Sara", "s@example.com", "secret123");
    expect(remoteLogin).not.toHaveBeenCalled();
  });

  it("propagates an error from remoteLogin without calling the license-status or cache steps", async () => {
    vi.mocked(remoteLogin).mockRejectedValue(new Error("ایمیل یا رمز عبور اشتباه است."));

    await expect(completeFirstRun({ mode: "login", email: "a@example.com", password: "wrong" })).rejects.toThrow("ایمیل یا رمز عبور اشتباه است.");
    expect(fetchRemoteLicenseStatus).not.toHaveBeenCalled();
    expect(apiPost).not.toHaveBeenCalled();
  });

  describe("refreshLicenseStatus", () => {
    it("does nothing if there's no cached license yet", async () => {
      vi.mocked(fetcher).mockResolvedValue({ license: null });
      await refreshLicenseStatus();
      expect(fetchRemoteLicenseStatus).not.toHaveBeenCalled();
      expect(apiPost).not.toHaveBeenCalled();
    });

    it("does nothing if the cached license has no stored token", async () => {
      vi.mocked(fetcher).mockResolvedValue({ license: { status: "TRIAL", remoteUserId: "user_1", remoteEmail: "a@example.com", token: null } });
      await refreshLicenseStatus();
      expect(fetchRemoteLicenseStatus).not.toHaveBeenCalled();
      expect(apiPost).not.toHaveBeenCalled();
    });

    it("re-fetches with the stored token and re-caches the fresh status, keeping the same token", async () => {
      vi.mocked(fetcher).mockResolvedValue({
        license: { status: "TRIAL", trialDaysRemaining: 5, remoteUserId: "user_1", remoteEmail: "a@example.com", token: "jwt-1" },
      });
      vi.mocked(fetchRemoteLicenseStatus).mockResolvedValue({
        status: "TRIAL",
        trialDaysRemaining: 4,
        trialEndsAt: "2026-09-24T00:00:00.000Z",
        currentPeriodEnd: null,
      });

      await refreshLicenseStatus();

      expect(fetchRemoteLicenseStatus).toHaveBeenCalledWith("jwt-1");
      expect(apiPost).toHaveBeenCalledWith("/api/local/license-cache", {
        status: "TRIAL",
        trialDaysRemaining: 4,
        trialEndsAt: "2026-09-24T00:00:00.000Z",
        currentPeriodEnd: null,
        remoteUserId: "user_1",
        remoteEmail: "a@example.com",
        token: "jwt-1",
      });
    });

    it("silently keeps the stale cache if the server re-check fails (offline, expired token, etc.)", async () => {
      vi.mocked(fetcher).mockResolvedValue({
        license: { status: "TRIAL", remoteUserId: "user_1", remoteEmail: "a@example.com", token: "jwt-1" },
      });
      vi.mocked(fetchRemoteLicenseStatus).mockRejectedValue(new Error("network error"));

      await expect(refreshLicenseStatus()).resolves.toBeUndefined();
      expect(apiPost).not.toHaveBeenCalled();
    });
  });
});
