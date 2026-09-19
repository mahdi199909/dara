"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { PRIMARY_NAV_ITEMS, MORE_NAV_ITEMS } from "@/lib/navConfig";
import { apiPost } from "@/lib/apiClient";
import { MoreIcon, XIcon, SearchIcon } from "@/components/icons";
import { BOTTOM_NAV_HEIGHT_PX } from "@/lib/layoutConstants";
import SearchBox from "@/components/SearchBox";
import NotificationBell from "@/components/NotificationBell";

// The native-feeling replacement for the old hamburger + full-screen NavDrawer: the four most
// used sections stay one tap away here, everything else (+ logout) lives behind "بیشتر". Fixed
// height (BOTTOM_NAV_HEIGHT_PX, from a plain shared module — see that file for why not here)
// so other fixed elements — GlobalCaptureFab, page bottom padding — can reserve space above it.

export default function BottomNav({ userName }: { userName: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  function closeMore() {
    setMoreOpen(false);
    setSearchOpen(false);
  }

  async function logout() {
    const native = Boolean((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());
    if (native) {
      // No server session to clear on-device (see nativeOnboarding.ts) — apiPost("/api/auth/logout")
      // would route through dispatchLocal to a nonexistent web-only concept and do nothing, and
      // "/login" isn't a real screen here (FirstRunGate owns the logged-out UI). Clear the cached
      // license/token instead and reload, so FirstRunGate's boot check finds nothing cached.
      const [{ dispatchLocal }, { getLocalDbInstance }] = await Promise.all([import("@/lib/localDispatcher"), import("@/local/db")]);
      // Logging out drops the token, and with it any way to send changes that haven't synced yet —
      // so try one last sync first (capped: being offline must not trap someone on this screen).
      try {
        const { syncWithServer } = await import("@/lib/nativeOnboarding");
        await Promise.race([syncWithServer({ deep: true }), new Promise((resolve) => setTimeout(resolve, 10_000))]);
      } catch {
        // best effort
      }
      dispatchLocal("POST", "/api/local/logout");
      // Must complete before navigating away: browserSqlJs.ts buffers writes in memory and
      // flushes to disk on a 300ms debounce (plus a pagehide safety net that can't actually block
      // the navigation below from tearing the page down first). Without waiting here, a hard
      // navigation right after a recent write could race that flush and lose or corrupt it —
      // which on next launch looks exactly like the app's entire local data vanished.
      await getLocalDbInstance()?.flush?.();
      window.location.href = "/";
      return;
    }
    await apiPost("/api/auth/logout");
    router.push("/login");
    router.refresh();
  }

  const moreActive = MORE_NAV_ITEMS.some((i) => (i.href === "/" ? pathname === "/" : pathname.startsWith(i.href)));

  return (
    <>
      <nav
        className="fixed bottom-0 inset-x-0 z-30 bg-surface/95 backdrop-blur border-t border-line flex items-stretch"
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
                active ? "text-accent" : "text-muted"
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
            moreOpen || moreActive ? "text-accent" : "text-muted"
          }`}
        >
          <MoreIcon className="w-[22px] h-[22px]" strokeWidth={moreOpen || moreActive ? 2.1 : 1.8} />
          بیشتر
        </button>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30" onClick={closeMore}>
          <div
            className="w-full bg-surface rounded-t-2xl shadow-xl max-h-[75vh] overflow-y-auto scrollbar-thin animate-in"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {searchOpen ? (
              <div className="flex items-center gap-2 px-5 pt-5 pb-2">
                <SearchBox autoFocus />
                <button onClick={() => setSearchOpen(false)} className="text-sm text-muted shrink-0">
                  بستن
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between px-5 pt-5 pb-2">
                <div className="flex items-center gap-2.5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/icon.png" alt="پروا" className="h-8 w-8 rounded-xl" />
                  <p className="text-xs text-muted">{userName}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setSearchOpen(true)} className="p-2 rounded-full hover:bg-canvas text-muted" aria-label="جستجو">
                    <SearchIcon className="w-5 h-5" />
                  </button>
                  <NotificationBell />
                  <button onClick={closeMore} className="p-1.5 text-muted hover:text-ink" aria-label="بستن">
                    <XIcon className="w-5 h-5" />
                  </button>
                </div>
              </div>
            )}

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
                      active ? "bg-accent-soft text-accent font-medium" : "text-ink hover:bg-canvas"
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                    {item.label}
                  </Link>
                );
              })}
            </div>

            <div className="p-3 border-t border-line">
              <button
                onClick={logout}
                className="w-full text-center px-3 py-2.5 rounded-xl text-sm text-muted hover:bg-canvas hover:text-ink transition"
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
