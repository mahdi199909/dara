"use client";

// Owner-only tools with no nav entry anywhere — reachable only by typing /admin. Protected for
// real by requireAdmin() on every API call below; a non-admin who finds the URL just sees every
// action fail with "دسترسی ندارید", nothing sensitive rendered client-side. See src/lib/admin.ts.
import { useState } from "react";
import { apiPatch, ApiClientError } from "@/lib/apiClient";
import { Card } from "@/components/ui/Card";

const STATUS_LABELS: Record<string, string> = {
  FREE: "رایگان",
  TRIAL: "دوره آزمایشی (۳۰ روز از الان)",
  SUBSCRIBED: "مشترک",
  LIFETIME: "مادام‌العمر",
};

interface LicenseInfo {
  status: string;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
}

function LicenseSection() {
  const [email, setEmail] = useState("");
  const [user, setUser] = useState<{ id: string; name: string; email: string } | null>(null);
  const [license, setLicense] = useState<LicenseInfo | null>(null);
  const [status, setStatus] = useState("SUBSCRIBED");
  const [months, setMonths] = useState("1");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    setError(null);
    setMessage(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/license?email=${encodeURIComponent(email)}`);
      const body = await res.json();
      if (!res.ok) throw new ApiClientError(body.error ?? "خطا", res.status);
      setUser(body.user);
      setLicense(body.license);
    } catch (err) {
      setUser(null);
      setLicense(null);
      setError(err instanceof ApiClientError ? err.message : "خطایی رخ داد.");
    } finally {
      setLoading(false);
    }
  }

  async function apply() {
    if (!user) return;
    setError(null);
    setMessage(null);
    setLoading(true);
    try {
      const body: Record<string, unknown> = { email: user.email, status };
      if (status === "SUBSCRIBED") body.months = Number(months);
      const res = await apiPatch<{ license: LicenseInfo }>("/api/admin/license", body);
      setLicense(res.license);
      setMessage("انجام شد.");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "خطایی رخ داد.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="p-5 space-y-4">
      <h2 className="font-bold text-ink text-sm">مدیریت اشتراک کاربر</h2>
      <div className="flex gap-2">
        <input
          type="email"
          dir="ltr"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="ایمیل کاربر"
          className="flex-1 bg-surface rounded-xl border border-line px-3 py-2 text-sm"
        />
        <button onClick={search} disabled={loading || !email} className="bg-canvas text-ink px-4 py-2 rounded-xl text-sm disabled:opacity-40">
          جستجو
        </button>
      </div>

      {error && <p className="text-xs text-waste">{error}</p>}
      {message && <p className="text-xs text-accent">{message}</p>}

      {user && license && (
        <div className="space-y-3 border-t border-line pt-3">
          <p className="text-sm text-ink">
            {user.name} — <span dir="ltr">{user.email}</span>
          </p>
          <p className="text-xs text-muted">
            وضعیت فعلی: {STATUS_LABELS[license.status] ?? license.status}
            {license.currentPeriodEnd && ` — تا ${new Date(license.currentPeriodEnd).toLocaleDateString("fa-IR")}`}
          </p>

          <div className="flex gap-2 items-center">
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="flex-1 bg-surface rounded-xl border border-line px-3 py-2 text-sm">
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            {status === "SUBSCRIBED" && (
              <input
                type="number"
                min={1}
                max={24}
                value={months}
                onChange={(e) => setMonths(e.target.value)}
                className="w-20 bg-surface rounded-xl border border-line px-3 py-2 text-sm text-center"
                placeholder="ماه"
              />
            )}
            <button onClick={apply} disabled={loading} className="bg-accent text-on-accent px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-40">
              اعمال
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

interface ReleaseInfo {
  latestVersionCode: number;
  minSupportedVersionCode: number;
  downloadUrl: string;
}

function ReleaseSection() {
  const [loaded, setLoaded] = useState(false);
  const [latest, setLatest] = useState("");
  const [min, setMin] = useState("");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/release");
      const body = await res.json();
      if (!res.ok) throw new ApiClientError(body.error ?? "خطا", res.status);
      const release: ReleaseInfo = body.release;
      setLatest(String(release.latestVersionCode));
      setMin(String(release.minSupportedVersionCode));
      setUrl(release.downloadUrl);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "خطایی رخ داد.");
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      await apiPatch("/api/admin/release", {
        latestVersionCode: Number(latest),
        minSupportedVersionCode: Number(min),
        downloadUrl: url,
      });
      setMessage("ذخیره شد.");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "خطایی رخ داد.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="p-5 space-y-4">
      <h2 className="font-bold text-ink text-sm">نسخه اپ اندروید و بروزرسانی اجباری</h2>
      <p className="text-xs text-muted leading-relaxed">
        «نسخه فعلی» همون شماره‌ی build گیت‌هاب اکشنه (مثلاً اگه لینک ران #69 رو گرفتید، همون ۶۹ رو بذارید). هر کاربری که
        نسخه‌ی نصب‌شده‌اش کمتر از «حداقل نسخه مجاز» باشه، کلاً نمی‌تونه وارد اپ بشه تا آپدیت کنه؛ بین این عدد و «نسخه فعلی»
        فقط یه پیام غیرمزاحم می‌بینه.
      </p>

      {!loaded ? (
        <button onClick={load} disabled={loading} className="bg-canvas text-ink px-4 py-2 rounded-xl text-sm disabled:opacity-40">
          {loading ? "در حال بارگذاری..." : "بارگذاری تنظیمات فعلی"}
        </button>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-muted mb-1">نسخه فعلی (شماره build)</label>
            <input
              type="number"
              value={latest}
              onChange={(e) => setLatest(e.target.value)}
              className="w-full bg-surface rounded-xl border border-line px-3 py-2 text-sm"
              dir="ltr"
            />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">حداقل نسخه مجاز (پایین‌تر از این = ورود بسته می‌شود)</label>
            <input
              type="number"
              value={min}
              onChange={(e) => setMin(e.target.value)}
              className="w-full bg-surface rounded-xl border border-line px-3 py-2 text-sm"
              dir="ltr"
            />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">لینک دانلود نسخه جدید</label>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full bg-surface rounded-xl border border-line px-3 py-2 text-sm"
              dir="ltr"
              placeholder="https://..."
            />
          </div>
          {error && <p className="text-xs text-waste">{error}</p>}
          {message && <p className="text-xs text-accent">{message}</p>}
          <button onClick={save} disabled={loading} className="w-full bg-accent text-on-accent py-2.5 rounded-xl text-sm font-medium disabled:opacity-40">
            {loading ? "در حال ذخیره..." : "ذخیره"}
          </button>
        </div>
      )}
    </Card>
  );
}

export default function AdminPage() {
  return (
    <div className="max-w-lg mx-auto p-4 space-y-4">
      <h1 className="text-lg font-bold text-ink">پنل مدیریت</h1>
      <LicenseSection />
      <ReleaseSection />
    </div>
  );
}
