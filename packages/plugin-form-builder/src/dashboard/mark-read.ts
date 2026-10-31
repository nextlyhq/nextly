/**
 * Marking a submission read when it is opened from the New form submissions
 * card: the status the submissions list sets, through the same collection
 * update the list's own status changes are sent through, as the reader.
 *
 * Sent as an update of the submissions that match the id AND are still new,
 * so a submission someone archived, flagged or read since the card loaded is
 * matched by nothing and keeps its status. The update is judged as every
 * update of the collection is (`update-<slug>` and its rule): a reader who
 * may not update submissions is refused, and the submission stays new.
 *
 * @module dashboard/mark-read
 */

import { NEW_STATUS } from "./new-submissions";

/** The status an opened submission moves to, as the submissions list names it. */
const READ_STATUS = "read";

/** The admin's API root, which the submissions list sends its updates to. */
const ADMIN_API = "/admin/api";

/** The request that marks submission `id` of `collection` read while it is still new. */
export function markReadRequest(
  collection: string,
  id: string
): { url: string; init: RequestInit } {
  return {
    url: `${ADMIN_API}/collections/${encodeURIComponent(collection)}/entries`,
    init: {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      // The row's link navigates away at once; kept alive, the update is
      // still sent when that navigation leaves the page.
      keepalive: true,
      body: JSON.stringify({
        where: { id: { equals: id }, status: { equals: NEW_STATUS } },
        data: { status: READ_STATUS },
      }),
    },
  };
}

/**
 * Marks submission `id` read, without waiting for the answer. A refusal or a
 * failed request leaves it new, which the card and the list then still say.
 */
export function markRead(collection: string, id: string): void {
  const { url, init } = markReadRequest(collection, id);
  void fetch(url, init).catch(() => undefined);
}
