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

import type {
  FieldDiff,
  FieldDisplay,
  ListItemDiff,
  RelationTarget,
  TextSegment,
  ValueFieldDiff,
  VersionDiff,
} from "nextly/api/versions-diff";

import { protectedApi } from "@admin/lib/api/protectedApi";
import type { ListResponse } from "@admin/lib/api/response-types";

// The diff wire types live in core (the engine produces them); re-exported here
// so admin components import them from the same place as the other version types.
export type {
  FieldDiff,
  FieldDisplay,
  ListItemDiff,
  RelationTarget,
  TextSegment,
  ValueFieldDiff,
  VersionDiff,
};

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
  /** Scope the listing to one locale's versions. Absent lists every locale. */
  locale?: string;
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

/**
 * The keepalive body ceiling browsers enforce, in bytes. Measured on the
 * encoded body rather than string length, because a snapshot is user text and
 * a multi-byte character costs more bytes than it does UTF-16 code units.
 */
const KEEPALIVE_MAX_BYTES = 60_000;

function withinKeepaliveLimit(snapshot: Record<string, unknown>): boolean {
  try {
    return (
      new TextEncoder().encode(JSON.stringify(snapshot)).length <=
      KEEPALIVE_MAX_BYTES
    );
  } catch {
    // A snapshot that will not serialize cannot be sized; let the ordinary
    // request path raise the real failure rather than guessing here.
    return false;
  }
}

/**
 * What an autosave reports back: the canonical mutation envelope, whose item
 * is the stored row's metadata rather than the snapshot.
 */
export interface AutosaveResponse {
  message: string;
  item: { updatedAt: string; locale: string | null };
}

/** What a discard reports back: the live published document, now authoritative. */
export interface DiscardWorkingDraftResponse {
  message: string;
  item: Record<string, unknown>;
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
    // Only sent when a locale filter is active; absent lists every locale.
    if (params.locale !== undefined) search.set("locale", params.locale);

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

  /**
   * Discard a collection entry's pending working draft (draft/published split),
   * reverting the editor to the live published row. A DELETE on the sidecar
   * sub-resource; the response carries the live published document.
   *
   * Collection-only: the split gives a published document a separate draft head,
   * which a Single — one row, no published/draft pair — never has.
   */
  discardWorkingDraft: (
    scope: Extract<VersionScope, { kind: "collection" }>
  ): Promise<DiscardWorkingDraftResponse> =>
    protectedApi.delete<DiscardWorkingDraftResponse>(
      `${basePath(scope)}/working-draft`
    ),

  /**
   * Record the author's rolling recovery point for a document.
   *
   * PUT because it is idempotent by construction: the server keeps one autosave
   * row per document and author and rewrites it in place, so repeating this
   * leaves one row rather than accumulating history.
   *
   * The reply carries the canonical mutation envelope. Its `item` is metadata
   * only, never the snapshot: the caller already holds those values, and
   * echoing them back would be one more thing to keep in step with a form
   * somebody is still typing into. `updatedAt` is the server's own clock,
   * which is what the recovery read compares against the document.
   *
   * The snapshot goes up as-is and is stored unvalidated. An author part-way
   * through a required field still has work worth not losing, so a recovery
   * point is allowed to be incomplete; it records what they had rather than
   * claiming it is publishable.
   *
   * Applies to both scopes: a Single's autosave nests under its own history and
   * carries no entry id, which `basePath` already handles.
   */
  autosave: (
    scope: VersionScope,
    snapshot: Record<string, unknown>,
    opts: { locale?: string; keepalive?: boolean } = {}
  ): Promise<AutosaveResponse> => {
    // Only sent when a content language is active; absent means the
    // unlocalized row rather than "every locale".
    const query = opts.locale
      ? `?${new URLSearchParams({ locale: opts.locale }).toString()}`
      : "";
    // `keepalive` lets a request outlive the page that started it, which is
    // the only way a flush during unload survives. Browsers cap a keepalive
    // body at 64KB and REJECT anything larger, so an oversized snapshot falls
    // back to an ordinary request: that one may be cancelled with the page,
    // which is no worse than not attempting it, whereas sending it keepalive
    // would fail outright.
    const keepalive = opts.keepalive === true && withinKeepaliveLimit(snapshot);

    return protectedApi.put<AutosaveResponse>(
      `${basePath(scope)}/autosave${query}`,
      snapshot,
      keepalive ? { keepalive: true } : {}
    );
  },

  /**
   * The caller's own recovery point for a document, or null when they have
   * none.
   *
   * The only way a stored autosave can be read back: history listings exclude
   * autosave rows, and a version read addresses rows by the sequence number a
   * recovery point deliberately does not carry. Scoped to the calling author
   * server-side, since an autosave is unvalidated work belonging to one person.
   */
  getAutosave: (scope: VersionScope): Promise<VersionDetail | null> =>
    protectedApi.get<VersionDetail | null>(`${basePath(scope)}/autosave`),

  /**
   * Compare two versions. A read of history, gated and field-redacted exactly
   * like reading one version; both versions must share a locale. `from`/`to`
   * are ordered older -> newer by the caller.
   */
  diff: (
    scope: VersionScope,
    from: number,
    to: number,
    opts: { modifiedOnly?: boolean } = {}
  ): Promise<VersionDiff> => {
    const search = new URLSearchParams({
      from: String(from),
      to: String(to),
    });
    if (opts.modifiedOnly) search.set("modifiedOnly", "1");
    return protectedApi.get<VersionDiff>(
      `${basePath(scope)}/diff?${search.toString()}`
    );
  },
};
