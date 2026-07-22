/**
 * Version history wire types and fetchers.
 *
 * Mirrors the server surface in `packages/nextly/src/dispatcher/handlers/
 * versions-methods.ts`. History nests under the document it belongs to, so the
 * URL carries the document's identity and the permission that guards reading
 * the document guards its history too.
 *
 * @module services/versionApi
 */

import { protectedApi } from "@admin/lib/api/protectedApi";
import type { ListResponse } from "@admin/lib/api/response-types";

/**
 * Which document's history to read.
 *
 * A Single's URL carries no entry id: it has exactly one document, and the
 * server resolves its id from the live row rather than trusting the client.
 */
export type VersionScope =
  | { kind: "collection"; slug: string; entryId: string }
  | {
      kind: "single";
      slug: string;
      /**
       * The live document's id. Not sent — the server resolves it itself — but
       * carried so a client cache can tell one incarnation of a Single from a
       * recreated one.
       */
      documentId: string;
    };

/** Display identity of whoever wrote a version. */
export interface VersionAuthor {
  id: string;
  name: string | null;
}

/** One version's metadata. Snapshots are never included in a list. */
export interface VersionMeta {
  id: string;
  versionNo: number | null;
  status: string;
  isAutosave: boolean;
  label: string | null;
  locale: string | null;
  sourceVersionNo: number | null;
  createdBy: string | null;
  author: VersionAuthor | null;
  createdAt: string;
  updatedAt: string;
}

/** One version including the stored document. */
export type VersionDetail = VersionMeta & { snapshot: unknown };

export type VersionListResponse = ListResponse<VersionMeta>;

export interface ListVersionsParams {
  limit?: number;
  /**
   * Keyset cursor: the `versionNo` to read backwards from. Not an offset and
   * not an opaque token.
   */
  cursor?: number;
}

/** Base path for a scope's history. */
function basePath(scope: VersionScope): string {
  return scope.kind === "single"
    ? `/singles/${scope.slug}/versions`
    : `/collections/${scope.slug}/entries/${scope.entryId}/versions`;
}

/** What a restore reports back. */
export interface RestoreVersionResponse {
  message: string;
  restoredFrom: number;
  /**
   * Snapshot keys the current schema no longer accepts. A restore with a
   * non-empty list succeeded but did not bring the document back in full.
   */
  droppedFields: string[];
}

/** What a rename reports back: the version's metadata, without its snapshot. */
export interface SetVersionLabelResponse {
  message: string;
  item: VersionMeta;
}

export const versionApi = {
  list: (
    scope: VersionScope,
    params: ListVersionsParams = {}
  ): Promise<VersionListResponse> => {
    const search = new URLSearchParams();
    if (params.limit !== undefined) search.set("limit", String(params.limit));
    // Only sent when paging: the server rejects a non-positive-integer cursor,
    // so an absent one must stay absent rather than become "undefined".
    if (params.cursor !== undefined)
      search.set("cursor", String(params.cursor));

    const query = search.toString();
    return protectedApi.get<VersionListResponse>(
      `${basePath(scope)}${query ? `?${query}` : ""}`
    );
  },

  get: (scope: VersionScope, versionNo: number): Promise<VersionDetail> =>
    protectedApi.get<VersionDetail>(`${basePath(scope)}/${versionNo}`),

  /**
   * Put the document back to an earlier version. A write, not a read: the
   * server resubmits the stored snapshot through the ordinary update path and
   * records the result as a new version.
   */
  restore: (
    scope: VersionScope,
    versionNo: number
  ): Promise<RestoreVersionResponse> =>
    protectedApi.post<RestoreVersionResponse>(
      `${basePath(scope)}/${versionNo}/restore`,
      {}
    ),

  /**
   * Name a version, or clear its name with `null`.
   *
   * A PATCH on the version itself rather than a nested action, because it is
   * idempotent: sending the same name twice leaves the same state. The server
   * trims and bounds the value, so the client's own trim is a courtesy.
   */
  setLabel: (
    scope: VersionScope,
    versionNo: number,
    label: string | null
  ): Promise<SetVersionLabelResponse> =>
    protectedApi.patch<SetVersionLabelResponse>(
      `${basePath(scope)}/${versionNo}`,
      { label }
    ),
};
