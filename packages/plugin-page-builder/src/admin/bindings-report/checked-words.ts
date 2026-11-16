/**
 * When the report was last checked, as the surfaces say it: "Checked 4
 * minutes ago", "Checking…" while a check of every document runs, or "Not
 * checked yet" before the first one completes.
 *
 * @module admin/bindings-report/checked-words
 */
import type { BindingsToFixMeta } from "../../bindings-report/contract";

const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** How long ago `at` was, in the largest whole unit that fits. */
function ago(at: Date, now: Date): string {
  const seconds = Math.round((at.getTime() - now.getTime()) / 1000);
  const minutes = Math.round(seconds / 60);
  const hours = Math.round(minutes / 60);
  const days = Math.round(hours / 24);
  if (Math.abs(seconds) < 60) return "just now";
  if (Math.abs(minutes) < 60) return RELATIVE.format(minutes, "minute");
  if (Math.abs(hours) < 24) return RELATIVE.format(hours, "hour");
  return RELATIVE.format(days, "day");
}

/** The words for the report's freshness. */
export function checkedWords(
  meta: Pick<BindingsToFixMeta, "checkedAt" | "checking">,
  now: Date = new Date()
): string {
  if (meta.checking) return "Checking every page…";
  if (meta.checkedAt === null) return "Not checked yet";
  return `Checked ${ago(new Date(meta.checkedAt), now)}`;
}
