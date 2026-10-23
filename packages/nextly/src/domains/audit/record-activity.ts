/**
 * Audit domain — the activity entry a content mutation records.
 *
 * Called from the mutation choke point INSIDE the write transaction, so the
 * entry and the change it describes commit together or not at all. The write
 * this replaced ran from a post-commit hook, in its own transaction, with its
 * failure swallowed: a change could commit and then fail to record, leaving no
 * trace that anything had happened and nothing to reconcile against.
 *
 * Only field NAMES are stored, never values and never document bodies. That is
 * the minimization contract the trail is held to, and it is what keeps the feed
 * small enough to serve — and later to stream — without shipping content.
 *
 * @module domains/audit/record-activity
 */

import type { RequestActor } from "../../auth/request-actor";
import { container } from "../../di/container";
import type { NextlyServiceConfig } from "../../di/register";
import { entryHeading } from "../../lib/entry-heading";
import type {
  ActivityLogAction,
  ActivityLogService,
  ActivityWriteDb,
} from "../../services/dashboard/activity-log-service";
import { computeChangedFields } from "../webhooks/envelope";

import { recordableActor } from "./record-settings-activity";

/**
 * What a write did to whether its document is live, as the write path knows it.
 *
 * Facts rather than a verdict: each write path states what it read and what it
 * wrote, and {@link publishesDocument} alone decides whether that was a
 * publish. Five paths can publish (an entry's update, its all-languages
 * publish, its transaction path, a Single's save and a Single's publish-all),
 * and five copies of the rule would disagree about the cases that are hard to
 * tell apart: a promotion of pending edits, an unpublish that promotes, and a
 * restore.
 */
export interface PublicationFacts {
  /** The document's status once the write commits, in the language it wrote. */
  statusAfter: string | null | undefined;
  /** Its status before the write, as the write read it under its lock. */
  statusBefore: string | null | undefined;
  /** Whether the write promoted pending edits onto the live document. */
  promotedPendingEdits?: boolean;
  /** Whether the write restores an earlier version. */
  restores?: boolean;
}

/**
 * Whether a write published its document: it leaves the document published,
 * and either the document was not published before or the write promoted
 * pending edits onto it.
 *
 * The trail has no publish action of its own, and its changed fields cannot
 * say this alone: a promotion leaves the status published, so its row lists
 * only the fields the pending edits changed and reads like a save. A restore is
 * never a publish, even one that lands published: it puts back an earlier
 * version's content, which is an edit. An unpublish is never one either, even
 * when it promotes the pending edits as it withdraws the page.
 */
export function publishesDocument(facts: PublicationFacts): boolean {
  if (facts.restores === true) return false;
  if (facts.statusAfter !== "published") return false;
  return (
    facts.statusBefore !== "published" || facts.promotedPendingEdits === true
  );
}

/** What one mutation records, as the choke point already knows it. */
export interface RecordMutationActivityInput {
  /** The language this write was made in; see `RecordMutationEventArgs`. */
  locale?: string | null;
  action: ActivityLogAction;
  /** Collection slug the entry belongs to. */
  collection: string;
  entryId?: string;
  /** The written document, used for the display heading and the changed set. */
  data: Record<string, unknown>;
  /** Prior state for an update; null on create and delete. */
  previous?: Record<string, unknown> | null;
  actor?: RequestActor | null;
  /** What the write did to whether the entry is live, from a path that can publish. */
  publication?: PublicationFacts;
}

/**
 * The per-collection presentation facts an entry needs, derived from config.
 *
 * Keyed by the config OBJECT rather than cached once: a reload installs a new
 * config, and a cache that never notices would keep hiding a collection the
 * operator has since revealed (or keep titling entries by a field that no
 * longer exists) for the life of the process.
 */
interface CollectionViews {
  hidden: ReadonlySet<string>;
  titleFields: ReadonlyMap<string, string>;
}

const EMPTY_VIEWS: CollectionViews = {
  hidden: new Set(),
  titleFields: new Map(),
};

let viewsSource: NextlyServiceConfig | null = null;
let viewsCache: CollectionViews = EMPTY_VIEWS;

/**
 * Read the config the container currently holds, or null before one is
 * registered. Synchronous and database-free, so it is safe to call inside the
 * write transaction this runs in.
 */
function currentConfig(): NextlyServiceConfig | null {
  try {
    return container.get<NextlyServiceConfig>("config");
  } catch {
    return null;
  }
}

