/**
 * The trash as a caller uses it: list, restore and empty, each asked of the
 * one access decision.
 *
 * - A caller sees a trashed entry only where they may read a deleted
 *   document of its collection (`mayReadDeletedDocument`): the entry's row is
 *   gone, so a read rule that needs the row admits super-admin authority
 *   alone, as a deleted document's history does.
 * - Restoring needs that, and `restore-<collection>`.
 * - Emptying needs `empty-<collection>` for each collection emptied;
 *   emptying with no collection named empties those the caller may.
 *
 * An entry the caller may not read is answered as one not in the trash.
 * Trusted server code (`overrideAccess`) skips every check, as everywhere.
 *
 * @module domains/trash/trash-service
 */
import type { AuthenticatedScope } from "../../auth/authenticated-scope";
import {
  callerHoldsPermission,
  readAccessCaller,
  type ReadAccessCaller,
} from "../../auth/entity-read-access";
import { actorForWrite, type RequestActor } from "../../auth/request-actor";
import { getService } from "../../di/service-access";
import { NextlyError } from "../../errors";
import { permissionSlug } from "../../schemas/_zod/rbac";
import { TRASH_TABLE } from "../../schemas/trash";
import { readableSlugAllowlist } from "../../services/lib/readable-slug-allowlist";
import type { UserContext } from "../collections/services/collection-types";
import { collectionTableName } from "../collections/services/collection-utils";
import { mayReadDeletedDocument } from "../content-events/deleted-document-access";

import {
  restoreTrashedEntry,
  type RestoreCollection,
  type RestoreEntryResult,
} from "./restore-entry";
import {
  listTrash,
  readTrashRecord,
  removeFromTrash,
  type TrashListItem,
} from "./trash-records";

/** The two permissions the trash adds to every collection. */
const RESTORE_ACTION = "restore";
const EMPTY_ACTION = "empty";

/** Who is asking, as every collection operation takes it. */
export interface TrashCaller {
  /** Trusted server code: every access check is skipped. */
  overrideAccess?: boolean;
  /** The resolved person, needed unless `overrideAccess`. */
  user?: UserContext;
  /** A scoped API key's own grants, when the caller is one. */
  authenticatedScope?: AuthenticatedScope;
  /** Who acts, as the history and the site's events record them. */
  actor?: RequestActor;
}

/** A page of the trash. */
export interface TrashListQuery {
  /** Only this collection's entries. */
  collection?: string;
  /** 1 to 100; 25 when left out. */
  limit?: number;
  /** From 1; 1 when left out. */
  page?: number;
}

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

/** The caller as an entity-level decision reads it. */
function readerOf(caller: TrashCaller): ReadAccessCaller {
  return readAccessCaller({
    // An anonymous caller is refused by every decision below.
    user: caller.user ?? { id: "" },
    ...(caller.authenticatedScope === undefined
      ? {}
      : { authenticatedScope: caller.authenticatedScope }),
  });
}

/** Who acts, as the history records them. */
function actorOf(caller: TrashCaller): RequestActor {
  return actorForWrite(caller.actor, caller.user);
}

/**
 * The collections whose trashed entries the caller may see: every one for
 * trusted code; otherwise those whose deleted documents they may read. Asked
 * of the collections they may read at all first, which is the cheaper
 * question and a superset.
 */
async function visibleCollections(
  caller: TrashCaller,
  named?: string
): Promise<string[] | undefined> {
  if (caller.overrideAccess === true) {
    return named === undefined ? undefined : [named];
  }
  const reader = readerOf(caller);
  const readable = (await readableSlugAllowlist(reader, "collection")) ?? [];
  const asked =
    named === undefined ? readable : readable.filter(s => s === named);
  const visible: string[] = [];
  for (const slug of asked) {
    if (await mayReadDeletedDocument({ kind: "collection", slug }, reader)) {
      visible.push(slug);
    }
  }
  return visible;
}

/** Whether the caller holds `action` on the collection `slug`. */
async function holds(
  caller: TrashCaller,
  action: string,
  slug: string
): Promise<boolean> {
  if (caller.overrideAccess === true) return true;
  return callerHoldsPermission(permissionSlug(action, slug), readerOf(caller));
}

/** The database the trash lives in. */
function adapter() {
  return getService("adapter");
}

/**
 * Whether the trash is there to use; a database `nextly migrate` has not
 * reached yet has none, and every delete there is still permanent.
 */
async function requireTrash(): Promise<void> {
  if (!(await adapter().tableExists(TRASH_TABLE))) {
    throw NextlyError.conflict({
      message:
        "This database has no trash yet: deleted entries are removed for good. Run `nextly migrate` to add it.",
      logContext: { table: TRASH_TABLE },
    });
  }
}

/** A page of the trash the caller may see, newest first. */
export async function listTrashFor(
  caller: TrashCaller,
  query: TrashListQuery = {}
): Promise<{
  items: TrashListItem[];
  total: number;
  page: number;
  limit: number;
}> {
  await requireTrash();
  const limit = Math.min(
    Math.max(Math.trunc(query.limit ?? DEFAULT_PAGE_SIZE), 1),
    MAX_PAGE_SIZE
  );
  const page = Math.max(Math.trunc(query.page ?? 1), 1);
  const collections = await visibleCollections(caller, query.collection);
  const { items, total } = await listTrash(
    adapter(),
    collections === undefined ? {} : { collections },
    { limit, offset: (page - 1) * limit }
  );
  return { items, total, page, limit };
}

