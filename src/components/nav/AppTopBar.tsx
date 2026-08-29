"use client";

import { useState } from "react";
import SearchBox from "@/components/SearchBox";
import NotificationBell from "@/components/NotificationBell";
import { SearchIcon } from "@/components/icons";

// The hamburger + full-page NavDrawer this used to open is gone — BottomNav.tsx now owns all
// navigation (four tabs + a "بیشتر" sheet for the rest), so this is just the title/search/bell strip.
export default function AppTopBar() {
  const [showSearch, setShowSearch] = useState(false);

  return (
    <header className="sticky top-0 z-20 bg-white/80 backdrop-blur border-b border-gray-100 px-4 py-3">
      {showSearch ? (
        <div className="flex items-center gap-2">
          <SearchBox autoFocus />
          <button onClick={() => setShowSearch(false)} className="text-sm text-gray-400 shrink-0">
            بستن
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <p className="font-bold text-gray-800 text-sm">پنهان</p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowSearch(true)}
              className="p-2 rounded-full hover:bg-gray-100 text-gray-400"
              aria-label="جستجو"
            >
              <SearchIcon className="w-5 h-5" />
            </button>
            <NotificationBell />
          </div>
        </div>
      )}
    </header>
  );
}