function collectionViews(): CollectionViews {
  const config = currentConfig();
  if (!config) return EMPTY_VIEWS;
  if (config === viewsSource) return viewsCache;

  const hidden = new Set<string>();
  const titleFields = new Map<string, string>();
  for (const collection of config.collections ?? []) {
    if (collection.admin?.hidden === true) hidden.add(collection.slug);
    if (collection.admin?.useAsTitle) {
      titleFields.set(collection.slug, collection.admin.useAsTitle);
    }
  }

  viewsSource = config;
  viewsCache = { hidden, titleFields };
  return viewsCache;
}

/**
 * The heading recorded for an entry in the feed.
 *
 * The WALK is shared with the dashboard's recent-entries list (`lib/entry-heading`)
 * because both answer the same question about the same fields; only the source
 * of the title field differs, which is what this resolves. Two walks would
 * disagree about which entry is which depending on where you read it.
 *
 * Denormalized on purpose. The feed outlives the entry it names, so resolving
 * the heading at read time would leave a deleted entry's row unlabelled — the
 * one entry whose label the reader can no longer recover any other way.
 */
function feedHeading(
  collection: string,
  data: Record<string, unknown>
): string | undefined {
  // No title is stored when the entry has none. Its id once stood in, which
  // every reader then drew as though it were the entry's name; the readers say
  // "Untitled" themselves, and treat a stored title equal to the row's id the
  // same way, so rows written before this read alike.
  return entryHeading(
    data,
    collectionViews().titleFields.get(collection),
    undefined
  );
}

/**
 * Whether a write by this actor, on this collection, will produce an entry.
 *
 * Exported because a write path has to know BEFORE it assembles its documents:
 * the changed-field names are derived by comparing the prior and written
 * documents, and the batch paths skip reading component and many-to-many
 * relations when nothing was going to consume them. An entry assembled from
 * parent columns alone reports a relationship-only edit as having changed
 * nothing, so the two decisions have to be made from the same facts.
 *
 * Deliberately excludes whether the service is registered: that is a boot-time
 * fact this cannot answer without reaching into the container on a path that
 * runs per write, and answering it wrongly here would only ever cost a read
 * that goes unused.
 */
export function willRecordMutationActivity(
  collection: string,
  actor?: RequestActor | null
): actor is RequestActor & { id: string } {
  // Whether an actor belongs in the trail is `recordableActor`'s question,
  // asked rather than restated: this file carried its own copy of the rule and
  // the two had to be widened together, which is the drift that docblock warns
  // about. What is local here is the collection's visibility.
  if (!recordableActor(actor)) return false;
  return !collectionViews().hidden.has(collection);
}

/**
 * What an update's row says about the write: which fields it touched, as
 * NAMES, and whether it published the document.
 *
 * Only for an update: a create reports every key it wrote and a delete every
 * key it removed, neither of which distinguishes anything, so both would cost
 * a column's worth of storage per row to say what the action already says. A
 * create straight into published is not marked either: a create never joins
 * another row, and its action already says it is new.
 *
 * One builder for an entry's row and a Single's, so the two kinds of row say
 * the same things in the same shape.
 */
function updateMetadata(input: {
  action: ActivityLogAction;
  /** Absent when the write could not assemble its documents: no fields are named. */
  data?: Record<string, unknown>;
  previous?: Record<string, unknown> | null;
  publication?: PublicationFacts;
}): Record<string, unknown> | undefined {
  if (input.action !== "update") return undefined;
  const changed =
    input.previous && input.data
      ? computeChangedFields(input.previous, input.data)
      : [];
  const published =
    input.publication !== undefined && publishesDocument(input.publication);
  if (changed.length === 0 && !published) return undefined;
  return {
    ...(changed.length > 0 ? { changedFields: changed } : {}),
    ...(published ? { published: true } : {}),
  };
}

/**
 * Record one mutation in the activity log, inside the caller's transaction.
 *
 * Records only writes a signed-in person performed. An API key and an internal
 * write carry no account, and the trail's actor column is a user reference
 * whose identity-erasure check is answered against the accounts table — a key's
 * own id would find no account there and be filed as an already-erased
 * identity, which is a worse record than none.
 *
 * The executor is taken as a thunk, resolved only once every reason to skip has
 * been ruled out: obtaining it is a real operation on the caller's transaction,
 * and a mutation this never records should not pay for one.
 *
 * A failure PROPAGATES and takes the surrounding write with it. Absent service
 * registration does not: that is a boot-time fact about how the host assembled
 * its container, not a write that failed, and refusing every content mutation
 * because a dashboard service was never registered would be a far larger
 * failure than the one it reports.
 */
