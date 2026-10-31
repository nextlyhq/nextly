/**
 * The media library's own requests, beside the shared media client: the
 * counts beside the folders, where an item is used, a delete that can be
 * undone, and replacing an item's file. All on the gated `/admin/api/media`
 * surface, where the server checks each against the caller's permissions.
 */

import { mediaFetchJson } from "@admin/services/mediaApi";
import type { Media } from "@admin/types/media";

const MEDIA_BASE = "/admin/api/media";

/** The counts beside the folders. */
export interface MediaLibraryCounts {
  all: number;
  missingAltText: number;
  /** Items no document uses; `null` before the usage record exists. */
  unused: number | null;
  /**
   * Whether the usage record covers content written before it existed.
   * Until it does, the Unused view cannot be trusted and says so.
   */
  usageRecorded: boolean;
  /** Items in no folder. */
  root: number;
  /** Each folder's own items, by id; a folder with none is absent. */
  folders: Record<string, number>;
}

/** One field of a document that uses an item. */
export interface MediaUseField {
  path: string;
  /** The languages using it; empty when every language does. */
  locales: string[];
  /**
   * Whether it names the item by its address (rich text, an email
   * template's image), which keeps the old file when the file is replaced.
   */
  byAddress: boolean;
  /** Whether it still shows the file the item had before its last Replace. */
  showsPreviousFile: boolean;
}

/** One document that uses an item, as the reader may read it. */
export interface MediaUse {
  kind: "collection" | "single" | "email-template";
  slug: string;
  documentId: string;
  title: string;
  /** The collection's or Single's name, or "Email templates". */
  owner: string;
  fields: MediaUseField[];
}

/** Where an item is used: what the reader may open, and how many more. */
export interface MediaUsage {
  items: MediaUse[];
  /** Documents using the item that the reader may not open. */
  hidden: number;
  /**
   * Avatars and logos keeping the item's address, which a Replace keeps the
   * previous file for; asked only with the uses by address.
   */
  heldByAddress: number;
  /**
   * Whether the usage record has been built. Until it has, a Replace keeps
   * the previous file whatever the record lists, and an item listing no use
   * may still be used by older content. False when the answer does not say.
   */
  usageRecorded: boolean;
}

/** A delete that can be undone, as the server took it. */
export interface PendingMediaDelete {
  ids: string[];
  /** When the item is deleted for good, as an ISO instant. */
  deleteAfter: string;
}

/** What an Undo brought back, and what had already gone. */
export interface UndoneMediaDelete {
  restored: string[];
  gone: string[];
}

/** A request to the gated media surface, through the shared media client. */
function mediaJson<T>(path: string, init?: RequestInit): Promise<T> {
  return mediaFetchJson<T>(`${MEDIA_BASE}${path}`, init);
}

function jsonPost(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

/** Every folder's count and each view's, in one request. */
export function fetchMediaLibraryCounts(): Promise<MediaLibraryCounts> {
  return mediaJson<MediaLibraryCounts>("/counts");
}

/**
 * The documents using an item that the reader may open, and how many more;
 * with `byAddress`, only those naming it by its address.
 */
export async function fetchMediaUsage(
  mediaId: string,
  options: { byAddress?: boolean } = {}
): Promise<MediaUsage> {
  const query = options.byAddress ? "?byAddress=true" : "";
  const body = await mediaJson<{
    items: MediaUse[];
    meta?: {
      hidden?: Array<{ count: number }>;
      heldByAddress?: number;
      usageRecorded?: boolean;
    };
  }>(`/${encodeURIComponent(mediaId)}/usage${query}`);
  return {
    items: body.items,
    hidden: (body.meta?.hidden ?? []).reduce(
      (sum, scope) => sum + scope.count,
      0
    ),
    // Avatars and logos are counted only for the uses by address.
    heldByAddress: body.meta?.heldByAddress ?? 0,
    // Only an answer saying the record is built is taken as built: an answer
    // that says nothing of it may come before the record covers older
    // content, where an item listing no use may still be used.
    usageRecorded: body.meta?.usageRecorded === true,
  };
}

/**
 * The most items one delete or Undo request names: the server refuses more,
 * and marks or restores each request's items all or none.
 */
const DELETION_BATCH = 100;

/**
 * `ids` in runs of at most {@link DELETION_BATCH}; none as one empty run, so
 * the server answers it as it answers any request naming nothing.
 */
function deletionBatches(ids: readonly string[]): string[][] {
  if (ids.length === 0) return [[]];
  const batches: string[][] = [];
  for (let start = 0; start < ids.length; start += DELETION_BATCH) {
    batches.push(ids.slice(start, start + DELETION_BATCH));
  }
  return batches;
}

/**
 * Delete items so the delete can be undone for a few seconds. A selection
 * larger than one request takes is sent in batches, one after another, and
 * answered as one delete: every id, and the earliest batch's deadline, since
 * an Undo after it would find that batch already gone. When a later batch
 * fails, the batches already taken are brought back before the failure is
 * reported, so the selection is deleted whole or not at all; one that cannot
 * be brought back goes on with its window, as a delete of its own would.
 */
export async function deleteMediaLater(
  ids: readonly string[]
): Promise<PendingMediaDelete> {
  const taken: PendingMediaDelete[] = [];
  try {
    for (const batch of deletionBatches(ids)) {
      taken.push(
        await mediaJson<PendingMediaDelete>(
          "/deletions",
          jsonPost({ ids: batch })
        )
      );
    }
  } catch (error) {
    await Promise.allSettled(
      taken.map(done =>
        mediaJson<UndoneMediaDelete>(
          "/deletions/undo",
          jsonPost({ ids: done.ids })
        )
      )
    );
    throw error;
  }
  const deadlines = taken.map(done => done.deleteAfter);
  return {
    ids: taken.flatMap(done => done.ids),
    deleteAfter: deadlines.reduce((earliest, next) =>
      Date.parse(next) < Date.parse(earliest) ? next : earliest
    ),
  };
}

/**
 * Bring back items deleted inside the window, in batches as the delete was
 * sent, answered as one: every item brought back, and every one already gone.
 */
export async function undoMediaDelete(
  ids: readonly string[]
): Promise<UndoneMediaDelete> {
  const undone: UndoneMediaDelete = { restored: [], gone: [] };
  for (const batch of deletionBatches(ids)) {
    const answer = await mediaJson<UndoneMediaDelete>(
      "/deletions/undo",
      jsonPost({ ids: batch })
    );
    undone.restored.push(...answer.restored);
    undone.gone.push(...answer.gone);
  }
  return undone;
}

/** Replace an item's file, keeping the item; the item as it now is. */
export async function replaceMediaFile(
  mediaId: string,
  file: File
): Promise<Media> {
  const form = new FormData();
  form.append("file", file);
  const body = await mediaJson<{ item: Media }>(
    `/${encodeURIComponent(mediaId)}/replace`,
    { method: "POST", body: form }
  );
  return body.item;
}
