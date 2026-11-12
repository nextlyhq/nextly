/**
 * Reads a production start's catalog (`start-catalog-scope`): the relations, then the columns,
 * indexes and constraints of every one a start can reach, with the reads of each step sent
 * together. Two waits on PostgreSQL and MySQL, and a handful of statements on SQLite, however
 * many tables the database holds.
 *
 * @module domains/schema/pipeline/diff/start-catalog
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import {
  readMysqlIdentifierCaseRules,
  type RawSqlExecutor,
} from "../../utils/read-identifier-case";
import { identifierCaseRules } from "../../utils/resolve-catalog-name";

import { introspectRelations, readLiveSnapshot } from "./introspect-live";
import type { StartCatalog } from "./start-catalog-scope";

/** Begin reading the catalog through `db`; each part is read once, as soon as it can be. */
export function readStartCatalog(
  db: unknown,
  dialect: SupportedDialect
): StartCatalog {
  const relations = introspectRelations(db, dialect);
  const caseRules =
    dialect === "mysql"
      ? readMysqlIdentifierCaseRules(db as RawSqlExecutor)
      : Promise.resolve(identifierCaseRules({ dialect }));
  const snapshot = relations.then(list =>
    readLiveSnapshot(
      db,
      dialect,
      // What a read of a named relation would describe: SQLite's PRAGMAs describe a view too.
      list
        .filter(relation => relation.reachable || dialect === "sqlite")
        .map(relation => relation.name),
      { parallel: true }
    )
  );
  // Each part is awaited by whichever question needs it, and some starts ask none of them: a
  // rejection nobody awaited would otherwise end the process.
  for (const part of [relations, caseRules, snapshot]) part.catch(() => {});
  return { relations, snapshot, caseRules };
}
