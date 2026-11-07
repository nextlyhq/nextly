/**
 * What the delete dialog and the component delete routes say to each other.
 *
 * Isomorphic: the dialog imports it, so it carries types and constants only.
 *
 * ## The calls
 *
 * - `POST /components/:id/delete` with `{ "dryRun": true }`: what deleting it
 *   would do, changing nothing, and whether a delete is open already. One
 *   call judges one slice of the site's documents; while `plan.complete` is
 *   false, call again with `{ "dryRun": true, "after": plan.next }` for the
 *   next slice. Each call answers its own slice's documents, so the dialog
 *   adds them up.
 * - `POST /components/:id/delete` with `{}`: start the delete, or carry the
 *   caller's own on by one step. The dialog calls it again until the status
 *   is no longer `preflight` or `running`; closing the dialog pauses the
 *   delete, and calling again resumes it.
 * - `GET /components/:id/delete`: the open delete's progress, changing
 *   nothing.
 *
 * ## The statuses, and the dialog state each one is
 *
 * - `none`: nothing uses it; the delete removes it at once. Only ever
 *   answered once the plan is complete.
 * - `used`: it is used; the delete turns each copy into plain blocks first.
 *   Answered as soon as a slice finds a use, complete or not.
 * - `counting`: the slices so far found no use, and the plan is not complete
 *   yet ("Counting…"); ask for the next slice.
 * - `refused`: it cannot be deleted as things stand: a Layout uses it
 *   (`layouts`), a host cannot be converted, or the caller may not make one of
 *   the writes the delete needs (update, publish, or a field's own rule, for
 *   that document): `left`. Nothing changed.
 * - `preflight`, `running`: the delete is under way (`run.yours` false: it
 *   is somebody else's). `preflight` is the check before anything changes,
 *   which may take several calls on a large site.
 * - `partly-done`: every host it could convert was converted; the ones in
 *   `left` were not, so the component is kept. Starting again picks up there.
 * - `done`: the component was deleted.
 * - `idle`: no delete is open (GET only).
 *
 * A caller who may not delete THIS component (judged by core's own delete
 * gate for it, a rule over the row included) is answered with
 * `mayDelete: false` on a dry run, and refused (403) when starting or
 * carrying a delete on; a delete they had open is stopped, with nothing
 * further converted.
 *
 * @module component-delete/contract
 * @experimental Settles when the delete dialog ships.
 */

/** Where the routes answer, under the plugin's namespace. */
export const COMPONENT_DELETE_ROUTE_PATH = "/components/:id/delete";

/**
 * Why starting or stepping a delete is refused with 409 while somebody else's
 * delete of the component is open: the code of the refusal's one issue, at
 * `error.data.errors[0].code`, so a client matches on it rather than on the
 * message's words.
 */
export const DELETE_BUSY_REASON = "someone-else-deleting";

/** The status a call answers with. */
export type ComponentDeleteStatus =
  | "none"
  | "used"
  | "refused"
  | "preflight"
  | "running"
  | "partly-done"
  | "done"
  | "idle"
  | "counting";

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

/**
 * What deleting would do, as the dry run judges it: over one slice of the
 * site's documents, the whole of them when `complete`.
 */
export interface DeletePlan {
  /** Whether this slice reached the last document. */
  readonly complete: boolean;
  /**
   * Where the next slice starts, to send back as `after`; `null` once
   * complete. Opaque.
   */
  readonly next: string | null;
  /** The documents whose copies are turned into plain blocks. */
  readonly convert: DocumentList;
  /**
   * Published documents holding unpublished changes: their working draft is
   * converted, and their live row keeps the component until the author
   * publishes or discards the changes, so the component is kept until then.
   */
  readonly drafts: DocumentList;
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
  /**
   * The documents that stop it, or that were left: at most 50 of them, the
   * rest counted in `leftMore`.
   */
  readonly left?: readonly LeftDocument[];
  /** How many more documents stop it, or were left, than `left` lists. */
  readonly leftMore?: number;
  readonly progress?: DeleteProgress;
}
