export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-white rounded-2xl border border-gray-100 shadow-card transition-shadow ${className}`}>{children}</div>;
}

export function CardHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-5 pt-4 pb-2">
      <h3 className="font-bold text-gray-800 text-sm">{title}</h3>
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
    tone === "positive" ? "text-brand-700" : tone === "negative" ? "text-waste-600" : tone === "muted" ? "text-gray-400" : "text-gray-800";
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-gray-500">{label}</span>
      <span className={`text-base font-bold ${toneClass}`}>{value}</span>
      {extra}
    </div>
  );
}

export function EmptyState({ message, cta }: { message: string; cta?: React.ReactNode }) {
  return (
    <div className="text-center py-8 px-4">
      <p className="text-sm text-gray-400 mb-3">{message}</p>
      {cta}
    </div>
  );
}
