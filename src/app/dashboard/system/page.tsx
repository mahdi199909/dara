"use client";

import HealthSection from "@/components/admin/HealthSection";
import TimelineSection from "@/components/admin/TimelineSection";
import LoggingSection from "@/components/admin/LoggingSection";

// The server's health since it started, one person's story from the log, and the live log levels.
export default function SystemPage() {
  return (
    <div className="space-y-4 max-w-4xl">
      <div>
        <h1 className="text-xl font-bold">سلامت سرور و گزارش‌ها</h1>
        <p className="text-sm text-muted mt-1">شمارش‌ها و زمان‌ها از آخرین روشن‌شدن سرور — بدون داده‌ی شخصی کاربران.</p>
      </div>
      <HealthSection />
      <TimelineSection />
      <LoggingSection />
    </div>
  );
}
