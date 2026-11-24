/**
 * Saying something to assistive technology from the history screens: a restore, and its undo,
 * which a sighted person sees in a toast. Said through the history's own polite status region
 * (`lib/announce`), so what a screen reader hears does not depend on the toast.
 *
 * @module components/features/versions/announce
 */

import { announcerAt } from "@admin/lib/announce";

/** The id of the one region history announces through. */
export const HISTORY_ANNOUNCER_ID = "nextly-history-announcer";

/**
 * Says `message` politely to assistive technology, the same message twice in a row told apart
 * so it is read again.
 */
export const announce = announcerAt(HISTORY_ANNOUNCER_ID);
