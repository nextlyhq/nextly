/**
 * `nextly_widget_layout` — dialect-aware barrel.
 *
 * @module schemas/widget-layout
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../errors/nextly-error";

import * as my from "./mysql";
import * as pg from "./postgres";
import * as sl from "./sqlite";

export { pg, my, sl };

/** The physical table name, spelled once. */
export const WIDGET_LAYOUT_TABLE = "nextly_widget_layout";

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
