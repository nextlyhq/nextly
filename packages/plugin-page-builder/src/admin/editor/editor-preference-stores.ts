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

/**
 * Where the Design panel's folded groups are kept: under the author's own
 * key, so a group one author folds stays folded for them on this site
 * across reloads, and another author's panel opens as they left it. With no
 * author known there is none, and every group opens.
 */
export function designFoldsStoreFor(
  userId: string | null
): PreferenceStore | undefined {
  return userId === null
    ? undefined
    : devicePreferenceStore(`nx-pb-design-folds:${userId}`);
}

/**
 * Where the Pages panel's folded groups are kept: under the author's own
 * key, as the Design panel's are, so "Pages", "Header & footer" and
 * "Collection templates" open as that author left them on this site.
 */
export function pagesFoldsStoreFor(
  userId: string | null
): PreferenceStore | undefined {
  return userId === null
    ? undefined
    : devicePreferenceStore(`nx-pb-pages-folds:${userId}`);
}

/**
 * Where the author's insert counts are kept, which the in-place picker reads
 * its six most used blocks from: under the author's own key, so one person's
 * habits are what "most used" means to them. With no author known there is
 * none, and the picker shows the default six.
 */
export function insertCountsStoreFor(
  userId: string | null
): PreferenceStore | undefined {
  return userId === null
    ? undefined
    : devicePreferenceStore(`nx-pb-insert-counts:${userId}`);
}
