/**
 * Reads and writes one scope's dashboard arrangement.
 *
 * The row is a cache of a DECISION, not of data: it records where somebody put
 * their cards, and nothing about what those cards contain or who may see them.
 * Every such question is asked of the live registry by the endpoint above this,
 * on every read.
 *
 * @module services/widgets/widget-layout-service
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { and, eq } from "drizzle-orm";

import { loadedDialect } from "../../database/dialect-tables";
import {
  readStoredLayout,
  serializeLayout,
  type StoredLayout,
  type WidgetPlacement,
} from "../../domains/widgets/layout";
import { NextlyError } from "../../errors/nextly-error";
import { layoutRowId, type LayoutScopeKind } from "../../schemas/widget-layout";
import type { nextlyWidgetLayout as layoutMysql } from "../../schemas/widget-layout/mysql";
import type { nextlyWidgetLayout as layoutPg } from "../../schemas/widget-layout/postgres";
import type { nextlyWidgetLayout as layoutSqlite } from "../../schemas/widget-layout/sqlite";
import { affectedRowCount } from "../../shared/lib/affected-row-count";
import { BaseService } from "../base-service";
import type { Logger } from "../shared";

/** The version a caller holds when they have never read a stored row. */
export const NO_STORED_LAYOUT_VERSION = 0;

/**
 * What one scope currently has stored.
 *
 * `layout` is `undefined` when no row exists, when the row is of an earlier
 * format, and when the row could not be decoded, and `unreadable` is what tells
 * the last apart. The caller needs the distinction: the first two are a reader
 * with no saved arrangement, who follows the default, and the third is a fault
 * an operator should see.
 *
 * `version` is the row's own whenever there is a row, an earlier-format one
 * included, so the reader's next write takes the guarded UPDATE that replaces
 * it rather than an INSERT that would collide with it.
 */
export interface StoredLayoutRow {
  layout: StoredLayout | undefined;
  version: number;
  unreadable: boolean;
}

/**
 * The layout table for whichever dialect is running.
 *
 * A union of the three real table objects rather than `any`. The three declare
 * the same column names, so every property this service reaches for resolves on
 * all three arms; what the union buys is that a column this service invents, or
 * one renamed in a schema and not here, stops compiling instead of failing at
 * runtime on somebody's install.
 */
type LayoutTable = typeof layoutPg | typeof layoutMysql | typeof layoutSqlite;

/**
 * The ONE place a dialect is turned into a layout table.
 *
 * A `switch` with a `never` default rather than a lookup, so adding a dialect
 * to `SupportedDialect` fails to compile here instead of resolving to whichever
 * arm happened to come last.
 */
function layoutTableFor(dialect: SupportedDialect): LayoutTable {
  switch (dialect) {
    case "postgresql":
    case "mysql":
    case "sqlite":
      // The loaded dialect's own table, so only that dialect's file is
      // imported; `createAdapter` loads it.
      return loadedDialect(dialect).tables.nextlyWidgetLayout;
    default: {
      const exhaustive: never = dialect;
      throw NextlyError.internal({
        logContext: {
          reason: "no widget layout table for this dialect",
          dialect: String(exhaustive),
        },
      });
    }
  }
}

export class WidgetLayoutService extends BaseService {
  private readonly table: LayoutTable;

  constructor(adapter: DrizzleAdapter, logger: Logger) {
    super(adapter, logger);

    this.table = layoutTableFor(this.dialect);
  }

  /**
   * The stored arrangement for one scope, or the absence of one.
   *
   * A row that cannot be decoded is LOGGED and reported as unreadable rather
   * than thrown onward. `readStoredLayout` throws on purpose -- a persisted
   * record must not vanish silently -- and this is the layer that decides what
   * to do about it: the dashboard still draws, from the registry's own order,
   * and the response says so. Letting the throw reach the endpoint would answer
   * the whole dashboard with a 500 that no amount of clicking could clear,
   * because the offending row would still be there on the next request.
   */
  async getLayout(
    kind: LayoutScopeKind,
    scopeId: string
  ): Promise<StoredLayoutRow> {
    const rows = await this.db
      .select()
      .from(this.table)
      .where(eq(this.table.id, layoutRowId(kind, scopeId)))
      .limit(1);

    const row = rows?.[0] as
      | { layout?: unknown; version?: unknown }
      | undefined;
    if (!row) {
      return {
        layout: undefined,
        version: NO_STORED_LAYOUT_VERSION,
        unreadable: false,
      };
    }

    const version =
      typeof row.version === "number" ? row.version : NO_STORED_LAYOUT_VERSION;

    try {
      // `undefined` for a row of an earlier format: no saved arrangement, and
      // left exactly as it is, since a read never writes.
      const layout = readStoredLayout(String(row.layout));
      // 🔴 The repair is invisible to the reader and must not be invisible to
      // an operator. Resolving the repeat per caller keeps the dashboard whole,
      // which also means nothing on screen ever reports that the row is
      // malformed -- and the row stays malformed until this reader's next save.
      // Whatever wrote the duplicate would otherwise go on writing them
      // unobserved, so the one place the defect can still be found is here.
      if (layout?.duplicatePlacementIds !== undefined) {
        this.logger.warn("Stored dashboard layout holds a placement id twice", {
          scopeKind: kind,
          scopeId,
          version,
          duplicatePlacementIds: layout.duplicatePlacementIds,
        });
      }
      return { layout, version, unreadable: false };
    } catch (error) {
      this.logger.error("Unreadable dashboard layout row", {
        scopeKind: kind,
        scopeId,
        version,
        ...(NextlyError.is(error)
          ? error.toLogJSON("widget-layout")
          : { err: error instanceof Error ? error.stack : String(error) }),
      });
      return { layout: undefined, version, unreadable: true };
    }
  }

