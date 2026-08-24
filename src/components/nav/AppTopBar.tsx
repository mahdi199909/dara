"use client";

import { useState } from "react";
import SearchBox from "@/components/SearchBox";
import NotificationBell from "@/components/NotificationBell";
import NavDrawer from "./NavDrawer";
import { MenuIcon, SearchIcon } from "@/components/icons";

export default function AppTopBar({ userName }: { userName: string }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showSearch, setShowSearch] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-20 bg-white/80 backdrop-blur border-b border-gray-100 px-4 py-3">
        {showSearch ? (
          <div className="flex items-center gap-2">
            <SearchBox />
            <button onClick={() => setShowSearch(false)} className="text-sm text-gray-400 shrink-0">
              بستن
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <button
              onClick={() => setDrawerOpen(true)}
              className="p-2 -mr-2 rounded-full hover:bg-gray-100 text-gray-600"
              aria-label="منو"
            >
              <MenuIcon className="w-5 h-5" />
            </button>
            <p className="font-bold text-gray-800 text-sm">حساب‌کن</p>
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

      <NavDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} userName={userName} />
    </>
  );
}
