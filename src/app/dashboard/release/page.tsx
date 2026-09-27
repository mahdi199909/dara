"use client";

import ReleaseSection from "@/components/admin/ReleaseSection";
import { APK_STATIC_URL, BUNDLE_APP_VERSION } from "@/lib/appVersion";

export default function ReleasePage() {
  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold">نسخه‌ی اپ اندروید</h1>
        <p className="text-sm text-muted mt-1">
          نسخه‌ی همین سرور: <span dir="ltr">{BUNDLE_APP_VERSION}</span> — لینک ثابت دانلود:{" "}
          <a href={APK_STATIC_URL} className="text-accent" dir="ltr">
            {APK_STATIC_URL}
          </a>
        </p>
      </div>
      <ReleaseSection />
    </div>
  );
}
