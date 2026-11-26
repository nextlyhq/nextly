/**
 * The tables a statement drops, each as the database stores its name. Kept apart, and light to
 * import, since a migration's writer and its runner both read drops this way.
 *
 * @module domains/schema/migrate/stored-names
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { tablesDroppedIn } from "../ownership/drop-guard";

import { statementTokens } from "./split-sql";

/**
 * The tables `statement` drops, each as the database stores its name: on PostgreSQL an unquoted name
 * folded to lower case and a quoted one as written, so `posts` is never `"Posts"`; elsewhere as
 * written, compared without regard to case by the caller where the database does so. Empty for a
 * statement that drops none, or that the drop guard's reader cannot read.
 */
export function storedNamesDroppedIn(
  statement: string,
  dialect: SupportedDialect
): string[] {
  const lowered = tablesDroppedIn(statement, dialect);
  if (dialect !== "postgresql" || lowered.length === 0) return lowered;
  const stored = statementTokens(statement, dialect).flatMap(token =>
    typeof token === "string"
      ? [token.toLowerCase()]
      : token.kind === "name" && token.escaped !== true
        ? [token.written ?? token.name ?? ""]
        : []
  );
  // Each name the list drops, in the one spelling its own token gives it.
  return lowered.flatMap(name =>
    stored.filter(each => each.toLowerCase() === name).slice(0, 1)
  );
}