  /**
   * Replaces one scope's arrangement, refusing if it moved since the caller
   * read it.
   *
   * The guard is the WHERE clause, not the read before it. Two tabs belonging
   * to one person can both read version 3 and both submit; comparing in
   * application code would let both pass, and the second would overwrite the
   * first with no sign. `WHERE version = ?` makes the database settle it: the
   * second statement matches no row, and this reports the conflict rather than
   * a success.
   *
   * `expectedVersion === NO_STORED_LAYOUT_VERSION` means "I believe there is no
   * row", which is an INSERT. A concurrent insert loses on the primary key,
   * which surfaces as a driver error rather than as a clean conflict.
   *
   * 🔴 That is classified by ASKING THE DATABASE whether a row now exists, not
   * by catching every throw. A bare catch answered a dropped connection, an
   * over-long payload and a missing table with "reload and try again" -- so the
   * client re-read version 0, retried, and looped, while no operator ever saw a
   * write fault. Re-reading discriminates without parsing a driver's error
   * codes, which differ per dialect and are the other way this gets written
   * wrong. Anything that is not a lost race is rethrown unchanged;
   * `withErrorHandler` already wraps an unclassified throw as `internal` with a
   * generic public message, so nothing leaks by letting it through.
   */
  async saveLayout(
    kind: LayoutScopeKind,
    scopeId: string,
    placements: readonly WidgetPlacement[],
    expectedVersion: number,
    // Whether this write is a reader taking charge of the arrangement. The
    // caller resolves it -- including keeping an arranged row arranged -- and
    // this only records the answer; see `layoutIsArranged`.
    arranged = true
  ): Promise<number> {
    const id = layoutRowId(kind, scopeId);
    const layout = serializeLayout(placements, arranged);
    const now = new Date();

    if (expectedVersion === NO_STORED_LAYOUT_VERSION) {
      try {
        await this.db.insert(this.table).values({
          id,
          scopeKind: kind,
          scopeId,
          layout,
          version: 1,
          updatedAt: now,
        });
        return 1;
      } catch (error) {
        // Only a row that is now THERE makes this a lost race. `select` rather
        // than `getLayout`, because a row whose payload cannot be decoded still
        // occupies the primary key and still means this insert lost.
        if (await this.rowExists(id)) throw layoutConflict(error);
        throw error;
      }
    }

    const nextVersion = expectedVersion + 1;
    const result = await this.db
      .update(this.table)
      .set({ layout, version: nextVersion, updatedAt: now })
      .where(
        and(eq(this.table.id, id), eq(this.table.version, expectedVersion))
      );

    if (affectedRowCount(result, this.dialect) === 0) {
      throw layoutConflict();
    }
    return nextVersion;
  }

  /**
   * Removes one scope's arrangement, so its reader follows the default
   * dashboard again -- refusing if the row moved since the caller read it.
   *
   * 🔴 Guarded like every other write. A reset is staged in one tab and saved
   * later; another tab may have saved an arrangement in between, and an
   * unguarded delete would remove that newer arrangement, cards the stale tab
   * never saw included. So the delete names the version it was staged against
   * and the database settles it in the WHERE clause, as `saveLayout` does.
   *
   * A row that is already GONE is a reset that has already happened, which is
   * the state the caller asked for, so it answers as a success. Only a row that
   * is still there at another version is a conflict: that is the newer
   * arrangement the guard exists to keep. `NO_STORED_LAYOUT_VERSION` means the
   * caller believes there is no row, so any row found then is a newer one.
   */
  async deleteLayout(
    kind: LayoutScopeKind,
    scopeId: string,
    expectedVersion: number
  ): Promise<void> {
    const id = layoutRowId(kind, scopeId);
    if (expectedVersion !== NO_STORED_LAYOUT_VERSION) {
      const result = await this.db
        .delete(this.table)
        .where(
          and(eq(this.table.id, id), eq(this.table.version, expectedVersion))
        );
      if (affectedRowCount(result, this.dialect) > 0) return;
    }
    if (await this.rowExists(id)) throw layoutConflict();
  }

  /**
   * Whether a row is stored under this id, whatever its payload holds. A row
   * whose payload cannot be decoded still occupies the key, so this selects
   * the id alone rather than reading the row through the decoder.
   */
  private async rowExists(id: string): Promise<boolean> {
    const existing = await this.db
      .select({ id: this.table.id })
      .from(this.table)
      .where(eq(this.table.id, id))
      .limit(1);
    return Boolean(existing?.length);
  }
}

/**
 * The one refusal a client is expected to recover from, by re-reading.
 *
 * `conflict` rather than `validation`: nothing about the submitted layout is
 * wrong, and telling a client its body was invalid would send it to fix a
 * document that is already correct.
 *
 * 409 with `reason: "version"`, which is this package's existing spelling for
 * exactly this situation, rather than the 412 the design note sketched. A lone
 * 412 would be the only one in the API, and `parseApiError` already gives
 * clients a `CONFLICT` code to branch on -- a second status meaning the same
 * thing buys nothing and costs every client a special case.
 */
function layoutConflict(cause?: unknown): NextlyError {
  return NextlyError.conflict({
    reason: "version",
    message:
      "The dashboard layout changed since you loaded it. Reload and try again.",
    ...(cause instanceof Error ? { cause } : {}),
  });
}
