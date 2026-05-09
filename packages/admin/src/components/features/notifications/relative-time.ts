// F10 PR 5 — minimal relative-time formatter for journal rows.
//
// Why local instead of `Intl.RelativeTimeFormat`: the dropdown needs
// 5-second precision near "now" and a graceful fallback to absolute
// dates after 24h. Intl.RelativeTimeFormat doesn't pick the right
// unit automatically; rolling our own keeps the logic + tests
// self-contained and readable.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function formatRelativeTime(
  iso: string,
  nowFn: () => number = Date.now
): string {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return iso;
  const diff = nowFn() - ts;

  if (diff < 0) return "just now";
  if (diff < 5_000) return "just now";
  if (diff < MINUTE) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d ago`;

  // Older than a week — render an absolute short date for clarity.
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
