import Link from "next/link";

export interface IdentityStatementDto {
  id: string;
  text: string;
  evidence: string;
  strength: number;
}

/**
 * Renders a list of identity statements (see src/lib/identity.ts) as tappable links — each one's
 * `evidence` is a route to the real data behind it. Renders nothing when the list is empty rather
 * than showing an empty section; callers fetch /api/identity themselves and pass down as many
 * statements as their layout wants (e.g. .slice(0, 3)).
 */
export default function IdentityStatements({
  statements,
  className = "space-y-1.5",
  itemClassName = "block text-sm text-gray-700 hover:text-brand-700 transition",
}: {
  statements: IdentityStatementDto[];
  className?: string;
  itemClassName?: string;
}) {
  if (statements.length === 0) return null;
  return (
    <div className={className}>
      {statements.map((s) => (
        <Link key={s.id} href={s.evidence} className={itemClassName}>
          {s.text}
        </Link>
      ))}
    </div>
  );
}
