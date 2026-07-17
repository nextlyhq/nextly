// The prebuilt static drizzle v2 relations per dialect (no dynamic
// edges). Runtime code should prefer SchemaRegistry.getRelations(),
// which layers dynamic-entity edges on top; this helper serves early
// boot paths and BaseService's fallback. Lives in its own module (not
// database/index) so test suites that vi.mock the database barrel
// don't have to know about it.

import type { AnyRelations } from "drizzle-orm";

import { NextlyError } from "../errors/nextly-error";
import { relations as relationsMy } from "../schemas/_dialect-bundles/mysql.relations";
import { relations as relationsPg } from "../schemas/_dialect-bundles/postgres.relations";
import { relations as relationsSl } from "../schemas/_dialect-bundles/sqlite.relations";

export function getStaticRelations(dialect?: string): AnyRelations {
  switch (dialect) {
    case "postgresql":
    case "postgres":
      return relationsPg;
    case "mysql":
      return relationsMy;
    case "sqlite":
      return relationsSl;
    default:
      // No silent fallback: serving another dialect's relations (whose
      // edges close over that dialect's table objects) fails far from the
      // cause with confusing query errors. An unknown/undefined dialect
      // here means the adapter isn't connected or reports a spelling this
      // union doesn't know — fail at the source.
      throw NextlyError.internal({
        logContext: {
          reason:
            `getStaticRelations: unsupported dialect "${String(dialect)}" ` +
            `(expected postgresql | mysql | sqlite)`,
        },
      });
  }
}
