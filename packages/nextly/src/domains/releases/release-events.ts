/**
 * A release's history, as events in the record of content events.
 *
 * Each release operation records one event with the release as its subject,
 * in the transaction of the change it records, so a release never moves
 * without its event, nor an event stands for a move that rolled back. The
 * release page reads its history from this record; the activity log stays the
 * site-wide audit feed.
 *
 * The kinds are Releases' own, registered beside core's. Their names carry a
 * `release-` prefix because kind names are shared by every producer, and core
 * already records a document's `created`, `published` and `deleted`.
 *
 * @module domains/releases/release-events
 * @experimental
 */
import { eq, type Column, type Table } from "drizzle-orm";
import { z } from "zod";

import { getDialectTables } from "../../database/index";
import { NextlyError } from "../../errors";
import { CONTENT_EVENTS_TABLE } from "../../schemas/content-events";
import type { ReleaseMemberAction } from "../../schemas/releases/types";
import {
  readUnderRowLock,
  type LockableRead,
  type RowLockServer,
} from "../../shared/lib/row-lock";
import type { ContentEventActor } from "../content-events/actor";
import {
  contentEventKind,
  registerContentEventKind,
  type ContentEventKind,
} from "../content-events/kinds";
import { recordContentEvent } from "../content-events/record";
import type { VersionsDbApi } from "../versions/db-api";

import type { DocumentRef } from "./releases-repository";

/** An instant, as an ISO string: a payload is plain JSON. */
const instant = z.string().datetime();

/** The document a membership event is about. */
const documentPayload = z
  .object({
    scopeKind: z.string().min(1),
    scopeSlug: z.string().min(1),
    entryId: z.string().min(1),
    locale: z.string().nullable(),
    action: z.enum(["publish", "unpublish"]),
  })
  .strict();

/**
 * Each kind Releases records, by the name its writer uses.
 *
 * @experimental
 */
export const RELEASE_CONTENT_EVENT_KINDS = {
  created: { name: "release-created", label: "Created by {actor}" },
  documentAdded: {
    name: "release-document-added",
    label: "Document added by {actor}",
    payload: documentPayload,
  },
  documentRemoved: {
    name: "release-document-removed",
    label: "Document removed by {actor}",
    payload: documentPayload,
  },
  documentActionChanged: {
    name: "release-document-action-changed",
    label: "Document set to {action} by {actor}",
    // `action` is the one it now has; `from` the one it had.
    payload: documentPayload
      .extend({ from: z.enum(["publish", "unpublish"]) })
      .strict(),
  },
  scheduled: {
    name: "release-scheduled",
    label: "Scheduled for {at} by {actor}",
    payload: z.object({ at: instant, timezone: z.string().min(1) }).strict(),
  },
  rescheduled: {
    name: "release-rescheduled",
    label: "Rescheduled from {from} to {at} by {actor}",
    payload: z
      .object({ from: instant, at: instant, timezone: z.string().min(1) })
      .strict(),
  },
  publishNow: { name: "release-publish-now", label: "Publish now by {actor}" },
  started: {
    name: "release-started",
    label: "Started publishing",
    // The revision the run is publishing, so one run records one start.
    payload: z.object({ revision: z.number().int().nonnegative() }).strict(),
  },
  published: { name: "release-published", label: "Published" },
  stopped: {
    name: "release-stopped",
    label: "Stopped",
    payload: z.object({ scheduledAt: instant }).strict(),
  },
  cancelled: { name: "release-cancelled", label: "Cancelled by {actor}" },
  renamed: {
    name: "release-renamed",
    label: "Renamed to {to} by {actor}",
    payload: z.object({ from: z.string(), to: z.string() }).strict(),
  },
  descriptionChanged: {
    name: "release-description-changed",
    label: "Description changed by {actor}",
  },
  deleted: {
    name: "release-deleted",
    label: "Deleted by {actor}",
    endsSubject: true,
  },
} as const satisfies Record<string, ContentEventKind>;

/**
 * A kind's key in {@link RELEASE_CONTENT_EVENT_KINDS}.
 *
 * @experimental
 */
export type ReleaseContentEventKind = keyof typeof RELEASE_CONTENT_EVENT_KINDS;

/**
 * Register every release kind not registered already. Safe to call on every
 * write: a registered kind is left as it is.
 */
