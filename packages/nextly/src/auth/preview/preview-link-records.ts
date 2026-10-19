/**
 * Recorded preview links: one row per link, so a link can be listed, counted
 * and revoked on its own.
 *
 * A link is still a signed token, and every check the token already carries
 * (signature, expiry, the site-wide generation, its maker) still runs first.
 * The row adds what a token cannot say about itself once it has been handed
 * out: that this one link was revoked, and how often it was opened. Nothing
 * here is consulted before a token's signature has verified, so arbitrary bytes
 * never reach the database.
 *
 * Links made before links were recorded have no row and never will. They are
 * judged as they always were, plus a per-document cutoff a revoke-all writes,
 * and they can all still be alive for at most the maximum lifetime after
 * recording began. That moment and the cutoffs are kept in `nextly_meta`
 * rather than a table of their own: both are a handful of values, and a new
 * column on an existing table would break every read of it on a database that
 * has not been updated.
 *
 * @module auth/preview/preview-link-records
 */

import { createHash } from "node:crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { and, desc, eq, gt, isNull, sql, type SQL } from "drizzle-orm";

import { getDialectTables } from "../../database/index";
import { getService } from "../../di";
import { isMissingTable } from "../../domains/field-groups/migration/session";
import { NextlyError } from "../../errors/nextly-error";
import {
  PREVIEW_LINKS_TABLE,
  previewLinksTables,
  type PreviewLinkDocumentKind,
} from "../../schemas/preview-links";
import { affectedRowCount } from "../../shared/lib/affected-row-count";

import {
  isSingleScope,
  MAX_PREVIEW_TTL_SECONDS,
  type PreviewTokenScope,
} from "./preview-token";

/**
 * The document a link previews, with no locale.
 *
 * Links are listed and revoked per DOCUMENT: a link limited to one translation
 * of an entry is still one of that entry's links.
 */
export type PreviewLinkDocument =
  | { kind: "entry"; collection: string; entryId: string }
  | { kind: "single"; single: string };

/** The document a token's scope names. */
export function previewLinkDocument(
  scope: PreviewTokenScope
): PreviewLinkDocument {
  return isSingleScope(scope)
    ? { kind: "single", single: scope.single }
    : { kind: "entry", collection: scope.collection, entryId: scope.entryId };
}

/** A recorded link as the live list shows it. */
export interface RecordedPreviewLink {
  id: string;
  locale: string | null;
  /** Null when the maker's account can no longer be read. */
  createdBy: { id: string; name: string | null } | null;
  createdAt: Date;
  expiresAt: Date;
  openCount: number;
  lastOpenedAt: Date | null;
}

/** When links began to be recorded, kept once in `nextly_meta`. */
const RECORDED_SINCE_KEY = "previewLinks.recordedSince";

/** The prefix of each document's cutoff for links made before then. */
const CUTOFF_KEY_PREFIX = "previewLinks.revokedBefore.";

/** How long the window of links made before recording can stay open. */
const OLDER_LINKS_WINDOW_MS = MAX_PREVIEW_TTL_SECONDS * 1000;

/** How long after its end a row is kept before retention removes it. */
export const PREVIEW_LINK_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** How often the retention pass is offered. */
export const PREVIEW_LINKS_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** Rows removed per retention batch. */
const PRUNE_BATCH = 500;

/**
 * The narrow view of the query builder this module uses, the same on every
 * dialect for these statements.
 */
interface LinkDb {
  insert(table: unknown): {
    values(row: Record<string, unknown>): Promise<unknown>;
  };
  update(table: unknown): {
    set(values: Record<string, unknown>): { where(condition: SQL): unknown };
  };
  select(fields: Record<string, unknown>): {
    from(table: unknown): {
      leftJoin(
        table: unknown,
        on: SQL
      ): {
        where(condition: SQL): {
          orderBy(...order: SQL[]): Promise<Array<Record<string, unknown>>>;
        };
      };
      where(condition: SQL): {
        limit(count: number): Promise<Array<Record<string, unknown>>>;
      };
    };
  };
}

function adapter(): DrizzleAdapter {
  return getService("adapter");
}

function dialectOf(db: DrizzleAdapter): SupportedDialect {
  return db.getCapabilities().dialect;
}

function linkDb(db: DrizzleAdapter): LinkDb {
  return db.getDrizzle<LinkDb>();
}

function linksTable(dialect: SupportedDialect) {
  return previewLinksTables(dialect).nextlyPreviewLinks;
}

