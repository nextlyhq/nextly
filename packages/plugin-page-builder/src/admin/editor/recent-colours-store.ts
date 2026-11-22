/**
 * Where an author's Recent colours are kept: in this browser, per signed-in
 * author, under its own storage key, so writing it never rewrites the shell's
 * preferences, the recent icons or the recent pages, and never the site.
 *
 * @module recent-colours-store
 */
import type { PreferenceStore } from "@nextlyhq/builder";
import { devicePreferenceStore } from "@nextlyhq/plugin-sdk/admin";

/** The storage key, one per user. */
const KEY = "nextly:page-builder:recent-colours";

/**
 * The store for one author, or none without one: a list kept for nobody in
 * particular would be read by the next author to sign in on this browser.
 * Kept through the admin's preference store, so the site's switch that keeps
 * nothing on the device holds for it, and signing out forgets it.
 */
export function recentColoursStore(
  userId: string | null
): PreferenceStore | undefined {
  return userId === null
    ? undefined
    : devicePreferenceStore(`${KEY}:${userId}`);
}
