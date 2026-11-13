/**
 * Where the editor keeps the author's own choices in this browser: the
 * shell's panels, device and zoom, and whether the getting-started card was
 * dismissed. Each is kept under the author's own key, so two authors of one
 * browser each keep their own, and through the admin's preference store,
 * never the browser's storage directly: that store holds the site's switch
 * that keeps nothing on the device, and forgets the author on sign-out.
 *
 * @module editor-preference-stores
 */
import type { PreferenceStore } from "@nextlyhq/builder";
import {
  CHECKLIST_STORAGE_KEY,
  userPreferenceStore,
} from "@nextlyhq/builder/shell";
import { devicePreferenceStore } from "@nextlyhq/plugin-sdk/admin";

/**
 * Where the shell keeps this author's panel, device and zoom: their record,
 * and the one kept before records were per author, are both opened through
 * the admin's store. While no one is known it keeps nothing; the shell moves
 * to the author's store once their id arrives.
 */
export function shellPreferenceStore(userId: string | null): PreferenceStore {
  // With no author the shell's own answer is a store that keeps nothing, and
  // the admin's store is not opened at all, as for the other stores here.
  return userId === null
    ? userPreferenceStore(null)
    : userPreferenceStore(userId, devicePreferenceStore);
}

/**
 * Where the getting-started card's dismissal is kept: under the author's own
 * key, so dismissing it is one author's choice in a browser two people share.
 * With no author known there is none, and the editor offers no card.
 */
export function checklistStoreFor(
  userId: string | null
): PreferenceStore | undefined {
  return userId === null
    ? undefined
    : devicePreferenceStore(`${CHECKLIST_STORAGE_KEY}:${userId}`);
}
