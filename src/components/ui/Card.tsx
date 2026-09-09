export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-surface rounded-2xl border border-line shadow-card transition-shadow ${className}`}>{children}</div>;
}

export function CardHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-5 pt-4 pb-2">
      <h3 className="font-bold text-ink text-sm">{title}</h3>
      {action}
    </div>
  );
}

export function StatItem({
  label,
  value,
  tone = "default",
  extra,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "default" | "positive" | "negative" | "muted";
  extra?: React.ReactNode;
}) {
  const toneClass =
    tone === "positive" ? "text-accent" : tone === "negative" ? "text-waste" : tone === "muted" ? "text-muted" : "text-ink";
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted">{label}</span>
      <span className={`text-base font-bold ${toneClass}`}>{value}</span>
      {extra}
    </div>
  );
}

export function EmptyState({ message, cta }: { message: string; cta?: React.ReactNode }) {
  return (
    <div className="text-center py-8 px-4">
      <p className="text-sm text-muted mb-3">{message}</p>
      {cta}
    </div>
  );
}
