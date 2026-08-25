"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { fetcher } from "@/lib/apiClient";
import { SearchIcon, XIcon } from "./icons";

export default function SearchBox() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const data = await fetcher<{ results?: any[] }>(`/api/search?q=${encodeURIComponent(q)}`);
      setResults(data.results ?? []);
    }, 250);
  }, [q]);

  return (
    <div className="relative flex-1 max-w-md">
      <div className="relative">
        <SearchIcon className="w-4 h-4 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder="جستجو..."
          className="w-full bg-gray-100 rounded-full py-2 pr-9 pl-8 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
        />
        {q && (
          <button onClick={() => setQ("")} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
            <XIcon className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {open && q && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute mt-2 w-full bg-white rounded-2xl shadow-lg border border-gray-100 z-40 max-h-80 overflow-y-auto scrollbar-thin">
            {results.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">نتیجه‌ای پیدا نشد.</p>
            ) : (
              <ul className="divide-y divide-gray-50">
                {results.map((r) => (
                  <li key={`${r.type}-${r.id}`}>
                    <Link
                      href={r.href}
                      onClick={() => setOpen(false)}
                      className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-gray-50"
                    >
                      <span className="text-gray-700">{r.title}</span>
                      <span className="text-xs text-gray-400">{r.type}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