/** The table's columns, which share names on every dialect. */
type LinksTable = ReturnType<typeof linksTable>;

/** The condition naming one document's rows. */
function documentIs(table: LinksTable, document: PreviewLinkDocument): SQL {
  const condition =
    document.kind === "single"
      ? and(
          eq(table.documentKind, "single"),
          eq(table.documentSlug, document.single),
          isNull(table.entryId)
        )
      : and(
          eq(table.documentKind, "entry"),
          eq(table.documentSlug, document.collection),
          eq(table.entryId, document.entryId)
        );
  // `and` of present conditions always yields one; drizzle types the result
  // as possibly undefined for the empty call.
  return condition as SQL;
}

/** The refusal an install gets before `nextly migrate` has created the table. */
function needsMigrate(error: unknown): NextlyError {
  return NextlyError.serviceUnavailable({
    publicMessage:
      "The database needs updating before preview links can be shared or managed. Run `nextly migrate`.",
    logMessage: "A preview-link operation was refused: its table is missing.",
    cause: error instanceof Error ? error : undefined,
  });
}

function tableMissing(error: unknown): boolean {
  return (["postgresql", "mysql", "sqlite"] as const).some(dialect =>
    isMissingTable(error, dialect)
  );
}

/**
 * Run one statement that manages links, refusing with the migrate remedy when
 * the table is not there. Read from the failure itself, so no request pays for
 * a check that is almost always answered yes.
 */
async function managing<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (tableMissing(error)) throw needsMigrate(error);
    throw error;
  }
}

/**
 * Record a link that has just been signed, before its token is handed out.
 *
 * A failure here means no link: the token is never returned, so an unrecorded
 * new link, which could not be revoked on its own, cannot exist.
 */
export async function recordPreviewLink(input: {
  id: string;
  scope: PreviewTokenScope;
  createdBy: string;
  createdAt: Date;
  expiresAt: Date;
  generation: number;
}): Promise<void> {
  const db = adapter();
  const table = linksTable(dialectOf(db));
  const document = previewLinkDocument(input.scope);
  const kind: PreviewLinkDocumentKind = document.kind;
  await managing(() =>
    linkDb(db)
      .insert(table)
      .values({
        id: input.id,
        documentKind: kind,
        documentSlug:
          document.kind === "single" ? document.single : document.collection,
        entryId: document.kind === "entry" ? document.entryId : null,
        locale: input.scope.locale ?? null,
        createdBy: input.createdBy,
        createdAt: input.createdAt,
        expiresAt: input.expiresAt,
        generation: input.generation,
        openCount: 0,
      })
  );
  // After the row, so a mint that failed to record never starts the window.
  await recordedSince(input.createdAt);
}

/**
 * Count one opening of a recorded link, and say whether it may open.
 *
 * One statement checks and counts: the row is counted only while it is
 * neither revoked nor ended, and the link opens only if a row was counted. A
 * revoked link is therefore never counted, and a revocation landing at the
 * same moment cannot be missed between a check and a count.
 *
 * Answers `false` when the table is missing: a recorded link with no row to
 * judge it by is refused, as any link that cannot be checked is.
 */
export async function openRecordedLink(
  id: string,
  scope: PreviewTokenScope,
  now: Date
): Promise<boolean> {
  const db = adapter();
  const dialect = dialectOf(db);
  const table = linksTable(dialect);
  try {
    const result = await linkDb(db)
      .update(table)
      .set({ openCount: sql`${table.openCount} + 1`, lastOpenedAt: now })
      .where(
        and(
          eq(table.id, id),
          documentIs(table, previewLinkDocument(scope)),
          isNull(table.revokedAt),
          gt(table.expiresAt, now)
        ) as SQL
      );
    return affectedRowCount(result, dialect) === 1;
  } catch (error) {
    if (tableMissing(error)) return false;
    throw error;
  }
}

/**
 * Whether a session a recorded link opened may still render.
 *
 * One primary-key read, after the token's signature has verified. A revoked or
 * missing row is refused, the same as an ended link.
 */
export async function recordedLinkLive(
  id: string,
  scope: PreviewTokenScope,
  now: Date
): Promise<boolean> {
  const db = adapter();
  const table = linksTable(dialectOf(db));
  try {
    const rows = await linkDb(db)
      .select({ id: table.id })
      .from(table)
      .where(
        and(
          eq(table.id, id),
          documentIs(table, previewLinkDocument(scope)),
          isNull(table.revokedAt),
          gt(table.expiresAt, now)
        ) as SQL
      )
      .limit(1);
    return rows.length === 1;
  } catch (error) {
    if (tableMissing(error)) return false;
    throw error;
  }
}

