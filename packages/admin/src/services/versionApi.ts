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
  GroupFieldDiff,
  ListItemDiff,
  RelationTarget,
  ComparableStatus,
  RichTextAttrChange,
  RichTextBlockDiff,
  RichTextFieldDiff,
  SetFieldDiff,
  SourceFieldDiff,
  SourceLineDiff,
  TextFieldDiff,
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
  GroupFieldDiff,
  ListItemDiff,
  RelationTarget,
  ComparableStatus,
  RichTextAttrChange,
  RichTextBlockDiff,
  RichTextFieldDiff,
  SetFieldDiff,
  SourceFieldDiff,
  SourceLineDiff,
  TextFieldDiff,
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

/**
 * Who or what history credits a version or an event to: a person, an API key
 * (by its own name), a plugin's own kind of person, a release, the system, or
 * an agent.
 */
export type HistoryActorKind =
  | "person"
  | "apiKey"
  | "principal"
  | "release"
  | "system"
  | "agent";

/**
 * Display identity of whoever wrote a version. The system has no id, and a
 * version recorded before actors were recorded carries no kind.
 */
export interface VersionAuthor {
  kind?: HistoryActorKind;
  id: string | null;
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
export type VersionDetail = VersionMeta & {
  snapshot: unknown;
  /**
   * What the read rules held back from this reader: top-level field names, and
   * dotted paths below them (`banner.secret`). A field named here was withheld,
   * not absent from the version.
   */
  withheld: string[];
};

export type VersionListResponse = ListResponse<VersionMeta>;

/**
 * One thing that happened to a document, from its record of events: a save, a
 * publish or a withdrawal, a restore, a naming, older versions removed.
 *
 * `parts` names what it applied to: language codes, and `~shared` for the
 * fields every language shares. `versionNo` is the version it produced, when
 * it produced one.
 */
export interface DocumentEvent {
  id: string;
  kind: string;
  actorKind: HistoryActorKind;
  actorId: string | null;
  actorName: string | null;
  occurredAt: string;
  fromState: string | null;
  toState: string | null;
  note: string | null;
  versionNo: number | null;
  payload: Record<string, unknown> | null;
  parts: string[];
}

export type DocumentEventListResponse = ListResponse<DocumentEvent>;

export interface ListDocumentEventsParams {
  /** At most this many, 1 to 100. */
  limit?: number;
  /** Only events older than this one: the last item's id, for the next page. */
  before?: string;
}

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

/** What marking a version as seen reports back: the version and its part. */
export interface MarkVersionSeenResponse {
  message: string;
  item: { versionNo: number; locale: string | null };
}

/** Base path for a scope's history. */
/** The document a scope names, which its history and events sit under. */
function documentPath(scope: VersionScope): string {
  return scope.kind === "single"
    ? `/singles/${scope.slug}`
    : `/collections/${scope.slug}/entries/${scope.entryId}`;
}

function basePath(scope: VersionScope): string {
  return `${documentPath(scope)}/versions`;
}

/**
 * What recording a recovery point reports back.
 *
 * `updatedAt` is when the server stored it, not when the editor sent it, so a
 * "saved at" reading cannot drift with an unsynchronised browser clock.
 * Serialised as an ISO string over the wire; the caller parses it if it needs a
 * `Date`.
 */
export interface AutosaveWriteResponse {
  updatedAt: string;
  locale: string | null;
}

/**
 * A stored recovery point as the reading author sees it.
 *
 * Deliberately narrower than the stored row. A recovery point is offered back
 * to its own author to restore, so the fields that describe a version's place
 * in history (its number, its label, its lineage) have no meaning here: an
 * autosave carries none of them.
 */
export interface AutosaveDetail {
  snapshot: unknown;
  updatedAt: string;
  locale: string | null;
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

/** What a discard reports back: the live published document, now authoritative. */
export interface DiscardWorkingDraftResponse {
  message: string;
  item: Record<string, unknown>;
}

export const versionApi = {
  /**
   * A page of the document's events, newest first. The next page passes the
   * last item's id as `before`.
   *
   * @experimental
   */
  events: (
    scope: VersionScope,
    params: ListDocumentEventsParams = {}
  ): Promise<DocumentEventListResponse> => {
    const search = new URLSearchParams();
    if (params.limit !== undefined) search.set("limit", String(params.limit));
    if (params.before !== undefined) search.set("before", params.before);
    const query = search.toString();
    return protectedApi.get<DocumentEventListResponse>(
      `${documentPath(scope)}/events${query ? `?${query}` : ""}`
    );
  },
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
  /**
   * Record that the signed-in person was shown this version, which moves where
   * a later comparison "since you last looked" starts from.
   *
   * Sent once for each version shown, never for the history list: reading a
   * list of versions is not reading any one of them.
   */
  markSeen: (
    scope: VersionScope,
    versionNo: number
  ): Promise<MarkVersionSeenResponse> =>
    protectedApi.put<MarkVersionSeenResponse>(
      `${basePath(scope)}/${versionNo}/seen`,
      {}
    ),

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
   * A localized document holds one pending change per language, so the locale
   * names which one is being thrown away and which language's live values come
   * back. Omitting it means the request names no language, which the server
   * resolves to the default — the ordinary path when editing that language.
   *
   * Both scopes, sharing `basePath`. A Single's URL carries no document id: the
   * server resolves it from the live row rather than trusting the client.
   */
  discardWorkingDraft: (
    scope: VersionScope,
    locale?: string | null
  ): Promise<DiscardWorkingDraftResponse> => {
    const search = new URLSearchParams();
    if (locale) search.set("locale", locale);
    const query = search.toString();

    return protectedApi.delete<DiscardWorkingDraftResponse>(
      `${basePath(scope)}/working-draft${query ? `?${query}` : ""}`
    );
  },

  /**
   * Record the editor's current values as this author's recovery point.
   *
   * PUT rather than POST because the row is rolling: one per document and
   * author, rewritten in place. Sending the same snapshot twice must leave one
   * recovery point, which is what makes an unacknowledged retry safe.
   *
   * The snapshot is the editor's live values, so it can contain fields the
   * document itself does not yet have. The server strips write-only values
   * before storing and redacts on read; neither is the client's job.
   */
  saveAutosave: (
    scope: VersionScope,
    snapshot: unknown,
    locale?: string | null
  ): Promise<AutosaveWriteResponse> => {
    // The BODY IS THE SNAPSHOT, and the locale rides in the query string.
    //
    // Wrapping the values in `{ snapshot }` stores that envelope AS the
    // snapshot, so every field ends up one level too deep and a restore writes
    // an object with no field names the form recognises. The locale is read
    // from the request params, so a body-carried one is silently ignored.
    const search = new URLSearchParams();
    if (locale) search.set("locale", locale);
    const query = search.toString();

    return protectedApi.put<AutosaveWriteResponse>(
      `${basePath(scope)}/autosave${query ? `?${query}` : ""}`,
      snapshot
    );
  },

  /**
   * This author's own recovery point, or `null` when they have none.
   *
   * Scoped to the caller: it never returns another author's snapshot, so a
   * document being edited by two people yields each of them their own. The
   * response is private to the session and must not be cached across users.
   */
  getAutosave: (scope: VersionScope): Promise<AutosaveDetail | null> =>
    protectedApi.get<AutosaveDetail | null>(`${basePath(scope)}/autosave`),

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
