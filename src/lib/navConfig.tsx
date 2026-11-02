import type { ReactElement, SVGProps } from "react";
import type { NavMode } from "@/lib/modes";
import {
  HomeIcon,
  CalendarIcon,
  CheckSquareIcon,
  WalletIcon,
  BoxIcon,
  ChartIcon,
  FolderIcon,
  GearIcon,
  FlameIcon,
  TrendUpIcon,
  ClockIcon,
  ListChecksIcon,
  InboxIcon,
  TargetIcon,
  CoinsIcon,
  MoonIcon,
  MealIcon,
  CycleIcon,
  PlanIcon,
} from "@/components/icons";

export interface NavItem {
  href: string;
  label: string;
  icon: (props: SVGProps<SVGSVGElement>) => ReactElement;
  /** The mode(s) that bring this entry in; none = always shown (see src/lib/modes.ts). */
  requires?: readonly NavMode[];
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "خانه", icon: HomeIcon },
  { href: "/calendar", label: "تقویم", icon: CalendarIcon },
  { href: "/tasks", label: "کارها", icon: CheckSquareIcon },
  { href: "/habits", label: "عادت‌ها", icon: FlameIcon },
  { href: "/finance", label: "مالی", icon: WalletIcon },
  { href: "/assets", label: "دارایی‌ها", icon: BoxIcon },
  { href: "/basket", label: "سبد دارایی", icon: CoinsIcon },
  { href: "/capital", label: "سرمایه", icon: TrendUpIcon },
  { href: "/reports", label: "گزارش‌ها", icon: ChartIcon },
  { href: "/projects", label: "پروژه‌ها", icon: FolderIcon },
  { href: "/vision", label: "ویژن‌برد", icon: TargetIcon },
  { href: "/timer", label: "زمان‌سنج", icon: ClockIcon },
  { href: "/checklists", label: "چک‌لیست‌ها", icon: ListChecksIcon },
  { href: "/inbox", label: "صندوق ورودی", icon: InboxIcon },
  { href: "/review", label: "پایان روز", icon: MoonIcon },
  { href: "/meals", label: "کالری‌شمار", icon: MealIcon, requires: ["athlete"] },
  { href: "/plan", label: "برنامه‌ریزی روز", icon: PlanIcon, requires: ["timeBlocking", "timeBoxing"] },
  { href: "/cycle", label: "چرخهٔ ماهانه", icon: CycleIcon, requires: ["cycle"] },
  { href: "/settings", label: "تنظیمات", icon: GearIcon },
];

// The four always-visible bottom tabs — everything else in NAV_ITEMS lives behind the fifth
// "بیشتر" tab (see BottomNav.tsx). Picked as the most frequently used sections; not just the
// first four NAV_ITEMS entries (habits sits between tasks and finance there).
// "/" (Home) sits third of the five bottom-nav slots (four primary + "بیشتر") so it lands dead
// center of the row, not off to one side.
const PRIMARY_HREFS = ["/calendar", "/tasks", "/", "/finance"] as const;
export const PRIMARY_NAV_ITEMS = PRIMARY_HREFS.map((href) => NAV_ITEMS.find((i) => i.href === href)!);
export const MORE_NAV_ITEMS = NAV_ITEMS.filter((i) => !(PRIMARY_HREFS as readonly string[]).includes(i.href));
