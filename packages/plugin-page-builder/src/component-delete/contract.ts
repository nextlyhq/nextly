/**
 * What the delete dialog and the component delete routes say to each other.
 *
 * Isomorphic: the dialog imports it, so it carries types and constants only.
 *
 * ## The calls
 *
 * - `POST /components/:id/delete` with `{ "dryRun": true }`: what deleting it
 *   would do, changing nothing, and whether a delete is open already.
 * - `POST /components/:id/delete` with `{}`: start the delete, or carry the
 *   caller's own on by one step. The dialog calls it again until the status
 *   is no longer `preflight` or `running`; closing the dialog pauses the
 *   delete, and calling again resumes it.
 * - `GET /components/:id/delete`: the open delete's progress, changing
 *   nothing.
 *
 * ## The statuses, and the dialog state each one is
 *
 * - `none`: nothing uses it; the delete removes it at once.
 * - `used`: it is used; the delete turns each copy into plain blocks first.
 * - `refused`: it cannot be deleted as things stand: a Layout uses it
 *   (`layouts`), or a host cannot be converted (`left`). Nothing changed.
 * - `preflight`, `running`: the delete is under way (`run.yours` false: it
 *   is somebody else's).
 * - `partly-done`: every host it could convert was converted; the ones in
 *   `left` were not, so the component is kept. Starting again picks up there.
 * - `done`: the component was deleted.
 * - `idle`: no delete is open (GET only).
 *
 * A caller without the right to delete components is answered with
 * `mayDelete: false` on a dry run, and refused (403) when starting.
 *
 * @module component-delete/contract
 * @experimental Settles when the delete dialog ships.
 */

/** Where the routes answer, under the plugin's namespace. */
export const COMPONENT_DELETE_ROUTE_PATH = "/components/:id/delete";

/** The status a call answers with. */
export type ComponentDeleteStatus =
  | "none"
  | "used"
  | "refused"
  | "preflight"
  | "running"
  | "partly-done"
  | "done"
  | "idle";

/** One document named to the caller: one they may read. */
export interface NamedDocument {
  /** A collection entry, or a Single. */
  readonly kind: "collection" | "single";
  /** The collection's or the Single's slug. */
  readonly slug: string;
  /** The entry's id; absent for a Single. */
  readonly id?: string;
  /** What the document is called, as the caller reads it. */
  readonly title: string;
}

/**
 * Documents, as the caller may see them: the ones they may read are named,
 * the rest only counted.
 */
export interface DocumentList {
  readonly named: readonly NamedDocument[];
  /** How many the caller may not read, so are not named. */
  readonly unreadable: number;
  /** How many more there are than the list names. */
  readonly more: number;
}

/**
 * Why a document was, or would be, left as it is. See `LeftReason` in
 * `host-rewrite/contract`, whose values these are.
 */
export type LeftDocumentReason =
  | "refused"
  | "pending-draft"
  | "not-permitted"
  | "unreadable"
  | "unaddressable"
  | "changed"
  | "write-refused"
  | "layout";

/** One document left as it is, with why, in words an author can act on. */
export interface LeftDocument {
  /** The document, when the caller may read it; `null` otherwise. */
  readonly document: NamedDocument | null;
  readonly reason: LeftDocumentReason;
  readonly words: string;
}

/** What deleting would do, as the dry run judges it. */
export interface DeletePlan {
  /** The documents whose copies are turned into plain blocks. */
  readonly convert: DocumentList;
  /**
   * Published documents holding unpublished changes: their working draft is
   * converted, and their live row keeps the component until the author
   * publishes or discards the changes, so the component is kept until then.
   */
  readonly drafts: DocumentList;
  /**
   * How many of those the caller may not be allowed to change: their rights
   * there depend on the document. The save tells which.
   */
  readonly mayBeRefused: number;
}

/** How far the open delete has come. */
export interface DeleteProgress {
  readonly converted: number;
  readonly unchanged: number;
  readonly left: number;
  readonly pending: number;
}

/** What every call answers, inside the mutation envelope's `item`. */
export interface ComponentDeleteResult {
  readonly componentId: string;
  readonly status: ComponentDeleteStatus;
  /** Whether the caller holds the right to delete components. */
  readonly mayDelete: boolean;
  /**
   * The delete open on the component, or `null`: which step it is at, and
   * whether the caller started it (only they can carry it on).
   */
  readonly run: { readonly yours: boolean; readonly step: string } | null;
  /** On a dry run, and on a refusal in the check before converting. */
  readonly plan?: DeletePlan;
  /** The Layouts that use it, by the titles the caller may read. */
  readonly layouts?: DocumentList;
  /** The documents that stop it, or that were left. */
  readonly left?: readonly LeftDocument[];
  readonly progress?: DeleteProgress;
}
