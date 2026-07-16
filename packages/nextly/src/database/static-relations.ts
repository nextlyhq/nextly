// The prebuilt static drizzle v2 relations per dialect (no dynamic
// edges). Runtime code should prefer SchemaRegistry.getRelations(),
// which layers dynamic-entity edges on top; this helper serves early
// boot paths and BaseService's fallback. Lives in its own module (not
// database/index) so test suites that vi.mock the database barrel
// don't have to know about it.

import type { AnyRelations } from "drizzle-orm";

import { relations as relationsMy } from "../schemas/_dialect-bundles/mysql.relations";
import { relations as relationsPg } from "../schemas/_dialect-bundles/postgres.relations";
import { relations as relationsSl } from "../schemas/_dialect-bundles/sqlite.relations";

export function getStaticRelations(dialect?: string): AnyRelations {
  if (dialect === "postgresql" || dialect === "postgres") {
    return relationsPg;
  }
  if (dialect === "mysql") return relationsMy;
  return relationsSl;
}
