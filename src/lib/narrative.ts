import { formatToman, toPersianDigits } from "./money";
import type { TimeAndMoneyReport } from "./reportEngine";

export function generateNarrative(report: TimeAndMoneyReport, periodLabel: string): string {
  const totalHours = Math.round(report.totalDurationMin / 60);
  const lines: string[] = [];

  lines.push(`در ${periodLabel} شما ${toPersianDigits(totalHours)} ساعت فعالیت ثبت کرده‌اید.`);

  const topCategories = [...report.timeByCategory].sort((a, b) => b.minutes - a.minutes).slice(0, 5);
  for (const c of topCategories) {
    const hours = Math.round((c.minutes / 60) * 10) / 10;
    if (hours <= 0) continue;
    lines.push(`${toPersianDigits(hours)} ساعت صرف ${c.name} شده.`);
  }

  lines.push(`هزینه مستقیم شما: ${formatToman(report.expense)} تومان.`);
  lines.push(`هزینه زمانی: ${formatToman(report.timeCost)} تومان.`);
  lines.push(`هزینه واقعی: ${formatToman(report.realCost)} تومان.`);

  if (report.opportunityCost > 0) {
    lines.push(`هزینه فرصت زمان‌های اتلافی: ${formatToman(report.opportunityCost)} تومان.`);
  }

  if (report.virtualAssetValue > 0) {
    lines.push(`دارایی مجازی ایجادشده: ${formatToman(report.virtualAssetValue)} تومان.`);
  }

  lines.push(`درآمد: ${formatToman(report.income)} تومان و خالص جریان نقدی: ${formatToman(report.net)} تومان.`);

  return lines.join(" ");
}
