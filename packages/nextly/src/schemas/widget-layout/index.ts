/**
 * `nextly_widget_layout` — dialect-aware barrel.
 *
 * @module schemas/widget-layout
 */

import { createHash } from "node:crypto";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../errors/nextly-error";

import * as my from "./mysql";
import * as pg from "./postgres";
import * as sl from "./sqlite";

export { pg, my, sl };

/** The physical table name, spelled once. */
export const WIDGET_LAYOUT_TABLE = "nextly_widget_layout";

/**
 * Which kind of owner a layout row belongs to.
 *
 * Only `user` is written today. `role` is spelled in the key rather than added
 * later because it is half of what identifies a row, and a key that learns a
 * second value after rows exist is a migration.
 */
export type LayoutScopeKind = "user";

/**
 * The primary key for one scope.
 *
 * 🔴 A DIGEST of the scope, not `${kind}:${scopeId}` spelled out. The readable
 * form does not fit: `id` is `varchar(191)`, and a user id is itself
 * `varchar(191)` on MySQL and unbounded `text` on PostgreSQL — so prefixing
 * `user:` overruns the key for any id past 186 characters. Those accounts can
 * READ the endpoint, because an absent row is a legal answer, and then fail on
 * every save with a database length error: a bug only some installations have,
 * found by the unlucky user rather than by a test.
 *
 * Widening the column is the alternative and it is worse. 191 is the width
 * MySQL will index for a utf8mb4 key, which is why every composite-string key
 * in this codebase is exactly that. A digest is 64 characters whatever the
 * scope is, so no future scope kind — a role slug, a team id — can reintroduce
 * the same overflow.
 *
 * Nothing is lost to an operator: `scope_kind` and `scope_id` are stored as
 * their own readable columns. Declared HERE, beside the table whose key it is,
 * so every reader and every deleter derives it from one implementation rather
 * than two that agree until one of them is edited.
 */
export function layoutRowId(kind: LayoutScopeKind, scopeId: string): string {
  return createHash("sha256").update(`${kind}:${scopeId}`).digest("hex");
}

/**
 * The ONE place a dialect is turned into a layout table.
 *
 * 🔴 A ternary chain ending in a bare `else` would silently assign every future
 * dialect to whichever branch came last, so adding one to `SupportedDialect`
 * would compile and hand back another dialect's table. The `never` assignment
 * below makes the compiler demand a case instead. Same shape, same reason, as
 * `schemas/document-lock/index.ts`.
 */
function layoutForDialect(dialect: SupportedDialect) {
  switch (dialect) {
    case "postgresql":
      return pg.nextlyWidgetLayout;
    case "mysql":
      return my.nextlyWidgetLayout;
    case "sqlite":
      return sl.nextlyWidgetLayout;
    default: {
      const _exhaustive: never = dialect;
      throw NextlyError.internal({
        logContext: {
          reason: "no widget layout table for this dialect",
          dialect: String(_exhaustive),
        },
      });
    }
  }
}

/** The layout table for the requested dialect, as a schema fragment. */
export function widgetLayoutTables(dialect: SupportedDialect) {
  return { nextlyWidgetLayout: layoutForDialect(dialect) };
}
