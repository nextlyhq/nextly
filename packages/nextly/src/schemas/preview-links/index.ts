/**
 * The preview-link table - dialect-aware barrel.
 *
 * @module schemas/preview-links
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../errors";

import * as my from "./mysql";
import * as pg from "./postgres";
import * as sl from "./sqlite";

export { pg, my, sl };
export * from "./types";

/** Returns the Drizzle table object for recorded preview links. */
export function previewLinksTables(dialect: SupportedDialect) {
  switch (dialect) {
    case "postgresql":
      return { nextlyPreviewLinks: pg.nextlyPreviewLinksPg };
    case "mysql":
      return { nextlyPreviewLinks: my.nextlyPreviewLinksMysql };
    case "sqlite":
      return { nextlyPreviewLinks: sl.nextlyPreviewLinksSqlite };
    default: {
      const _exhaustive: never = dialect;
      // Unreachable given the SupportedDialect union; the `never` assignment is
      // the compile-time exhaustiveness guard.
      throw NextlyError.internal({
        logContext: { dialect: String(_exhaustive) },
      });
    }
  }
}