/** The collection `slug` as a restore reads it now; undefined where gone. */
async function collectionOf(
  slug: string
): Promise<RestoreCollection | undefined> {
  const record = await getService(
    "collectionRegistryService"
  ).getCollectionBySlug(slug);
  if (record === null) return undefined;
  return {
    tableName: collectionTableName(record, slug),
    fields: record.fields ?? [],
  };
}

/**
 * Refuses a new value that is not a plain one (text, a number, a boolean or
 * nothing): a restore replaces a taken value, such as a slug, and an object
 * would be written to its column unchecked.
 */
function refuseNonPlainValues(
  values: Readonly<Record<string, unknown>> | undefined
): void {
  const plain = (value: unknown): boolean =>
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean";
  const errors = Object.entries(values ?? {})
    .filter(([, value]) => !plain(value))
    .map(([field]) => ({
      path: `values.${field}`,
      code: "invalid_type",
      message: "A new value is text, a number, a boolean or null.",
    }));
  if (errors.length > 0) throw NextlyError.validation({ errors });
}

/** What a restore names: a trash record, or a trashed entry by its id. */
export type TrashItemRef =
  | { trashId: string }
  | { itemId: string; collection?: string };

/**
 * The trash record `ref` names that the caller may see. An entry in the
 * trash more than once (deleted, recreated under its id, deleted again) is
 * its latest record.
 */
async function recordFor(
  caller: TrashCaller,
  ref: TrashItemRef
): Promise<TrashListItem> {
  const visible = await visibleCollections(
    caller,
    "collection" in ref ? ref.collection : undefined
  );
  if ("trashId" in ref) {
    const record = await readTrashRecord(adapter(), ref.trashId);
    if (
      record !== undefined &&
      (visible === undefined || visible.includes(record.scopeSlug))
    ) {
      return record;
    }
  } else {
    const { items } = await listTrash(
      adapter(),
      {
        itemIds: [ref.itemId],
        ...(visible === undefined ? {} : { collections: visible }),
      },
      { limit: 2, offset: 0 }
    );
    const kinds = new Set(items.map(item => item.scopeSlug));
    if (kinds.size > 1) {
      throw NextlyError.validation({
        errors: [
          {
            path: "collection",
            code: "ambiguous",
            message: `More than one collection has a trashed entry "${ref.itemId}"; name the collection.`,
          },
        ],
        logContext: { itemId: ref.itemId },
      });
    }
    if (items[0] !== undefined) return items[0];
  }
  throw NextlyError.notFound({ logContext: { ref } });
}

/**
 * Restore a trashed entry the caller may restore. Where a unique value it
 * held is taken, nothing is written and the conflicts are answered: ask
 * again with `values` holding new ones.
 */
export async function restoreFor(
  caller: TrashCaller,
  ref: TrashItemRef,
  values?: Readonly<Record<string, unknown>>
): Promise<RestoreEntryResult> {
  refuseNonPlainValues(values);
  await requireTrash();
  const record = await recordFor(caller, ref);
  if (!(await holds(caller, RESTORE_ACTION, record.scopeSlug))) {
    throw NextlyError.forbidden({
      logContext: {
        reason: "restore-not-granted",
        collection: record.scopeSlug,
      },
    });
  }
  return restoreTrashedEntry(
    { adapter: adapter(), collectionOf },
    {
      trashId: record.id,
      ...(values === undefined ? {} : { values }),
      actor: actorOf(caller),
      actorName: caller.user?.name ?? null,
    }
  );
}

/** What an emptying takes. */
export interface EmptyTrashQuery {
  /** Only this collection's entries; every collection the caller may empty where left out. */
  collection?: string;
  /** Only these trash records. */
  ids?: readonly string[];
}

/**
 * Remove trashed entries for good: those `query` names in the collections
 * the caller may see and may empty. Naming a collection the caller may see
 * but not empty is refused; with none named, those they may not empty are
 * left alone. Returns what was removed.
 */
export async function emptyTrashFor(
  caller: TrashCaller,
  query: EmptyTrashQuery = {}
): Promise<TrashListItem[]> {
  await requireTrash();
  const collections = await collectionsToEmpty(caller, query.collection);
  return removeFromTrash(adapter(), {
    ...(collections === undefined ? {} : { collections }),
    ...(query.ids === undefined ? {} : { ids: query.ids }),
  });
}

/**
 * The collections an emptying takes: every one for trusted code (undefined),
 * else those the caller may see and holds `empty` on. A collection
 * named that the caller may not see is not found; one they see but may not
 * empty is refused.
 */
async function collectionsToEmpty(
  caller: TrashCaller,
  named: string | undefined
): Promise<string[] | undefined> {
  const visible = await visibleCollections(caller, named);
  if (visible === undefined) return undefined;
  const allowed: string[] = [];
  for (const slug of visible) {
    if (await holds(caller, EMPTY_ACTION, slug)) allowed.push(slug);
  }
  if (named === undefined || allowed.length > 0) return allowed;
  if (visible.length === 0) {
    throw NextlyError.notFound({ logContext: { collection: named } });
  }
  throw NextlyError.forbidden({
    logContext: { reason: "empty-not-granted", collection: named },
  });
}
