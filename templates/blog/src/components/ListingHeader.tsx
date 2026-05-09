import Link from "next/link";

/**
 * ListingHeader - unified header pattern used across every
 * "list of posts" page: /blog, /categories/[slug], /tags/[slug],
 * /tags index, /categories index, /authors/[slug].
 *
 * Shape:
 *   Small uppercase label (optional) e.g. "Category", "Tag"
 *   Big H1 (the listing name)
 *   Description (optional)
 *   Stats row (optional): "24 posts · Latest: Mar 12 · RSS"
 *   Divider
 *
 * All pieces are optional so the same component serves both richly-
 * populated archives (Category page with description + stats) and
 * minimal ones (All tags index).
 */

export interface ListingHeaderStat {
  text: string;
  /** Optional link target. If provided, the stat renders as a link. */
  href?: string;
}

interface ListingHeaderProps {
  /** Small uppercase label above the title, e.g. "Category". */
  label?: string;
  /** The listing's main heading (category name, tag name, "All posts"). */
  title: string;
  /** Short description under the title. */
  description?: string;
  /** Stats row pieces. Rendered as "A · B · C" with a separator. */
  stats?: ListingHeaderStat[];
}

export function ListingHeader({
  label,
  title,
  description,
  stats,
}: ListingHeaderProps) {
  return (
    <header className="mb-12 md:mb-16">
      {label && (
        <div
          className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em]"
          style={{ color: "var(--color-accent)" }}
        >
          {label}
        </div>
      )}
      <h1
        className="text-3xl font-bold tracking-tightest-premium sm:text-5xl"
        style={{ color: "var(--color-fg)" }}
      >
        {title}
      </h1>
      {description && (
        <p
          className="mt-6 max-w-2xl text-base leading-relaxed sm:text-lg"
          style={{ color: "var(--color-fg-muted)" }}
        >
          {description}
        </p>
      )}
      {stats && stats.length > 0 && (
        <div
          className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] font-bold uppercase tracking-widest"
          style={{ color: "var(--color-fg-muted)" }}
        >
          {stats.map((stat, i) => (
            <span key={`${stat.text}-${i}`} className="flex items-center gap-4">
              {i > 0 && <span className="opacity-30">/</span>}
              {stat.href ? (
                <Link
                  href={stat.href}
                  className="transition-opacity hover:opacity-70"
                  style={{ color: "var(--color-accent)" }}
                >
                  {stat.text}
                </Link>
              ) : (
                <span>{stat.text}</span>
              )}
            </span>
          ))}
        </div>
      )}
      <div
        className="mt-10 h-px"
        style={{ background: "var(--color-border)" }}
      />
    </header>
  );
}
