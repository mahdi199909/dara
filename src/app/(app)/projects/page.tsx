"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { fetcher, apiPost } from "@/lib/apiClient";
import { Card, EmptyState } from "@/components/ui/Card";
import { PlusIcon } from "@/components/icons";
import { PROJECT_STATUS_LABELS, type ProjectStatus } from "@/lib/types";

export default function ProjectsPage() {
  const { data, mutate } = useSWR<{ projects: any[] }>("/api/projects", fetcher);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    try {
      await apiPost("/api/projects", { name, description: description || undefined });
      setName("");
      setDescription("");
      setShowForm(false);
      mutate();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 py-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-gray-800">پروژه‌ها</h1>
        <button onClick={() => setShowForm((v) => !v)} className="flex items-center gap-1 text-sm bg-brand-600 text-white px-3 py-2 rounded-xl hover:bg-brand-700">
          <PlusIcon className="w-4 h-4" />
          پروژه جدید
        </button>
      </div>

      {showForm && (
        <Card className="p-4">
          <form onSubmit={submit} className="space-y-3">
            <input autoFocus required value={name} onChange={(e) => setName(e.target.value)} placeholder="نام پروژه" className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" />
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="توضیحات (اختیاری)" rows={2} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm resize-none" />
            <button type="submit" disabled={loading} className="w-full rounded-xl bg-brand-600 text-white py-2 text-sm font-medium disabled:opacity-40">
              ثبت پروژه
            </button>
          </form>
        </Card>
      )}

      <div className="grid sm:grid-cols-2 gap-3">
        {data?.projects.map((p) => (
          <Link key={p.id} href={`/projects/detail?id=${p.id}`}>
            <Card className="p-4 h-full hover:shadow-md transition">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-gray-800">{p.name}</h3>
                <span className="text-xs bg-brand-50 text-brand-700 px-2 py-0.5 rounded-full">
                  {PROJECT_STATUS_LABELS[p.status as ProjectStatus]}
                </span>
              </div>
              {p.description && <p className="text-xs text-gray-400 mt-1.5 line-clamp-2">{p.description}</p>}
              <p className="text-xs text-gray-400 mt-3">{p._count?.tasks ?? 0} کار</p>
            </Card>
          </Link>
        ))}
        {data?.projects.length === 0 && <EmptyState message="هنوز پروژه‌ای ثبت نکرده‌اید." />}
      </div>
    </div>
  );
}