/**
 * One document's live links: not revoked, not ended, and minted under the
 * site's current generation. Newest first.
 */
export async function listLiveLinks(
  document: PreviewLinkDocument,
  generation: number,
  now: Date
): Promise<RecordedPreviewLink[]> {
  const db = adapter();
  const dialect = dialectOf(db);
  const table = linksTable(dialect);
  const { users } = getDialectTables(dialect);
  const rows = await managing(() =>
    linkDb(db)
      .select({
        id: table.id,
        locale: table.locale,
        createdBy: table.createdBy,
        makerId: users.id,
        makerName: users.name,
        makerEmail: users.email,
        createdAt: table.createdAt,
        expiresAt: table.expiresAt,
        openCount: table.openCount,
        lastOpenedAt: table.lastOpenedAt,
      })
      .from(table)
      .leftJoin(users, eq(users.id, table.createdBy))
      .where(
        and(
          documentIs(table, document),
          isNull(table.revokedAt),
          gt(table.expiresAt, now),
          eq(table.generation, generation)
        ) as SQL
      )
      .orderBy(desc(table.createdAt), desc(table.id))
  );
  return rows.map(row => ({
    id: String(row.id),
    locale: (row.locale as string | null) ?? null,
    createdBy:
      typeof row.makerId !== "string"
        ? null
        : {
            id: row.makerId,
            // Their name, else their address: a maker is shown as someone the
            // editor can recognise.
            name:
              (row.makerName as string | null) ??
              (row.makerEmail as string | null) ??
              null,
          },
    createdAt: toDate(row.createdAt),
    expiresAt: toDate(row.expiresAt),
    openCount: Number(row.openCount),
    lastOpenedAt:
      row.lastOpenedAt === null || row.lastOpenedAt === undefined
        ? null
        : toDate(row.lastOpenedAt),
  }));
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(value as string | number);
}

/**
 * Revoke one recorded link of a document.
 *
 * `absent` when no link with that id belongs to the document, which the
 * endpoint answers as not found: a link of another document is reported the
 * same as one that never existed, so ids cannot be probed across documents. A
 * link already revoked is `revoked` again rather than absent, so a second
 * click is not told the link does not exist.
 */
export async function revokeRecordedLink(
  id: string,
  document: PreviewLinkDocument,
  revokedBy: string,
  now: Date
): Promise<"revoked" | "absent"> {
  const db = adapter();
  const dialect = dialectOf(db);
  const table = linksTable(dialect);
  const changed = await managing(async () =>
    affectedRowCount(
      await linkDb(db)
        .update(table)
        .set({ revokedAt: now, revokedBy })
        .where(
          and(
            eq(table.id, id),
            documentIs(table, document),
            isNull(table.revokedAt)
          ) as SQL
        ),
      dialect
    )
  );
  if (changed === 1) return "revoked";
  const existing = await managing(() =>
    linkDb(db)
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.id, id), documentIs(table, document)) as SQL)
      .limit(1)
  );
  return existing.length === 1 ? "revoked" : "absent";
}

/**
 * Revoke every link of one document: each recorded link, and, while links made
 * before recording can still be alive, every one of those too.
 *
 * The cutoff is written FIRST, so a failure between the two leaves the older
 * links ended rather than the recorded ones ended and the older ones not.
 *
 * @returns How many recorded links were revoked.
 */
export async function revokeDocumentLinks(
  document: PreviewLinkDocument,
  revokedBy: string,
  now: Date
): Promise<number> {
  const db = adapter();
  const dialect = dialectOf(db);
  const table = linksTable(dialect);

  const since = await recordedSince(now);
  if (now.getTime() < since.getTime() + OLDER_LINKS_WINDOW_MS) {
    await getService("metaService").set(cutoffKey(document), now.toISOString());
  }

  return managing(async () =>
    affectedRowCount(
      await linkDb(db)
        .update(table)
        .set({ revokedAt: now, revokedBy })
        .where(
          and(documentIs(table, document), isNull(table.revokedAt)) as SQL
        ),
      dialect
    )
  );
}

/**
 * When links began to be recorded: written once, by the first caller to ask,
 * and read back by everyone.
 *
 * Asked by the first mint, the first list and the first revoke-all, whichever
 * comes first. Each runs after this version did, so the moment can only be
 * later than recording truly began, which can only make the older-links row
 * stay longer, never end before an older link could have.
 */