export async function recordMutationActivity(
  db: () => ActivityWriteDb,
  input: RecordMutationActivityInput
): Promise<void> {
  if (!willRecordMutationActivity(input.collection, input.actor)) return;

  const service = registeredActivityLogService();
  if (!service) return;

  const metadata = updateMetadata(input);
  // No name or email is passed: the write resolves both from the account under
  // the same lock that decides whether it still exists. The alternative — the
  // session's copy, carried down from the request — is a snapshot taken before
  // that decision and can name an account that has since been renamed.
  // Non-null by the gate above, which every caller runs first.
  const actor = recordableActor(input.actor);
  if (!actor) return;
  await service.logActivityInTx(db(), {
    actorType: actor.type,
    userId: actor.id,
    action: input.action,
    collection: input.collection,
    ...(input.locale === undefined ? {} : { locale: input.locale }),
    // This recorder runs only for collection entries; the caller gates on the
    // resource kind before reaching it.
    subjectKind: "collection" as const,
    ...(input.entryId !== undefined ? { entryId: input.entryId } : {}),
    ...(() => {
      const heading = feedHeading(input.collection, input.data);
      return heading !== undefined ? { entryTitle: heading } : {};
    })(),
    ...(metadata !== undefined ? { metadata } : {}),
  });
}

/**
 * The activity service the host registered, or `undefined` when it registered
 * none, which both recorders read as "record nothing".
 */
function registeredActivityLogService(): ActivityLogService | undefined {
  try {
    // A container can report an absent registration two ways — by throwing,
    // and by answering `undefined` — and both mean the same here. Handling only
    // the first once turned "no dashboard service registered" into a failed
    // content write on the property access that followed.
    return container.get<ActivityLogService>("activityLogService") ?? undefined;
  } catch {
    return undefined;
  }
}

/** What one save of a Single records, as the save already knows it. */
export interface RecordSingleActivityInput {
  /** The Single's slug, filed in the trail's scope column. */
  slug: string;
  /**
   * The Single's live document id. Required, not optional as an entry's is:
   * the feed shows a Single's row only after asking whether the reader may
   * read that document, and a row with no id could never be asked about.
   */
  entryId: string;
  /** The Single's label when it was saved, the heading the feed falls back to. */
  label: string;
  /** The language this save was made in; null or absent for every language. */
  locale?: string | null;
  actor?: RequestActor | null;
  /**
   * The saved document and the one it replaced, compared by value for the
   * fields the save changed, as an entry's are. Absent, the row names none.
   */
  data?: Record<string, unknown>;
  previous?: Record<string, unknown> | null;
  /** What the save did to whether the Single is live. */
  publication?: PublicationFacts;
}

/**
 * Whether a save of a Single by this actor will produce a row, so the save
 * knows to assemble the documents its changed fields are compared from.
 *
 * The Single's counterpart of {@link willRecordMutationActivity}, and the same
 * rule: the trail records every save by a person, on every install, so a save
 * that assembled its documents only for webhooks or audit would compare
 * nothing on an install with neither, and a component-only edit would read as
 * no change at all.
 */
export function willRecordSingleActivity(
  actor?: RequestActor | null
): actor is RequestActor & { id: string } {
  return (
    recordableActor(actor) !== null &&
    registeredActivityLogService() !== undefined
  );
}

/**
 * Record one save of a Single in the activity log, inside the save's
 * transaction.
 *
 * Every save is an update: a Single always exists, and the save that first
 * stores its row is recorded in the Single's own history as its creation.
 * Hidden and internal Singles are recorded too and left out when the trail is
 * read, by the row's stated kind, because a Single and a collection may share
 * a slug and a write-time filter by slug could not tell them apart.
 *
 * A failure propagates, as it does for an entry, so the save and its row commit
 * together or not at all.
 */
export async function recordSingleActivity(
  db: () => ActivityWriteDb,
  input: RecordSingleActivityInput
): Promise<void> {
  const actor = recordableActor(input.actor);
  if (!actor) return;
  const service = registeredActivityLogService();
  if (!service) return;
  const metadata = updateMetadata({
    action: "update",
    data: input.data,
    previous: input.previous,
    publication: input.publication,
  });
  await service.logActivityInTx(db(), {
    actorType: actor.type,
    userId: actor.id,
    action: "update",
    collection: input.slug,
    ...(input.locale === undefined ? {} : { locale: input.locale }),
    subjectKind: "single" as const,
    entryId: input.entryId,
    entryTitle: input.label,
    ...(metadata !== undefined ? { metadata } : {}),
  });
}
