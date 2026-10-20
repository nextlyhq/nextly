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
import { and, count, desc, eq, gt, isNull, sql, type SQL } from "drizzle-orm";

import { getDialectTables } from "../../database/index";
import { container, getService } from "../../di";
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
  delete(table: unknown): { where(condition: SQL): Promise<unknown> };
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
          orderBy(...order: SQL[]): {
            limit(count: number): {
              offset(count: number): Promise<Array<Record<string, unknown>>>;
            };
          };
        };
      };
      where(condition: SQL): {
        limit(count: number): Promise<Array<Record<string, unknown>>>;
      } & Promise<Array<Record<string, unknown>>>;
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
  /** When the mint began, before its token was signed. */
  mintStartedAt: Date;
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
  // A revoke-all of this document that began after this mint did may have
  // revoked the document's rows before this one existed, leaving it working
  // after the editor was told every link had stopped. The mint is the side
  // that can still back out, since its token has not left the process: the
  // row goes and no link is handed out.
  const cutoff = await getService("metaService").get<string>(
    cutoffKey(document)
  );
  // A site-wide revoke that moved the generation after this mint read it
  // ends every token signed under the old one, this one included, before it
  // was handed out: the row would be a live record of a dead link.
  const currentGeneration = await container
    .get<{
      getPreviewTokenGeneration(): Promise<number>;
    }>("generalSettingsService")
    .getPreviewTokenGeneration();
  if (
    currentGeneration !== input.generation ||
    (typeof cutoff === "string" &&
      new Date(cutoff).getTime() >= input.mintStartedAt.getTime())
  ) {
    await linkDb(db).delete(table).where(eq(table.id, input.id));
    throw NextlyError.conflict({
      reason: "state",
      message:
        "Links were revoked while this one was being made, so it was not created. Make it again.",
      logContext: { reason: "preview-link-mint-crossed-revoke-all" },
    });
  }

  // After the row, so a mint that failed to record never starts the window.
  await recordedSince(input.createdAt, input.generation);
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
 * One page of a document's live links: not revoked, not ended, and minted
 * under the site's current generation. Newest first, paged in the database:
 * nothing bounds how many links one document can have, so the list is never
 * read whole.
 *
 * @returns The page, and how many live links there are in all.
 */
export async function listLiveLinks(
  document: PreviewLinkDocument,
  generation: number,
  now: Date,
  page: { limit: number; offset: number }
): Promise<{ links: RecordedPreviewLink[]; total: number }> {
  const db = adapter();
  const dialect = dialectOf(db);
  const table = linksTable(dialect);
  const { users } = getDialectTables(dialect);
  const live = and(
    documentIs(table, document),
    isNull(table.revokedAt),
    gt(table.expiresAt, now),
    eq(table.generation, generation)
  ) as SQL;
  const [counted] = await managing(() =>
    linkDb(db).select({ total: count() }).from(table).where(live)
  );
  const rows = await managing(() =>
    linkDb(db)
      .select({
        id: table.id,
        locale: table.locale,
        createdBy: table.createdBy,
        makerId: users.id,
        makerName: users.name,
        createdAt: table.createdAt,
        expiresAt: table.expiresAt,
        openCount: table.openCount,
        lastOpenedAt: table.lastOpenedAt,
      })
      .from(table)
      .leftJoin(users, eq(users.id, table.createdBy))
      .where(live)
      .orderBy(desc(table.createdAt), desc(table.id))
      .limit(page.limit)
      .offset(page.offset)
  );
  const links = rows.map(row => ({
    id: String(row.id),
    locale: (row.locale as string | null) ?? null,
    createdBy:
      typeof row.makerId !== "string"
        ? null
        : {
            id: row.makerId,
            // The name only, never the address: a person who may share this
            // document need not be one who may read user accounts.
            name: (row.makerName as string | null) ?? null,
          },
    createdAt: toDate(row.createdAt),
    expiresAt: toDate(row.expiresAt),
    openCount: Number(row.openCount),
    lastOpenedAt:
      row.lastOpenedAt === null || row.lastOpenedAt === undefined
        ? null
        : toDate(row.lastOpenedAt),
  }));
  return { links, total: Number(counted?.total ?? 0) };
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(value as string | number);
}

