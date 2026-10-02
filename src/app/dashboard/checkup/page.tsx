"use client";

// The research form «حسابرسی ۵ دقیقه‌ای» (parvaapp.ir/checkup), read against the kit's locked thresholds
// (doc/checkup/market-test-kit.md §8). Below 80 completed answers in the current filter the server withholds
// every percentage, and this page says «فقط کیفی بخوان» instead. Filters live in the address bar.
import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { fetcher } from "@/lib/apiClient";
import { Card } from "@/components/ui/Card";
import { fa, jalaliDate } from "@/components/dashboard/format";
import { OPTIONS, type Rate } from "@/lib/checkup";
import type { CheckupDashboard, FreeText } from "@/lib/checkupAdmin";

const GROUPS = [
  ["all", "همه"],
  ["blind", "کور (گروه‌ها و نظرسنجی)"],
  ["branded", "برنددار (اینستاگرام، کانال، سایت)"],
  ["unknown", "نامشخص"],
] as const;

const GROUP_LABEL: Record<string, string> = { blind: "کور", branded: "برنددار", unknown: "نامشخص" };

function pct(rate: Rate): string {
  return rate.pct === null ? "—" : `${fa(Math.round(rate.pct * 100))}٪`;
}

function RateCell({ rate }: { rate: Rate }) {
  return (
    <span>
      <b>{pct(rate)}</b> <span className="text-muted text-xs">({fa(rate.count)} از {fa(rate.base)})</span>
    </span>
  );
}

function Tile({ label, children, tone = "" }: { label: string; children: React.ReactNode; tone?: string }) {
  return (
    <Card className={`p-4 h-full ${tone}`}>
      <p className="text-xs text-muted">{label}</p>
      <div className="text-lg font-bold mt-1">{children}</div>
    </Card>
  );
}

const TONE_OK = "bg-accent-soft";
const TONE_MILD = "bg-amber-50";
const TONE_BAD = "bg-waste-soft";

