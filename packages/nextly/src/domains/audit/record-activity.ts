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
import { SYSTEM_CONTEXT } from "../../shared/types";
import { computeChangedFields } from "../webhooks/envelope";

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
  data: Record<string, unknown>,
  entryId: string | undefined
): string | undefined {
  return entryHeading(
    data,
    collectionViews().titleFields.get(collection),
    entryId
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
): actor is RequestActor & { type: "user"; id: string } {
  if (actor?.type !== "user" || !actor.id) return false;
  // `SYSTEM_CONTEXT` is a RequestContext whose user carries the reserved id
  // `system`, so a seed or migration passing it — with no transport actor to
  // override it — resolves to a USER actor rather than a system one. No account
  // owns that id, so the entry would be stored already-erased, attributing an
  // internal write to a person who does not exist. Compared against the
  // sentinel itself so the two cannot drift apart.
  if (actor.id === SYSTEM_CONTEXT.user?.id) return false;
  return !collectionViews().hidden.has(collection);
}

/**
 * Which fields an update touched, as NAMES.
 *
 * Only for an update: a create reports every key it wrote and a delete every
 * key it removed, neither of which distinguishes anything, so both would cost
 * a column's worth of storage per row to say what the action already says.
 */
function changedFieldNames(
  input: RecordMutationActivityInput
): Record<string, unknown> | undefined {
  if (input.action !== "update" || !input.previous) return undefined;
  const changed = computeChangedFields(input.previous, input.data);
  return changed.length > 0 ? { changedFields: changed } : undefined;
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

  let service: ActivityLogService;
  try {
    service = container.get<ActivityLogService>("activityLogService");
  } catch {
    return;
  }

  const metadata = changedFieldNames(input);
  // No name or email is passed: the write resolves both from the account under
  // the same lock that decides whether it still exists. The alternative — the
  // session's copy, carried down from the request — is a snapshot taken before
  // that decision and can name an account that has since been renamed.
  await service.logActivityInTx(db(), {
    userId: input.actor.id,
    action: input.action,
    collection: input.collection,
    ...(input.locale === undefined ? {} : { locale: input.locale }),
    ...(input.entryId !== undefined ? { entryId: input.entryId } : {}),
    ...(() => {
      const heading = feedHeading(input.collection, input.data, input.entryId);
      return heading !== undefined ? { entryTitle: heading } : {};
    })(),
    ...(metadata !== undefined ? { metadata } : {}),
  });
}