async function recordedSince(now: Date): Promise<Date> {
  const meta = getService("metaService");
  await meta.insertIfAbsent(RECORDED_SINCE_KEY, now.toISOString());
  const stored = await meta.get<string>(RECORDED_SINCE_KEY);
  const at = typeof stored === "string" ? new Date(stored) : null;
  return at !== null && !Number.isNaN(at.getTime()) ? at : now;
}

/**
 * The older-links row's end, while it is still due: the latest moment a link
 * made before recording began could still work. `null` once it has passed.
 */
export async function olderLinksEnd(now: Date): Promise<Date | null> {
  const since = await recordedSince(now);
  const end = new Date(since.getTime() + OLDER_LINKS_WINDOW_MS);
  return end.getTime() > now.getTime() ? end : null;
}

/** The `nextly_meta` key of one document's cutoff, bounded in length. */
function cutoffKey(document: PreviewLinkDocument): string {
  const identity =
    document.kind === "single"
      ? `single\u0000${document.single}`
      : `entry\u0000${document.collection}\u0000${document.entryId}`;
  return `${CUTOFF_KEY_PREFIX}${createHash("sha256").update(identity).digest("hex")}`;
}

/**
 * Whether a link made before recording began may still be used: it may unless
 * a revoke-all of its document came at or after the moment it was minted.
 *
 * To the second, as a token's `iat` is: a link minted in the same second as a
 * revoke-all is refused, deliberately, since which came first cannot be told.
 */
export async function olderLinkStanding(
  scope: PreviewTokenScope,
  issuedAt: Date
): Promise<boolean> {
  const stored = await getService("metaService").get<string>(
    cutoffKey(previewLinkDocument(scope))
  );
  if (typeof stored !== "string") return true;
  const cutoff = new Date(stored);
  if (Number.isNaN(cutoff.getTime())) return false;
  return issuedAt.getTime() > cutoff.getTime();
}

/** What the retention pass needs of the adapter. */
export type PreviewLinksPruneAdapter = Pick<
  DrizzleAdapter,
  "select" | "delete"
> &
  Partial<Pick<DrizzleAdapter, "transaction">>;

/**
 * Remove rows that ended long ago, so the table does not grow one row per link
 * for ever. A row is kept for {@link PREVIEW_LINK_RETENTION_MS} after its end,
 * long enough to answer what happened to a link someone asks about.
 */
export async function prunePreviewLinks(
  db: PreviewLinksPruneAdapter,
  now: Date,
  limits: {
    /** At most this many batches, for a capped pass offered by a write. */
    maxBatches?: number;
    /** Stop between batches once this instant (ms) has passed. */
    deadline?: number;
    /** The clock the deadline is read on; defaults to `Date.now`. */
    clock?: () => number;
  } = {}
): Promise<{ removed: number; started: boolean }> {
  const cutoff = new Date(now.getTime() - PREVIEW_LINK_RETENTION_MS);
  const maxBatches = limits.maxBatches ?? Number.POSITIVE_INFINITY;
  const clock = limits.clock ?? Date.now;
  let removed = 0;
  // Whether a batch was attempted, so a drain whose deadline left no time can
  // give its turn back rather than spend an interval having done nothing.
  let started = false;
  // The same batched sweep the one-purpose secrets use, over another table:
  // select a batch of ended rows, delete exactly those, stop when a batch
  // comes back short.
  // fallow-ignore-next-line code-duplication
  for (let batch = 0; batch < maxBatches; batch++) {
    if (limits.deadline !== undefined && clock() >= limits.deadline) break;
    started = true;
    const rows = await db.select<{ id: string }>(PREVIEW_LINKS_TABLE, {
      columns: ["id"],
      where: { and: [{ column: "expiresAt", op: "<", value: cutoff }] },
      limit: PRUNE_BATCH,
    });
    if (rows.length === 0) break;
    const where = {
      and: [
        { column: "id", op: "IN" as const, value: rows.map(row => row.id) },
        { column: "expiresAt", op: "<" as const, value: cutoff },
      ],
    };
    removed += db.transaction
      ? await db.transaction(tx => tx.delete(PREVIEW_LINKS_TABLE, where))
      : await db.delete(PREVIEW_LINKS_TABLE, where);
    if (rows.length < PRUNE_BATCH) break;
  }
  return { removed, started };
}