function minutesLabel(sec: number | null): string {
  if (sec === null) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${fa(m)} دقیقه و ${fa(s)} ثانیه`;
}

export default function CheckupPage() {
  return (
    <Suspense fallback={null}>
      <Checkup />
    </Suspense>
  );
}

function Checkup() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const group = params.get("group") ?? "all";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const hide = params.get("hide") === "1";

  function setParam(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === "" || (k === "group" && v === "all")) next.delete(k);
      else next.set(k, v);
    }
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`);
  }

  const query = new URLSearchParams({ group, ...(from ? { from } : {}), ...(to ? { to } : {}), ...(hide ? { hide: "1" } : {}) });
  const { data, error } = useSWR<CheckupDashboard>(`/api/admin/checkup?${query}`, fetcher, { keepPreviousData: true });
  const m = data?.metrics;

  return (
    <div className="space-y-5 max-w-7xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">حسابرسی ۵ دقیقه‌ای</h1>
          <p className="text-sm text-muted mt-1">پاسخ‌های فرم پژوهشی parvaapp.ir/checkup، در برابر آستانه‌های قفل‌شدهٔ کیت تست بازار.</p>
        </div>
        <a href={`/api/admin/checkup/export?${query}`} className="rounded-xl bg-accent text-on-accent px-4 py-2 text-sm font-medium">
          خروجی CSV
        </a>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {GROUPS.map(([value, label]) => (
          <button
            key={value}
            onClick={() => setParam({ group: value })}
            className={`rounded-full px-3 py-1.5 text-xs transition ${group === value ? "bg-accent text-on-accent" : "bg-surface border border-line text-muted hover:text-ink"}`}
          >
            {label}
          </button>
        ))}
        <label className="text-xs text-muted flex items-center gap-1 ms-2">
          از
          <input type="date" value={from} onChange={(e) => setParam({ from: e.target.value })} className="bg-surface rounded-lg border border-line px-2 py-1" />
        </label>
        <label className="text-xs text-muted flex items-center gap-1">
          تا
          <input type="date" value={to} onChange={(e) => setParam({ to: e.target.value })} className="bg-surface rounded-lg border border-line px-2 py-1" />
        </label>
        <label className="text-xs text-muted flex items-center gap-1 ms-2">
          <input type="checkbox" checked={hide} onChange={(e) => setParam({ hide: e.target.checked ? "1" : null })} />
          پنهان کردن مشکوک‌ها{data ? ` (${fa(data.suspiciousCount)})` : ""}
        </label>
      </div>

      {error && <p className="text-sm text-waste">{error.message}</p>}
      {!m ? (
        <p className="text-sm text-muted">…</p>
      ) : (
        <>
          {m.qualitativeOnly ? (
            <Card className="p-4 bg-amber-50 text-amber-900 text-sm">
              <b>فقط کیفی بخوان.</b> در این فیلتر {fa(m.funnel.completed)} پاسخ کامل هست. تا به {fa(m.thresholds.minForPercentages)} نرسیده، هیچ درصدی نشان داده نمی‌شود؛ شمارش‌ها و متن‌ها را بخوان.
              حداقل تصمیم‌پذیر {fa(m.thresholds.decisionSample)} پاسخ کامل است.
            </Card>
          ) : !m.decisionReady ? (
            <Card className="p-4 bg-amber-50 text-amber-900 text-sm">
              درصدها نشان داده می‌شوند، ولی هنوز به حداقل تصمیم‌پذیر ({fa(m.thresholds.decisionSample)} پاسخ کامل) نرسیده‌ای. تصمیم ت۱ تا ت۳ را صبر کن.
            </Card>
          ) : null}

          <section className="space-y-2">
            <h2 className="font-bold text-sm">قیف</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
              <Tile label="شروع‌شده">{fa(m.funnel.started)}</Tile>
              {m.funnel.reachedPage.map((n, i) => (
                <Tile key={i} label={`رسیده به صفحهٔ ${fa(i + 1)}`}>
                  {fa(n)}
                </Tile>
              ))}
              <Tile label="کامل‌شده">{fa(m.funnel.completed)}</Tile>
              <Tile label="میانهٔ مدت پر کردن">
                <span className="text-sm">{minutesLabel(m.funnel.medianDurationSec)}</span>
              </Tile>
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="font-bold text-sm">ت۱ — آیا درد «هزینهٔ پنهان» وجود دارد؟</h2>
            <div className="grid md:grid-cols-3 gap-3">
              <Tile
                label="س۳: «یادم نیست» یا «مطمئن نیستم» (سنجهٔ اصلی)"
                tone={m.t1.status === "confirmed" ? TONE_OK : m.t1.status === "mild" ? TONE_MILD : m.t1.status === "weak" ? TONE_BAD : ""}
              >
                <RateCell rate={m.t1.forgot} />
                <p className="text-xs font-normal text-muted mt-1">
                  {m.t1.status === "confirmed"
                    ? "≥ ۵۵٪: فرضیهٔ مرکزی تأیید شد؛ پوزیشنینگ فعلی بماند."
                    : m.t1.status === "mild"
                      ? "۳۵ تا ۵۵٪: درد هست ولی حاد نیست؛ هزینهٔ پنهان لایهٔ دوم شود."
                      : m.t1.status === "weak"
                        ? "< ۳۵٪: فرضیهٔ مرکزی ضعیف است؛ پیش از هزینهٔ بازاریابی بازنگری شود."
                        : "آستانه‌ها: ≥ ۵۵٪ تأیید، ۳۵ تا ۵۵٪ ملایم، < ۳۵٪ ضعیف."}
                </p>
              </Tile>
              <Tile label="س۱۳ = «همین ماه» (تأییدی، باید ≥ ۴۰٪)" tone={m.t1.thisMonth.pct === null ? "" : m.t1.thisMonth.pct >= m.thresholds.thisMonthConfirms ? TONE_OK : TONE_MILD}>
                <RateCell rate={m.t1.thisMonth} />
              </Tile>
              <Tile label="س۴ = «فکر نکرده‌ام» (ضدسنجه، هشدار بالای ۷۵٪)" tone={m.t1.neverThoughtTriggered ? TONE_MILD : ""}>
                <RateCell rate={m.t1.neverThought} />
                {m.t1.neverThoughtTriggered && <p className="text-xs font-normal mt-1">ارزش ساعتی باید درون محصول ساخته شود، نه از کاربر پرسیده شود.</p>}
              </Tile>
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="font-bold text-sm">ت۲ — کدام سگمنت؟ (س۱۴ در برابر سه سیگنال)</h2>
            <Card className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted">
                  <tr className="border-b border-line">
                    <th className="p-3 text-right font-medium">شکل درآمد</th>
                    <th className="p-3 text-right font-medium">پاسخ کامل</th>
                    <th className="p-3 text-right font-medium">س۳ = ثبت‌نشده</th>
                    <th className="p-3 text-right font-medium">س۶ = نمی‌دونم / باید حساب کنم</th>
                    <th className="p-3 text-right font-medium">س۱۰ = قبلاً پول داده</th>
                  </tr>
                </thead>
                <tbody>
                  {m.t2.map((row) => (
                    <tr key={row.segment} className="border-b border-line last:border-0">
                      <td className="p-3">{OPTIONS.income[row.segment as keyof typeof OPTIONS.income]}</td>
                      <td className="p-3">{fa(row.completed)}</td>
                      <td className="p-3"><RateCell rate={row.forgot} /></td>
                      <td className="p-3"><RateCell rate={row.spendUnknown} /></td>
                      <td className="p-3"><RateCell rate={row.paid} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-muted p-3">سگمنت برنده در هر سه بالاترین است. درد بالا بدون سابقهٔ پرداخت یعنی بازار دوم.</p>
            </Card>
          </section>

          <section className="space-y-2">
            <h2 className="font-bold text-sm">ت۳ — کدام نقطهٔ ورود؟ (س۷ و س۸)</h2>
            <div className="grid md:grid-cols-3 gap-3">
              <Tile label="ابزار داشته و رها کرده (بیشتر از یک ماه / دیگر استفاده نمی‌کند) — نقطهٔ ورود" tone={TONE_OK}>
                <RateCell rate={m.t3.abandoned} />
              </Tile>
              <Tile label="ابزار دارد و فعال است (امروز / این هفته / این ماه) — باید ۱۰ برابر بهتر بود">
                <RateCell rate={m.t3.active} />
              </Tile>
              <Tile label="هیچ ابزاری ندارد («هیچ‌کدوم») — نقطهٔ ورود نیست">
                <RateCell rate={m.t3.never} />
              </Tile>
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="font-bold text-sm">واکنش به گزارش شخصی</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <Tile label="گزارش را دید (از کامل‌شده‌ها)"><RateCell rate={m.report.viewed} /></Tile>
              <Tile label="اشتراک یا ذخیرهٔ کارت (از بیننده‌ها)" tone={m.report.reactionAlarm ? TONE_BAD : m.report.reactionAlarm === false ? TONE_OK : ""}>
                <RateCell rate={m.report.reacted} />
                {m.report.reactionAlarm && <p className="text-xs font-normal mt-1">زیر ۳۰٪: مسئله جدی‌تر از پیام‌رسانی است.</p>}
              </Tile>
              <Tile label="اشتراک‌گذاری"><RateCell rate={m.report.shared} /></Tile>
              <Tile label="ذخیرهٔ تصویر"><RateCell rate={m.report.downloaded} /></Tile>
              <Tile label="دعوت کانال تلگرام"><RateCell rate={m.report.inviteTelegram} /></Tile>
              <Tile label="دعوت اپ (ثبت‌نام)"><RateCell rate={m.report.inviteApp} /></Tile>
            </div>
          </section>

          <section className="grid lg:grid-cols-2 gap-4">
            <TextList title="س۹ — چی شد که ولش کردی؟ (ارزشمندترین متن)" items={data.texts.whyLeft} />
            <TextList title="س۵ — خریدی که لازم نبود" items={data.texts.regret} />
            <TextList title="س۱۱ — آنچه یاد گرفته یا ساخته" items={data.texts.built} />
            <TextList title="س۱۰ — بابت چه ابزاری و چقدر پول داده" items={data.texts.paidWhat} />
          </section>

          <section className="space-y-2">
            <h2 className="font-bold text-sm">راه‌های ارتباطی ({fa(data.contacts.length)})</h2>
            <Card className="overflow-x-auto">
              {data.contacts.length === 0 ? (
                <p className="text-sm text-muted p-4">هنوز کسی راه ارتباطی نگذاشته.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted">
                    <tr className="border-b border-line">
                      <th className="p-3 text-right font-medium">تاریخ</th>
                      <th className="p-3 text-right font-medium">منبع</th>
                      <th className="p-3 text-right font-medium">تلگرام</th>
                      <th className="p-3 text-right font-medium">بله</th>
                      <th className="p-3 text-right font-medium">ایمیل</th>
                      <th className="p-3 text-right font-medium">مصاحبه</th>
                      <th className="p-3 text-right font-medium">ساعت ثبت‌نشده</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.contacts.map((c) => (
                      <tr key={c.id} className={`border-b border-line last:border-0 ${c.suspicious ? "opacity-50" : ""}`}>
                        <td className="p-3 whitespace-nowrap">{jalaliDate(c.at)}{c.suspicious ? " · مشکوک" : ""}</td>
                        <td className="p-3">{GROUP_LABEL[c.sourceGroup] ?? c.sourceGroup}</td>
                        <td className="p-3" dir="ltr">
                          {c.telegram ? (
                            <a className="text-accent" href={`https://t.me/${c.telegram}`} target="_blank" rel="noopener noreferrer nofollow">
                              @{c.telegram}
                            </a>
                          ) : null}
                        </td>
                        <td className="p-3" dir="ltr">{c.bale}</td>
                        <td className="p-3" dir="ltr">{c.email}</td>
                        <td className="p-3">{c.interviewOk ? <span className="rounded-full px-2 py-0.5 text-xs bg-accent-soft text-accent">بله</span> : c.interviewOk === false ? "نه" : ""}</td>
                        <td className="p-3">{c.hiddenMinutes === null ? "" : fa(Math.round(c.hiddenMinutes / 6) / 10)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </section>
        </>
      )}
    </div>
  );
}

function TextList({ title, items }: { title: string; items: FreeText[] }) {
  return (
    <Card className="p-4 space-y-2">
      <h2 className="font-bold text-sm">
        {title} <span className="text-muted font-normal">({fa(items.length)})</span>
      </h2>
      {items.length === 0 ? (
        <p className="text-xs text-muted">هنوز چیزی نوشته نشده.</p>
      ) : (
        <ul className="divide-y divide-line max-h-96 overflow-y-auto">
          {items.map((t) => (
            <li key={t.id} className={`py-2 text-sm ${t.suspicious ? "opacity-50" : ""}`}>
              <p className="whitespace-pre-wrap break-words">{t.text}</p>
              <p className="text-[11px] text-muted mt-1">
                {jalaliDate(t.at)} · {GROUP_LABEL[t.sourceGroup] ?? t.sourceGroup}
                {t.suspicious ? " · مشکوک" : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