export function ensureReleaseContentEventKinds(): void {
  for (const kind of Object.values(RELEASE_CONTENT_EVENT_KINDS)) {
    if (!contentEventKind(kind.name)) registerContentEventKind(kind);
  }
}

/**
 * Who a release event names: a person, an API key by its own id, or the
 * system, which is how the drain's runs and stops are recorded.
 *
 * @experimental
 */
export type ReleaseEventActor =
  | { kind: "person"; userId: string }
  | { kind: "apiKey"; keyId: string }
  | { kind: "system" };

/** The system, for the drain's runs and stops and for an in-process caller. */
export const SYSTEM_RELEASE_EVENT_ACTOR: ReleaseEventActor = Object.freeze({
  kind: "system",
});

/** What the release service knows of its caller, as the event needs it. */
export interface ReleaseEventCaller {
  userId: string | null;
  /** Set when the caller authenticated as an API key. */
  authenticatedScope?: { actorType: string };
  /** The key's own id, when the caller is one. */
  apiKeyId?: string;
}

/**
 * Who a caller's release operation is recorded as.
 *
 * An API key is named as the key, never as the person who owns it: the
 * caller's `userId` is the owner, carried so the key can be authorized. A key
 * whose id did not reach here is refused, before anything is written, rather
 * than recorded as its owner or as nobody, since its change must name it: a
 * Direct API caller that forwards a key's `authenticatedScope` passes the
 * key's `apiKeyId` with it. A trusted in-process caller with no user is the
 * system.
 */
export function releaseEventActorOf(
  caller: ReleaseEventCaller
): ReleaseEventActor {
  if (caller.authenticatedScope?.actorType === "apiKey") {
    if (caller.apiKeyId) return { kind: "apiKey", keyId: caller.apiKeyId };
    throw NextlyError.invalidInput({
      message:
        "A release change made with an API key's scope must name the key: pass `apiKeyId` with `authenticatedScope`.",
      logContext: { reason: "release-event-key-without-id" },
    });
  }
  if (caller.userId !== null) return { kind: "person", userId: caller.userId };
  return SYSTEM_RELEASE_EVENT_ACTOR;
}

/** One event to record. */
export interface ReleaseEventInput {
  kind: ReleaseContentEventKind;
  actor: ReleaseEventActor;
  payload?: Record<string, unknown> | null;
  fromState?: string | null;
  toState?: string | null;
}

/**
 * The statements a release event needs inside the transaction of its change:
 * a release transition's own (`ReleasesTxApi`), or a content write's.
 */
export interface ReleaseEventTx {
  select<T = unknown>(
    table: string,
    options?: Parameters<VersionsDbApi["select"]>[1]
  ): Promise<T[]>;
  insert<T = unknown>(
    table: string,
    data: Record<string, unknown>,
    options?: { returning?: string[] | "*" }
  ): Promise<T>;
  delete(
    table: string,
    where: Parameters<VersionsDbApi["delete"]>[1]
  ): Promise<number>;
  updateCount(
    table: string,
    data: Record<string, unknown>,
    where: Parameters<VersionsDbApi["delete"]>[1]
  ): Promise<number>;
}

/**
 * The record's writer over a release transaction: its `update` is the
 * transaction's counted update, which every release transaction offers.
 */
function recordTx(tx: ReleaseEventTx): VersionsDbApi {
  return {
    select: (table, options) => tx.select(table, options),
    insert: (table, data, options) => tx.insert(table, data, options),
    delete: (table, where) => tx.delete(table, where),
    update: (table, data, where) => tx.updateCount(table, data, where),
  };
}

/** The Drizzle surface a locked read of one row needs. */
interface LockedReadDb {
  select(fields: Record<string, Column>): {
    from(table: unknown): {
      where(condition: unknown): {
        limit(count: number): LockableRead<Record<string, unknown>[]>;
      };
    };
  };
}

/** A transaction a row can be read under lock on: the adapter's own context. */
export interface LockingReadTx {
  getDrizzle?<T = unknown>(): T;
}

/**
 * One row by id, read on `tx` under the existence-check lock (`FOR SHARE`
 * where the server takes it), so what it answers is the row as last
 * committed and it cannot be deleted until `tx` ends. SQLite takes no lock:
 * its one writer keeps any deletion out of the transaction.
 */
