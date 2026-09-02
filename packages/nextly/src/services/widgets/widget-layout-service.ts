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
import { and, eq } from "drizzle-orm";

import {
  readStoredLayout,
  serializeLayout,
  type StoredLayout,
  type WidgetPlacement,
} from "../../domains/widgets/layout";
import { NextlyError } from "../../errors/nextly-error";
import { nextlyWidgetLayout as layoutMysql } from "../../schemas/widget-layout/mysql";
import { nextlyWidgetLayout as layoutPg } from "../../schemas/widget-layout/postgres";
import { nextlyWidgetLayout as layoutSqlite } from "../../schemas/widget-layout/sqlite";
import { affectedRowCount } from "../../shared/lib/affected-row-count";
import { BaseService } from "../base-service";
import type { Logger } from "../shared";

/**
 * Which kind of owner a layout row belongs to.
 *
 * Only `user` is written today. `role` is spelled here rather than added later
 * because it is half of the primary key, and a key that learns a second value
 * after rows exist is a migration.
 */
export type LayoutScopeKind = "user";

/** The version a caller holds when they have never read a stored row. */
export const NO_STORED_LAYOUT_VERSION = 0;

/**
 * What one scope currently has stored.
 *
 * `layout` is `undefined` both when no row exists and when the row could not be
 * decoded, and `unreadable` is what tells those apart. The caller needs the
 * distinction: the first is an ordinary new reader, the second is a fault an
 * operator should see.
 */
export interface StoredLayoutRow {
  layout: StoredLayout | undefined;
  version: number;
  unreadable: boolean;
}

function rowId(kind: LayoutScopeKind, scopeId: string): string {
  return `${kind}:${scopeId}`;
}

export class WidgetLayoutService extends BaseService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private table: any;

  constructor(adapter: DrizzleAdapter, logger: Logger) {
    super(adapter, logger);

    switch (this.dialect) {
      case "postgresql":
        this.table = layoutPg;
        break;
      case "mysql":
        this.table = layoutMysql;
        break;
      case "sqlite":
        this.table = layoutSqlite;
        break;
      default:
        throw NextlyError.internal({
          logContext: {
            reason: "no widget layout table for this dialect",
            dialect: String(this.dialect),
          },
        });
    }
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
      .where(eq(this.table.id, rowId(kind, scopeId)))
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
      return {
        layout: readStoredLayout(String(row.layout)),
        version,
        unreadable: false,
      };
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
    expectedVersion: number
  ): Promise<number> {
    const id = rowId(kind, scopeId);
    const layout = serializeLayout(placements);
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
        const existing = await this.db
          .select({ id: this.table.id })
          .from(this.table)
          .where(eq(this.table.id, id))
          .limit(1);
        if (existing?.length) throw layoutConflict(error);
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
