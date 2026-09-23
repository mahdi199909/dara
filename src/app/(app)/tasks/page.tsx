"use client";

import { useState } from "react";
import useSWR from "swr";
import { fetcher, apiPost, apiPatch, apiDelete } from "@/lib/apiClient";
import { useCategories, useProjects } from "@/lib/hooks";
import { Card, EmptyState } from "@/components/ui/Card";
import { TrashIcon, PlusIcon } from "@/components/icons";
import JalaliDateInput from "@/components/ui/JalaliDateInput";
import CategoryChipPicker, { selectableCategories } from "@/components/CategoryChipPicker";
import { formatJalali } from "@/lib/jalali";
import { formatDuration, signed } from "@/lib/money";
import { TASK_STATUS_LABELS, type TaskStatus } from "@/lib/types";
import { useCurrencyUnit } from "@/lib/currencyUnit";

const STATUS_TABS: { value: TaskStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "همه" },
  { value: "TODO", label: "انجام‌نشده" },
  { value: "DONE", label: "انجام‌شده" },
];

export default function TasksPage() {
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "ALL">("ALL");
  const { data, mutate } = useSWR<{ tasks: any[] }>(
    statusFilter === "ALL" ? "/api/tasks" : `/api/tasks?status=${statusFilter}`,
    fetcher
  );
  const { categories } = useCategories();
  const { projects } = useProjects();
  const [showForm, setShowForm] = useState(false);
  const { format } = useCurrencyUnit();

  async function toggleStatus(task: any) {
    await apiPatch(`/api/tasks/${task.id}`, { status: task.status === "DONE" ? "TODO" : "DONE" });
    mutate();
  }

  async function remove(id: string) {
    await apiDelete(`/api/tasks/${id}`);
    mutate();
  }

  return (
    <div className="px-4 py-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-ink">کارها</h1>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1 text-sm bg-accent text-on-accent px-3 py-2 rounded-xl hover:opacity-90"
        >
          <PlusIcon className="w-4 h-4" />
          کار جدید
        </button>
      </div>

      {showForm && (
        <NewTaskForm
          categories={categories}
          projects={projects}
          onDone={() => {
            setShowForm(false);
            mutate();
          }}
        />
      )}

      <div className="flex gap-2 overflow-x-auto scrollbar-thin pb-1">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={`shrink-0 text-sm px-3.5 py-1.5 rounded-full transition ${
              statusFilter === tab.value ? "bg-accent text-on-accent" : "bg-surface border border-line text-muted"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <Card>
        {!data ? (
          <p className="text-sm text-muted text-center py-8">در حال بارگذاری...</p>
        ) : data.tasks.length === 0 ? (
          <EmptyState message="هنوز کاری ثبت نکرده‌اید." />
        ) : (
          <ul className="divide-y divide-line">
            {data.tasks.map((task) => (
              <li key={task.id} className="flex items-center gap-3 px-4 py-3">
                <button
                  onClick={() => toggleStatus(task)}
                  className={`w-5 h-5 rounded-md border shrink-0 flex items-center justify-center transition ${
                    task.status === "DONE" ? "bg-accent border-accent text-on-accent" : "border-line"
                  }`}
                >
                  {task.status === "DONE" && "✓"}
                </button>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm truncate ${task.status === "DONE" ? "line-through text-muted" : "text-ink"}`}>
                    {task.title}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5 text-xs text-muted">
                    {task.category && <span>{task.category.icon} {task.category.name}</span>}
                    {task.project && <span>· {task.project.name}</span>}
                    {task.dueDate && <span>· سررسید {formatJalali(new Date(task.dueDate))}</span>}
                    {task.startAt && task.endAt && (
                      <span>· {formatDuration(Math.round((new Date(task.endAt).getTime() - new Date(task.startAt).getTime()) / 60000))}</span>
                    )}
                    {task.directCost > 0 && <span className="text-waste">· {format(task.directCost, { withSuffix: true })}</span>}
                    {task.incomeAmount > 0 && <span className="text-accent">· {signed("+", format(task.incomeAmount, { withSuffix: true }))}</span>}
                    {!STATUS_TABS.find((t) => t.value === task.status) ? null : task.status !== "DONE" && (
                      <span className="text-accent">· {TASK_STATUS_LABELS[task.status as TaskStatus]}</span>
                    )}
                  </div>
                </div>
                <button onClick={() => remove(task.id)} className="text-muted hover:text-waste p-1">
                  <TrashIcon className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function NewTaskForm({ categories, projects, onDone }: { categories: any[]; projects: any[]; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [dueDate, setDueDate] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setLoading(true);
    try {
      await apiPost("/api/tasks", {
        title,
        categoryId: categoryId || undefined,
        projectId: projectId || undefined,
        dueDate: dueDate ? dueDate.toISOString() : undefined,
      });
      onDone();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="p-4">
      <form onSubmit={submit} className="space-y-3">
        <input
          autoFocus
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="عنوان کار"
          className="bg-surface w-full rounded-xl border border-line px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
        />
        <div>
          <p className="text-xs text-muted mb-1.5">دسته‌بندی (اختیاری)</p>
          <CategoryChipPicker
            categories={selectableCategories(categories)}
            selectedId={categoryId || null}
            allowClear
            onPick={(c) => {
              setCategoryId(c?.id ?? "");
              // A project's own category also tags the task to that project (same as Quick Capture).
              if (c?.projectId) setProjectId(c.projectId);
            }}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="bg-surface rounded-xl border border-line px-2 py-2 text-sm">
            <option value="">پروژه</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {dueDate ? (
            <div className="relative">
              <JalaliDateInput value={dueDate} onChange={setDueDate} className="pl-6 text-sm" />
              <button
                type="button"
                onClick={() => setDueDate(null)}
                aria-label="حذف سررسید"
                className="absolute left-1.5 top-1/2 -translate-y-1/2 text-muted hover:text-ink text-xs w-4 h-4 flex items-center justify-center"
              >
                ×
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setDueDate(new Date())}
              className="rounded-xl border border-line px-2 py-2 text-sm text-muted hover:bg-canvas"
            >
              + سررسید
            </button>
          )}
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-accent text-on-accent py-2 text-sm font-medium hover:opacity-90 disabled:opacity-40"
        >
          ثبت کار
        </button>
      </form>
    </Card>
  );
}
