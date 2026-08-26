"use client";

import { useState } from "react";
import { apiPost } from "@/lib/apiClient";
import { XIcon } from "@/components/icons";

/**
 * Creates a 3-day trial habit using BJ Fogg's "Tiny Habits" recipe: After [CUE], I will
 * [TINY ACTION]. Then I will [CELEBRATION]. Shown as a connected 3-step chain rather than a
 * flat form so the cause-and-effect structure — the whole point of the method — is visible
 * at a glance, not just implied by field order.
 */
export default function TrialHabitFormModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [cue, setCue] = useState("");
  const [title, setTitle] = useState("");
  const [celebration, setCelebration] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = cue.trim() && title.trim() && celebration.trim();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      await apiPost("/api/habits", { title, cue, celebration, isTrial: true });
      onCreated();
    } catch (err: any) {
      setError(err?.message ?? "ثبت انجام نشد.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30">
      <div className="w-full max-w-md mx-auto bg-white rounded-t-2xl shadow-xl max-h-[90vh] overflow-y-auto scrollbar-thin">
        <div className="flex items-center justify-between px-5 pt-5">
          <div>
            <h2 className="font-bold text-gray-800">عادت تستی ۳ روزه</h2>
            <p className="text-xs text-gray-400 mt-0.5">بر اساس روش Tiny Habits — یک اقدام خیلی کوچک، ۳ روز امتحانش کن</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
            <XIcon className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-0">
          <ChainStep
            number={1}
            emoji="👉"
            label="نشونه"
            hint="بعد از انجام چه کاری، یاد این عادت می‌افتی؟"
            value={cue}
            onChange={setCue}
            placeholder="بعد از اینکه دندونامو مسواک زدم"
            connectDown
          />
          <ChainStep
            number={2}
            emoji="⚡"
            label="میکرو اقدام"
            hint="کوچیک‌ترین نسخه ممکن از این عادت چیه؟"
            value={title}
            onChange={setTitle}
            placeholder="۲ صفحه کتاب می‌خونم"
            connectUp
            connectDown
          />
          <ChainStep
            number={3}
            emoji="🎉"
            label="پاداش"
            hint="بلافاصله بعدش چه کاری می‌کنی که حس خوبی بگیری؟"
            value={celebration}
            onChange={setCelebration}
            placeholder="با خودم می‌گم آفرین!"
            connectUp
          />

          {error && <p className="text-sm text-waste-600 mt-3">{error}</p>}

          <button
            type="submit"
            disabled={loading || !canSubmit}
            className="w-full mt-4 rounded-xl bg-brand-600 text-white py-2.5 text-sm font-medium hover:bg-brand-700 disabled:opacity-40"
          >
            {loading ? "در حال ثبت..." : "شروع عادت تستی"}
          </button>
          <p className="text-xs text-gray-400 text-center mt-2">
            بعد از ۳ روز ازت می‌پرسیم ادامه بدی یا نه — تا اون‌موقع روی استریک اصلی‌ات تأثیری نداره.
          </p>
        </form>
      </div>
    </div>
  );
}

function ChainStep({
  number,
  emoji,
  label,
  hint,
  value,
  onChange,
  placeholder,
  connectUp,
  connectDown,
}: {
  number: number;
  emoji: string;
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  connectUp?: boolean;
  connectDown?: boolean;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center w-9 shrink-0">
        <div className={`w-1.5 flex-1 ${connectUp ? "bg-brand-200" : "bg-transparent"}`} style={{ minHeight: connectUp ? "0.75rem" : 0 }} />
        <div className="w-9 h-9 rounded-full bg-brand-50 border-2 border-brand-200 flex items-center justify-center text-base shrink-0">
          {emoji}
        </div>
        <div className={`w-1.5 flex-1 ${connectDown ? "bg-brand-200" : "bg-transparent"}`} style={{ minHeight: connectDown ? "0.75rem" : 0 }} />
      </div>
      <div className="flex-1 pb-4">
        <p className="text-xs font-medium text-gray-500 mb-1">
          {number}. {label}
        </p>
        <input
          required
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
        />
        <p className="text-[11px] text-gray-400 mt-1">{hint}</p>
      </div>
    </div>
  );
}