/**
 * Revoke one recorded link of a document.
 *
 * `absent` when no link with that id belongs to the document, which the
 * endpoint answers as not found: a link of another document is reported the
 * same as one that never existed, so ids cannot be probed across documents.
 * `already` when it was revoked before, with the moment it was: a repeated or
 * racing request changes nothing and is told when the revocation that did
 * happen, rather than claiming one of its own.
 */
export async function revokeRecordedLink(
  id: string,
  document: PreviewLinkDocument,
  revokedBy: string,
  now: Date
): Promise<
  | { outcome: "revoked"; revokedAt: Date }
  | { outcome: "already"; revokedAt: Date }
  | { outcome: "absent" }
> {
  const db = adapter();
  const dialect = dialectOf(db);
  const table = linksTable(dialect);
  // To the second, the finest every dialect stores, so the moment this answers
  // is the one a repeated request reads back.
  const at = new Date(Math.floor(now.getTime() / 1000) * 1000);
  const changed = await managing(async () =>
    affectedRowCount(
      await linkDb(db)
        .update(table)
        .set({ revokedAt: at, revokedBy })
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
  if (changed === 1) return { outcome: "revoked", revokedAt: at };
  const [existing] = await managing(() =>
    linkDb(db)
      .select({ revokedAt: table.revokedAt })
      .from(table)
      .where(and(eq(table.id, id), documentIs(table, document)) as SQL)
      .limit(1)
  );
  if (existing === undefined) return { outcome: "absent" };
  return {
    outcome: "already",
    revokedAt:
      existing.revokedAt === null || existing.revokedAt === undefined
        ? at
        : toDate(existing.revokedAt),
  };
}

/**
 * Revoke every link of one document: each recorded link, and every link of it
 * made without a record.
 *
 * The cutoff is written on every revoke-all, not only in the first days after
 * recording began. During a rolling upgrade an instance still on the earlier
 * version keeps minting links without a record after another has begun
 * recording, and each of those can work for up to seven days after its own
 * mint, which no fixed window can bound. One key per document, overwritten.
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

  await advanceCutoff(cutoffKey(document), now);

  try {
    return affectedRowCount(
      await linkDb(db)
        .update(table)
        .set({ revokedAt: now, revokedBy })
        .where(
          and(documentIs(table, document), isNull(table.revokedAt)) as SQL
        ),
      dialect
    );
  } catch (error) {
    // A database not yet updated has no table, so no recorded link: the
    // cutoff above has ended every link there is, and that is the answer.
    if (tableMissing(error)) return 0;
    throw error;
  }
}

/**
 * Move a document's cutoff to `now`, never back.
 *
 * Two revoke-alls can overlap, and instances' clocks differ: a slower one
 * finishing last would otherwise write an earlier moment over a later one, and
 * a link without a record minted between the two would work again. Moved only
 * by a compare-and-set against the value read, retried if another moved it.
 */
async function advanceCutoff(key: string, now: Date): Promise<void> {
  const meta = getService("metaService");
  const next = now.toISOString();
  for (let attempt = 0; attempt < 5; attempt++) {
    const entry = await meta.getEntry<string>(key);
    if (!entry.present) {
      await meta.insertIfAbsent(key, next);
      const settled = await meta.get<string>(key);
      if (settled === next) return;
      continue;
    }
    const current = typeof entry.value === "string" ? entry.value : null;
    if (current !== null && new Date(current).getTime() >= now.getTime()) {
      return;
    }
    if (await meta.compareAndSet(key, entry.value, next)) return;
  }
  // Still contended after retries: another revoke-all is moving it forward
  // too, and a later moment is what both want.
}

/**
 * Mark every recorded link revoked, at the moment of a site-wide revoke.
 *
 * The generation already ends them; this records WHEN, so retention keeps
 * them for its window from that moment rather than from their scheduled end,
 * and the rows say what happened to them. Only links still live are marked:
 * one already ended needs nothing, so the statement reaches at most the links
 * of the last seven days. A database not yet updated has no rows to mark.
 */
export async function revokeAllRecordedLinks(
  revokedBy: string,
  now: Date
): Promise<void> {
  const db = adapter();
  const table = linksTable(dialectOf(db));
  const at = new Date(Math.floor(now.getTime() / 1000) * 1000);
  try {
    await linkDb(db)
      .update(table)
      .set({ revokedAt: at, revokedBy })
      .where(and(isNull(table.revokedAt), gt(table.expiresAt, at)) as SQL);
  } catch (error) {
    if (tableMissing(error)) return;
    throw error;
  }
}

/**
 * When links began to be recorded, and the site-wide generation then: written
 * once, by the first caller to ask, and read back by everyone.
 *
 * Asked by the first mint and the first list, whichever comes first. Each runs
 * after this version did, so the moment can only be later than recording
 * truly began, which can only make the older-links row stay longer, never end
 * before an older link could have. The generation says whether a site-wide
 * revoke has happened since, which ends every older link at once.
 */
async function recordedSince(
  now: Date,
  generation: number
): Promise<{ at: Date; generation: number }> {
  const meta = getService("metaService");
  await meta.insertIfAbsent(RECORDED_SINCE_KEY, {
    at: now.toISOString(),
    generation,
  });
  const stored = await meta.get<{ at?: unknown; generation?: unknown }>(
    RECORDED_SINCE_KEY
  );
  const at =
    typeof stored?.at === "string" ? new Date(stored.at) : new Date(NaN);
  return {
    at: Number.isNaN(at.getTime()) ? now : at,
    generation:
      typeof stored?.generation === "number" ? stored.generation : generation,
  };
}

/**
 * The older-links row's end for one document, while it is still due: the
 * latest moment a link made before recording began could still work.
 *
 * `null` once that has passed, once a site-wide revoke has moved the
 * generation since recording began, and once a revoke-all of the document has
 * written its cutoff. Each of the last two ends every older link in its reach:
 * once the upgrade is complete, no link without a record is minted any more.
 */
export async function olderLinksEnd(
  document: PreviewLinkDocument,
  now: Date,
  generation: number
): Promise<Date | null> {
  const since = await recordedSince(now, generation);
  const end = new Date(since.at.getTime() + OLDER_LINKS_WINDOW_MS);
  if (end.getTime() <= now.getTime()) return null;
  if (generation !== since.generation) return null;
  const cutoff = await getService("metaService").get<string>(
    cutoffKey(document)
  );
  return typeof cutoff === "string" ? null : end;
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
 * its expiry or its revocation, whichever came first: long enough to answer
 * what happened to a link someone asks about.
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
    // A link ends at whichever comes first, its expiry or its revocation,
    // and is kept for the retention window from that end.
    const ended = {
      or: [
        { column: "expiresAt", op: "<" as const, value: cutoff },
        { column: "revokedAt", op: "<" as const, value: cutoff },
      ],
    };
    const rows = await db.select<{ id: string }>(PREVIEW_LINKS_TABLE, {
      columns: ["id"],
      where: ended,
      limit: PRUNE_BATCH,
    });
    if (rows.length === 0) break;
    const where = {
      and: [
        { column: "id", op: "IN" as const, value: rows.map(row => row.id) },
        ended,
      ],
    };
    removed += db.transaction
      ? await db.transaction(tx => tx.delete(PREVIEW_LINKS_TABLE, where))
      : await db.delete(PREVIEW_LINKS_TABLE, where);
    if (rows.length < PRUNE_BATCH) break;
  }
  return { removed, started };
}
