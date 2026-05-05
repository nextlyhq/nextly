import { cn } from "@admin/lib/utils";

/**
 * Small uppercase pill rendered in the success state of the
 * SeedDemoContentCard ("3 Roles", "12 Posts", "14/14 Media", etc.).
 *
 * `tone="warning"` flips the chip to amber for partially-failed
 * counts (e.g., "12/14 Media" when 2 files failed to upload).
 */
export function StatChip({
  count,
  label,
  tone = "neutral",
}: {
  count: number | string;
  label: string;
  tone?: "neutral" | "warning";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.15em] rounded-none",
        // Warning chips use a dashed hairline + muted-foreground tone
        // instead of the previous amber flood. Subtle enough to scan
        // past at a glance, distinct enough to find the partial-success
        // signal without colour blast. Matches the brutalist edge.
        tone === "neutral"
          ? "bg-primary/[0.04] border border-primary/[0.08] text-foreground"
          : "bg-primary/[0.04] border border-dashed border-primary/[0.18] text-muted-foreground"
      )}
    >
      <strong
        className={
          tone === "warning" ? "text-foreground/80" : "text-foreground"
        }
      >
        {count}
      </strong>
      <span className="font-bold opacity-70">{label}</span>
    </span>
  );
}
