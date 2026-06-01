/**
 * Media tables — dialect-aware barrel.
 *
 * Re-exports per-dialect Drizzle tables (media, mediaFolders, imageSizes)
 * under canonical names. The runtime dialect determines which set of tables a
 * caller sees.
 *
 * @module schemas/media
 * @since v0.0.3-alpha (Plan A — schemas consolidation)
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import * as my from "./mysql";
import * as pg from "./postgres";
import * as sl from "./sqlite";

export { pg, my, sl };

/**
 * Returns Drizzle table objects for the media feature group, for the
 * requested dialect.
 */
export function mediaTables(dialect: SupportedDialect) {
  switch (dialect) {
    case "postgresql":
      return {
        media: pg.media,
        mediaFolders: pg.mediaFolders,
        imageSizes: pg.imageSizes,
      };
    case "mysql":
      return {
        media: my.media,
        mediaFolders: my.mediaFolders,
        imageSizes: my.imageSizes,
      };
    case "sqlite":
      return {
        media: sl.media,
        mediaFolders: sl.mediaFolders,
        imageSizes: sl.imageSizes,
      };
    default: {
      // Exhaustiveness check — TypeScript flags any missing dialect at compile time.
      const _exhaustive: never = dialect;
      throw new Error(`Unsupported dialect: ${String(_exhaustive)}`);
    }
  }
}
