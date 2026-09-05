// TEMPORARY review page — not linked from navigation, delete after the Companion visual design
// is confirmed to match doc/companion-preview.html. Renders all eight moods in both variants,
// at both the Home size (96px) and the AppTopBar size (40px), for side-by-side comparison.
import type { CompanionMood } from "@/lib/companion";
import CompanionFace from "@/components/companion/CompanionFace";

// Same representative completion values as doc/companion-preview.html's MOODS table, so the
// ring fill matches what that reference shows for each mood.
const MOOD_SAMPLES: { mood: CompanionMood; completion: number }[] = [
  { mood: "ASLEEP", completion: 0 },
  { mood: "FRESH", completion: 0.06 },
  { mood: "SLEEPY", completion: 0.14 },
  { mood: "NEUTRAL", completion: 0.34 },
  { mood: "CONTENT", completion: 0.66 },
  { mood: "HAPPY", completion: 1 },
  { mood: "CELEBRATING", completion: 1 },
  { mood: "BLINDFOLDED", completion: 0.22 },
];

export default function CompanionDevReviewPage() {
  return (
    <div className="px-4 py-6 space-y-8" dir="rtl">
      <div>
        <h1 className="text-lg font-bold text-gray-800">دمو آدمک (صفحه موقت)</h1>
        <p className="text-xs text-gray-400 mt-1">مقایسه با doc/companion-preview.html — بعد از تأیید حذف می‌شود.</p>
      </div>

      <section>
        <h2 className="text-sm font-bold text-gray-700 mb-3">هر دو واریانت — ۹۶ پیکسل</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {MOOD_SAMPLES.map(({ mood, completion }) => (
            <div key={mood} className="flex flex-col items-center gap-2 bg-white border border-gray-100 rounded-2xl p-4">
              <span className="text-xs font-mono text-gray-500">{mood}</span>
              <div className="flex items-center gap-3">
                <div className="flex flex-col items-center gap-1">
                  <CompanionFace mood={mood} completion={completion} size={96} variant="face" />
                  <span className="text-[10px] text-gray-400">face</span>
                </div>
                <div className="flex flex-col items-center gap-1">
                  <CompanionFace mood={mood} completion={completion} size={96} variant="figure" />
                  <span className="text-[10px] text-gray-400">figure</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-bold text-gray-700 mb-3">اندازه واقعی نوار بالا — ۴۰ پیکسل (face)</h2>
        <div className="flex flex-wrap gap-4 bg-white border border-gray-100 rounded-2xl p-4">
          {MOOD_SAMPLES.map(({ mood, completion }) => (
            <div key={mood} className="flex flex-col items-center gap-1">
              <CompanionFace mood={mood} completion={completion} size={40} variant="face" />
              <span className="text-[9px] font-mono text-gray-400">{mood}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
