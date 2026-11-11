/**
 * A dialect as people name it, for the header of a migration file and the
 * CLI's output. A leaf with no CLI import, so the file writer the server runs
 * for a Schema Builder save shares it with `migrate:create`.
 *
 * @module domains/schema/migrate-create/dialect-name
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

/** The human-readable name of `dialect`. */
export function getDialectDisplayName(dialect: SupportedDialect): string {
  switch (dialect) {
    case "postgresql":
      return "PostgreSQL";
    case "mysql":
      return "MySQL";
    case "sqlite":
      return "SQLite";
    default:
      return dialect;
  }
}