export async function readOneUnderLock(
  tx: LockingReadTx,
  server: RowLockServer,
  table: Table & { id: Column },
  id: string,
  fields: Record<string, Column>
): Promise<Record<string, unknown> | undefined> {
  if (typeof tx.getDrizzle !== "function") {
    // Refused rather than read without the lock: the answer would then be
    // a snapshot a deletion may already have overtaken.
    throw NextlyError.internal({
      logContext: { reason: "release-locked-read-without-drizzle" },
    });
  }
  const db = tx.getDrizzle<LockedReadDb>();
  const [row] = await readUnderRowLock(
    db.select(fields).from(table).where(eq(table.id, id)).limit(1),
    server,
    "existence-check"
  );
  return row;
}

/**
 * The display name kept with the event, read on its transaction.
 *
 * A person's is read from their account under its existence-check lock, the
 * lock every write naming a person takes: an account deletion then either
 * waits for this event and erases its name with the rest, or has committed
 * and the name is not there to keep. A key's is its own name.
 */
async function actorNameOf(
  tx: ReleaseEventTx & LockingReadTx,
  actor: ReleaseEventActor,
  server: RowLockServer | undefined
): Promise<string | null> {
  if (actor.kind === "system") return null;
  if (actor.kind === "apiKey") {
    const [row] = await tx.select<{ name: string | null }>("api_keys", {
      columns: ["name"],
      where: { and: [{ column: "id", op: "=", value: actor.keyId }] },
      limit: 1,
    });
    return row?.name ?? null;
  }
  if (server === undefined) {
    throw NextlyError.internal({
      logContext: { reason: "release-event-person-without-lock" },
    });
  }
  const users = getDialectTables(server.dialect).users;
  const row = await readOneUnderLock(tx, server, users, actor.userId, {
    name: users.name,
  });
  return typeof row?.name === "string" ? row.name : null;
}

/** The actor as the record keeps it, with the name read for it. */
function recordedActor(
  actor: ReleaseEventActor,
  name: string | null
): ContentEventActor {
  switch (actor.kind) {
    case "person":
      return { kind: "person", id: actor.userId, name };
    case "apiKey":
      return { kind: "apiKey", id: actor.keyId, name };
    case "system":
      return { kind: "system", name: null };
  }
}

/**
 * Record `event` about release `releaseId` on `tx`, the transaction of the
 * change it records.
 *
 * @experimental
 */
export async function recordReleaseEvent(
  tx: ReleaseEventTx & LockingReadTx,
  releaseId: string,
  event: ReleaseEventInput,
  /**
   * The server's row-lock facts, for reading a person's name under lock.
   * Required when `event.actor` is a person.
   */
  server?: RowLockServer
): Promise<void> {
  ensureReleaseContentEventKinds();
  await recordContentEvent(recordTx(tx), {
    subject: { kind: "release", id: releaseId },
    kind: RELEASE_CONTENT_EVENT_KINDS[event.kind].name,
    actor: recordedActor(
      event.actor,
      await actorNameOf(tx, event.actor, server)
    ),
    fromState: event.fromState ?? null,
    toState: event.toState ?? null,
    payload: event.payload ?? null,
  });
}

/** The kinds of release event that name a document of the release. */
const DOCUMENT_EVENT_KINDS: ReadonlySet<string> = new Set([
  RELEASE_CONTENT_EVENT_KINDS.documentAdded.name,
  RELEASE_CONTENT_EVENT_KINDS.documentRemoved.name,
  RELEASE_CONTENT_EVENT_KINDS.documentActionChanged.name,
]);

/** The document fields a membership event's payload carries. */
const eventDocument = z.object({
  scopeKind: z.enum(["collection", "single", "page"]),
  scopeSlug: z.string().min(1),
  entryId: z.string().min(1),
  locale: z.string().nullable(),
});

/**
 * The document a release event is about: `undefined` for an event about no
 * document, `null` for a document event whose payload does not say which
 * (read back from a row that is not the shape written), and the document
 * otherwise.
 */
