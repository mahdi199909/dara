// Phone brands whose own battery manager — separate from Android's — stops an app that is not on
// screen, alarms included, unless the app is allowed to "autostart" / "run in the background". A
// reminder that never rings on such a phone is not a bug of the app, and only the person holding
// the phone can allow it; so Settings → «اعلان‌ها و یادآورها» says which switch to look for.

export interface BatteryBrand {
  /** The brand as it reads in Persian. */
  name: string;
  /** What to switch on, in that brand's own words. */
  advice: string;
  /** MainActivity's AndroidNotifications bridge knows a screen to open for this brand. */
  hasAutostartScreen: boolean;
}

const BRANDS: Array<{ matches: string[]; brand: BatteryBrand }> = [
  {
    matches: ["xiaomi", "redmi", "poco"],
    brand: {
      name: "شیائومی",
      advice:
        "در گوشی‌های شیائومی «شروع خودکار» (Autostart) را برای برنامه روشن کنید و در «صرفه‌جویی باتری» آن را روی «بدون محدودیت» بگذارید. برنامه را در فهرست برنامه‌های اخیر هم قفل کنید تا «پاک کردن همه» آن را نبندد.",
      hasAutostartScreen: true,
    },
  },
  {
    matches: ["huawei", "honor"],
    brand: {
      name: "هوآوی/آنر",
      advice:
        "در گوشی‌های هوآوی و آنر، از «راه‌اندازی برنامه» (App launch) برای برنامه «مدیریت دستی» را بزنید و هر سه گزینه‌ی راه‌اندازی خودکار، راه‌اندازی ثانویه و اجرا در پس‌زمینه را روشن کنید.",
      hasAutostartScreen: true,
    },
  },
  {
    matches: ["oppo", "realme", "oneplus"],
    brand: {
      name: "اوپو/ریلمی/وان‌پلاس",
      advice: "در این گوشی‌ها «شروع خودکار» (Auto launch) و «اجرا در پس‌زمینه» را برای برنامه روشن کنید و آن را از «پاک کردن همه» مستثنی (قفل) کنید.",
      hasAutostartScreen: true,
    },
  },
  {
    matches: ["vivo", "iqoo"],
    brand: {
      name: "ویوو",
      advice: "در گوشی‌های ویوو «شروع خودکار» و «اجرا در پس‌زمینه با مصرف باتری بالا» را برای برنامه روشن کنید.",
      hasAutostartScreen: true,
    },
  },
  {
    matches: ["samsung"],
    brand: {
      name: "سامسونگ",
      advice:
        "در گوشی‌های سامسونگ برنامه‌ای که چند روز باز نشود «به خواب می‌رود» و اعلانش نمی‌رسد. از تنظیمات ← باتری ← محدودیت‌های مصرف در پس‌زمینه، برنامه را از «برنامه‌های در حالت خواب» خارج کنید و به «برنامه‌هایی که هرگز نمی‌خوابند» اضافه کنید.",
      hasAutostartScreen: false,
    },
  },
];

/** The battery advice for a phone brand (as MainActivity reports it, lower-case), or null when its battery manager is not known to interfere. */
export function batteryBrandOf(manufacturer: string | null): BatteryBrand | null {
  if (!manufacturer) return null;
  const maker = manufacturer.toLowerCase();
  return BRANDS.find((entry) => entry.matches.some((m) => maker.includes(m)))?.brand ?? null;
}
