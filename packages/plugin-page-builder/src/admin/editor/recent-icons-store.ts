/**
 * Where the Icon control's Recent row is kept: in this browser, per signed-in
 * author, under its own storage key, so writing it never rewrites the shell's
 * preferences or the recent pages.
 *
 * @module recent-icons-store
 */
import { browserStore, type PreferenceStore } from "@nextlyhq/builder";

/** The storage key, one per user. */
const KEY = "nextly:page-builder:recent-icons";

/**
 * The store for one author, or none without one: a list kept for nobody in
 * particular would be read by the next author to sign in on this browser.
 */
export function recentIconsStore(
  userId: string | null
): PreferenceStore | undefined {
  return userId === null ? undefined : browserStore(`${KEY}:${userId}`);
}