export function documentOfReleaseEvent(event: {
  kind: string;
  payload: unknown;
}): DocumentRef | null | undefined {
  if (!DOCUMENT_EVENT_KINDS.has(event.kind)) return undefined;
  const raw: unknown =
    typeof event.payload === "string"
      ? (JSON.parse(event.payload) as unknown)
      : event.payload;
  const parsed = eventDocument.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** The payload of a membership event about `member`. */
export function documentEventPayload(member: {
  scopeKind: string;
  scopeSlug: string;
  entryId: string;
  locale: string | null;
  action: ReleaseMemberAction;
}): Record<string, unknown> {
  return {
    scopeKind: member.scopeKind,
    scopeSlug: member.scopeSlug,
    entryId: member.entryId,
    locale: member.locale,
    action: member.action,
  };
}

/**
 * What a release's own history says about whether it ran, for the delete
 * rule.
 *
 * `recorded` is whether its history began with its creation: a release made
 * before releases recorded their events has none, and its history cannot say
 * whether it ran. `ran` is whether it started publishing or was published.
 *
 * @experimental
 */
export interface ReleaseRunHistory {
  recorded: boolean;
  ran: boolean;
}

/**
 * Whether a release in a deletable state must still be kept, because it may
 * have put content live: the one rule the delete, its fence and the `delete`
 * capability all ask.
 *
 * A release never scheduled never ran. One that was scheduled is kept when
 * its history says it started publishing or was published, and also when its
 * history was not recorded (made before releases recorded their events),
 * since then nothing says whether it ran. A cancelled release whose recorded
 * history shows no run, scheduled and called off before its moment, may go.
 */
export function keptAsRecord(
  release: { scheduledAt: Date | null | undefined },
  history: ReleaseRunHistory | undefined
): boolean {
  if (release.scheduledAt === null || release.scheduledAt === undefined) {
    return false;
  }
  if (history === undefined || !history.recorded) return true;
  return history.ran;
}

const RUN_KINDS = [
  RELEASE_CONTENT_EVENT_KINDS.started.name,
  RELEASE_CONTENT_EVENT_KINDS.published.name,
] as const;

/**
 * Each release's {@link ReleaseRunHistory}, in one read of the record, for
 * the releases whose deletion it decides. A release with no events at all
 * reads as not recorded.
 */
export async function runHistoryOf(
  db: Pick<ReleaseEventTx, "select">,
  releaseIds: readonly string[]
): Promise<Map<string, ReleaseRunHistory>> {
  const histories = new Map<string, ReleaseRunHistory>();
  if (releaseIds.length === 0) return histories;
  const rows = await db.select<{ subjectId: string; kind: string }>(
    CONTENT_EVENTS_TABLE,
    {
      columns: ["subjectId", "kind"],
      where: {
        and: [
          { column: "subjectKind", op: "=", value: "release" },
          // A release has no slug; naming that lets the read use the whole
          // subject index (kind, slug, id) rather than its first column.
          { column: "subjectSlug", op: "IS NULL" },
          { column: "subjectId", op: "IN", value: [...new Set(releaseIds)] },
          {
            column: "kind",
            op: "IN",
            value: [RELEASE_CONTENT_EVENT_KINDS.created.name, ...RUN_KINDS],
          },
        ],
      },
    }
  );
  for (const id of releaseIds) {
    histories.set(id, { recorded: false, ran: false });
  }
  for (const row of rows) {
    const history = histories.get(row.subjectId);
    if (history === undefined) continue;
    if (row.kind === RELEASE_CONTENT_EVENT_KINDS.created.name) {
      history.recorded = true;
    } else {
      history.ran = true;
    }
  }
  return histories;
}

/**
 * Whether a run of release `releaseId` at `revision` has recorded its start.
 */
export async function hasStartedAt(
  tx: Pick<ReleaseEventTx, "select">,
  releaseId: string,
  revision: number
): Promise<boolean> {
  const rows = await tx.select<{ payload: unknown }>(CONTENT_EVENTS_TABLE, {
    columns: ["payload"],
    where: {
      and: [
        { column: "subjectKind", op: "=", value: "release" },
        { column: "subjectSlug", op: "IS NULL" },
        { column: "subjectId", op: "=", value: releaseId },
        {
          column: "kind",
          op: "=",
          value: RELEASE_CONTENT_EVENT_KINDS.started.name,
        },
      ],
    },
  });
  return rows.some(row => {
    const payload: unknown =
      typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
    return (
      payload !== null &&
      typeof payload === "object" &&
      (payload as { revision?: unknown }).revision === revision
    );
  });
}
