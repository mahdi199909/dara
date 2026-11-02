"use client";

import { useState } from "react";
import useSWR from "swr";
import { apiPatch, fetcher } from "@/lib/apiClient";
import { Card } from "@/components/ui/Card";
import { useDeviceJson } from "@/lib/deviceStore";
import { notifySaved } from "@/lib/savedToast";
import { useModes } from "@/lib/useModes";
import { CYCLE_ENABLED_KEY, GENDERS, GENDER_LABELS, MODES, MODE_INFO, serializeModes, withMode, type Gender, type Mode } from "@/lib/modes";

/** A sliding switch, the same one the rest of Settings uses. */
function Switch({ on, onChange, label }: { on: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      dir="ltr"
      className={`w-10 h-[22px] rounded-full transition shrink-0 flex items-center px-0.5 ${on ? "bg-accent justify-start" : "bg-line justify-end"}`}
    >
      <span className="h-4 w-4 rounded-full bg-on-accent transition" />
    </button>
  );
}

/**
 * «حالت‌ها»: the parts of the app that most people do not need, each one a switch. Which gender the person says (or
 * none) decides whether the monthly cycle is offered at all; the cycle's own switch and its data stay on this device.
 * The other modes are kept with the account like the rest of the settings.
 */
export default function ModesTab() {
  const { mutate } = useSWR("/api/settings", fetcher);
  const state = useModes();
  const [cycleOn, setCycleOn] = useDeviceJson<boolean>(CYCLE_ENABLED_KEY, false);
  const [error, setError] = useState<string | null>(null);

  async function save(patch: { gender?: Gender | null; modes?: string | null }) {
    setError(null);
    try {
      await apiPatch("/api/settings", patch);
      await mutate();
      notifySaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ذخیره نشد.");
    }
  }

  const genderChoices: Array<{ value: Gender | null; label: string }> = [{ value: null, label: "نمی‌گویم" }, ...GENDERS.map((g) => ({ value: g as Gender | null, label: GENDER_LABELS[g] }))];

  return (
    <div className="space-y-4">
      <Card className="p-5 space-y-3">
        <div>
          <h2 className="font-bold text-ink text-sm">جنسیت (اختیاری)</h2>
          <p className="text-xs text-muted mt-1 leading-relaxed">فقط برای نشان‌دادن یا پنهان‌کردن بخش‌هایی مثل چرخهٔ ماهانه است؛ جای دیگری به کار نمی‌رود و گفتنش لازم نیست.</p>
        </div>
        <div className="flex gap-2" role="radiogroup" aria-label="جنسیت">
          {genderChoices.map(({ value, label }) => {
            const active = (state.gender ?? null) === value;
            return (
              <button
                key={label}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={!state.loaded}
                onClick={() => void save({ gender: value })}
                className={`text-sm px-3.5 py-1.5 rounded-full border transition disabled:opacity-40 ${active ? "bg-accent text-on-accent border-accent" : "bg-surface text-ink border-line"}`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </Card>

      <Card className="p-5 space-y-4">
        <div>
          <h2 className="font-bold text-ink text-sm">حالت‌ها</h2>
          <p className="text-xs text-muted mt-1 leading-relaxed">هر حالت یک بخش به منوی «بیشتر» اضافه می‌کند و با خاموش‌کردنش از منو برمی‌دارد؛ دادهٔ ثبت‌شده‌اش پاک نمی‌شود.</p>
        </div>

        {MODES.map((mode: Mode) => (
          <div key={mode} className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-ink">{MODE_INFO[mode].label}</p>
              <p className="text-xs text-muted leading-relaxed">{MODE_INFO[mode].hint}</p>
            </div>
            <Switch on={state.modes.includes(mode)} label={MODE_INFO[mode].label} onChange={(on) => void save({ modes: serializeModes(withMode(state.modes, mode, on)) })} />
          </div>
        ))}

        {state.gender === "FEMALE" && (
          <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
            <div className="min-w-0">
              <p className="text-sm text-ink">چرخهٔ ماهانه</p>
              <p className="text-xs text-muted leading-relaxed">
                فقط روی همین دستگاه ذخیره می‌شود: به سرور نمی‌رود، با حساب همگام نمی‌شود و در فایل پشتیبان هم نیست. با پاک‌کردن اطلاعات برنامه یا حذف آن از گوشی از بین می‌رود.
              </p>
            </div>
            <Switch on={cycleOn === true} label="چرخهٔ ماهانه" onChange={setCycleOn} />
          </div>
        )}
      </Card>

      {error && <p className="text-xs text-waste">{error}</p>}
    </div>
  );
}
