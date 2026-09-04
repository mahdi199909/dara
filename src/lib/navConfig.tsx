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
} from "@/components/icons";

export const NAV_ITEMS = [
  { href: "/", label: "خانه", icon: HomeIcon },
  { href: "/calendar", label: "تقویم", icon: CalendarIcon },
  { href: "/tasks", label: "کارها", icon: CheckSquareIcon },
  { href: "/habits", label: "عادت‌ها", icon: FlameIcon },
  { href: "/finance", label: "مالی", icon: WalletIcon },
  { href: "/assets", label: "دارایی‌ها", icon: BoxIcon },
  { href: "/capital", label: "سرمایه", icon: TrendUpIcon },
  { href: "/reports", label: "گزارش‌ها", icon: ChartIcon },
  { href: "/projects", label: "پروژه‌ها", icon: FolderIcon },
  { href: "/settings", label: "تنظیمات", icon: GearIcon },
] as const;

// The four always-visible bottom tabs — everything else in NAV_ITEMS lives behind the fifth
// "بیشتر" tab (see BottomNav.tsx). Picked as the most frequently used sections; not just the
// first four NAV_ITEMS entries (habits sits between tasks and finance there).
// "/" (Home) sits third of the five bottom-nav slots (four primary + "بیشتر") so it lands dead
// center of the row, not off to one side.
const PRIMARY_HREFS = ["/calendar", "/tasks", "/", "/finance"] as const;
export const PRIMARY_NAV_ITEMS = PRIMARY_HREFS.map((href) => NAV_ITEMS.find((i) => i.href === href)!);
export const MORE_NAV_ITEMS = NAV_ITEMS.filter((i) => !(PRIMARY_HREFS as readonly string[]).includes(i.href));
