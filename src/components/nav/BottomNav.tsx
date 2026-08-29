"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { PRIMARY_NAV_ITEMS, MORE_NAV_ITEMS } from "@/lib/navConfig";
import { apiPost } from "@/lib/apiClient";
import { MoreIcon, XIcon } from "@/components/icons";
import { BOTTOM_NAV_HEIGHT_PX } from "@/lib/layoutConstants";

// The native-feeling replacement for the old hamburger + full-screen NavDrawer: the four most
// used sections stay one tap away here, everything else (+ logout) lives behind "بیشتر". Fixed
// height (BOTTOM_NAV_HEIGHT_PX, from a plain shared module — see that file for why not here)
// so other fixed elements — GlobalCaptureFab, page bottom padding — can reserve space above it.

export default function BottomNav({ userName }: { userName: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);

  async function logout() {
    await apiPost("/api/auth/logout");
    router.push("/login");
    router.refresh();
  }

  const moreActive = MORE_NAV_ITEMS.some((i) => (i.href === "/" ? pathname === "/" : pathname.startsWith(i.href)));

  return (
    <>
      <nav
        className="fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t border-gray-100 flex items-stretch"
        style={{ height: BOTTOM_NAV_HEIGHT_PX, paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {PRIMARY_NAV_ITEMS.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-[11px] ${
                active ? "text-brand-600" : "text-gray-400"
              }`}
            >
              <Icon className="w-[22px] h-[22px]" strokeWidth={active ? 2.1 : 1.8} />
              {item.label}
            </Link>
          );
        })}
        <button
          onClick={() => setMoreOpen(true)}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-[11px] ${
            moreOpen || moreActive ? "text-brand-600" : "text-gray-400"
          }`}
        >
          <MoreIcon className="w-[22px] h-[22px]" strokeWidth={moreOpen || moreActive ? 2.1 : 1.8} />
          بیشتر
        </button>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30" onClick={() => setMoreOpen(false)}>
          <div
            className="w-full bg-white rounded-t-2xl shadow-xl max-h-[75vh] overflow-y-auto scrollbar-thin animate-in"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 pt-5 pb-2">
              <div className="flex items-center gap-2.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icon.png" alt="پنهان" className="h-8 w-8 rounded-xl" />
                <p className="text-xs text-gray-400">{userName}</p>
              </div>
              <button onClick={() => setMoreOpen(false)} className="p-1.5 text-gray-400 hover:text-gray-600" aria-label="بستن">
                <XIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="px-3 pb-2 grid grid-cols-3 gap-2">
              {MORE_NAV_ITEMS.map((item) => {
                const active = pathname.startsWith(item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    className={`flex flex-col items-center gap-1.5 rounded-xl px-2 py-3 text-xs transition ${
                      active ? "bg-brand-50 text-brand-700 font-medium" : "text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                    {item.label}
                  </Link>
                );
              })}
            </div>

            <div className="p-3 border-t border-gray-100">
              <button
                onClick={logout}
                className="w-full text-center px-3 py-2.5 rounded-xl text-sm text-gray-400 hover:bg-gray-50 hover:text-gray-600 transition"
              >
                خروج از حساب
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
