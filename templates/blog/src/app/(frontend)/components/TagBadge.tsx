import Link from "next/link";

interface TagBadgeProps {
  name: string;
  slug: string;
}

export function TagBadge({ name, slug }: TagBadgeProps) {
  return (
    <Link
      href={`/tags/${slug}`}
      className="inline-flex items-center rounded-none border px-3 py-1 text-[10px] font-bold uppercase tracking-widest transition-all hover:bg-[color:var(--color-fg)] hover:text-[color:var(--color-bg)]"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-bg)",
        color: "var(--color-fg-muted)",
      }}
    >
      {name}
    </Link>
  );
}
