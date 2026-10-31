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
    meta?: { hidden?: Array<{ count: number }> };
  }>(`/${encodeURIComponent(mediaId)}/usage${query}`);
  return {
    items: body.items,
    hidden: (body.meta?.hidden ?? []).reduce(
      (sum, scope) => sum + scope.count,
      0
    ),
  };
}

/** Delete items so the delete can be undone for a few seconds. */
export function deleteMediaLater(
  ids: readonly string[]
): Promise<PendingMediaDelete> {
  return mediaJson<PendingMediaDelete>("/deletions", jsonPost({ ids }));
}

/** Bring back items deleted inside the window. */
export function undoMediaDelete(
  ids: readonly string[]
): Promise<UndoneMediaDelete> {
  return mediaJson<UndoneMediaDelete>("/deletions/undo", jsonPost({ ids }));
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
