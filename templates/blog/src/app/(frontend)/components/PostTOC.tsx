import type { TocEntry } from "@/lib/extract-toc";

/**
 * PostTOC - table of contents for a post, rendered as a collapsible
 * `<details>` above the article body.
 *
 * Server component: takes a pre-computed TocEntry[] and renders
 * anchor links. Open by default via the `open` attribute - users who
 * want a tighter read can collapse it. H3 entries get a left-indent
 * so the nesting is legible without a nested list.
 *
 * Clicking an anchor scrolls smoothly (CSS `scroll-behavior: smooth`
 * in globals.css; honored unless prefers-reduced-motion is set).
 */

interface PostTOCProps {
  toc: TocEntry[];
}

export function PostTOC({ toc }: PostTOCProps) {
  if (toc.length === 0) return null;

  return (
    <details
      open
      className="mb-12 rounded-lg border p-6"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-bg)",
      }}
    >
      <summary
        className="cursor-pointer text-[10px] font-bold uppercase tracking-[0.2em] transition-opacity hover:opacity-70"
        style={{ color: "var(--color-fg-muted)" }}
      >
        On this page
      </summary>
      <ol className="mt-6 flex flex-col gap-2.5 list-none">
        {toc.map(entry => (
          <li key={entry.id} className={entry.level === 3 ? "ml-4" : ""}>
            <a
              href={`#${entry.id}`}
              className="text-sm font-medium transition-all hover:pl-1"
              style={{ color: "var(--color-fg)" }}
            >
              {entry.text}
            </a>
          </li>
        ))}
      </ol>
    </details>
  );
}
