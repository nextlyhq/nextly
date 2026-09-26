/**
 * Which tables a plugin may reach through `ctx.db`.
 *
 * A plugin may use its OWN tables and the tables of plugins it declared in
 * `dependsOn`, and nothing else. Core tables stay behind `ctx.services`, where
 * access control, validation and hooks apply — a plugin reaching `users`
 * directly would bypass all three.
 *
 * `dependsOn` is what makes a cross-plugin read legitimate rather than
 * incidental: a plugin that reads another's table has a real dependency on its
 * shape, and declaring it is what lets the resolver order them and refuse an
 * incompatible version.
 *
 * Checked in EVERY method rather than once at construction. A check at
 * construction describes the tables known at that moment; a reload can add
 * one, and a boundary that was true once is not a boundary.
 *
 * One narrower reach exists beside that: on any table the caller does not own,
 * the columns it CONTRIBUTED through `extendTable` are reachable by the row's
 * key, and nothing more — which opens a column on a table otherwise refused
 * (an entity or core table, or a plugin's table for the app) and gives a
 * write path for a column on a dependency's table. See
 * {@link assertContributedColumnAccess}.
 *
 * @module plugins/database/access
 * @since 1.0.0
 */
import type {
  ExtensionColumn,
  SchemaOwner,
} from "../../domains/schema/extension/types";
import { NextlyError } from "../../errors/nextly-error";

export interface TableAccessRules {
  /** Who is asking. */
  owner: SchemaOwner;
  /** Plugin ids this plugin declared a dependency on. */
  dependsOn: ReadonlySet<string>;
  /** Table name → its owner, from the compiled schema. */
  owners: ReadonlyMap<string, SchemaOwner>;
}

function describe(owner: SchemaOwner): string {
  return owner.kind === "plugin" ? `plugin "${owner.id}"` : "the app";
}

/**
 * Why this caller may not reach a table, or `null` when it may.
 *
 * The rule lives here, once, because two callers ask it two ways: a method
 * about to run a query wants the refusal thrown, and the relational-query
 * namespace wants a yes/no so it can omit a key it would refuse. Asking the
 * question by catching the throw would work until the two drifted.
 */
function denial(
  tableName: string,
  rules: TableAccessRules
): Record<string, string> | null {
  const owner = rules.owners.get(tableName);

  if (!owner) {
    return {
      reason: "table-not-declared",
      table: tableName,
      caller: describe(rules.owner),
    };
  }

  if (rules.owner.kind === "app") {
    // An app reaches its own tables. A plugin's table belongs to that
    // plugin's migrations, and an app writing to it would make those
    // migrations describe a shape nobody maintains.
    if (owner.kind !== "app") {
      return {
        reason: "table-owned-by-plugin",
        table: tableName,
        tableOwner: describe(owner),
      };
    }
    return null;
  }

  if (owner.kind === "plugin" && owner.id === rules.owner.id) return null;
  if (owner.kind === "plugin" && rules.dependsOn.has(owner.id)) return null;

  return {
    reason:
      owner.kind === "plugin"
        ? "table-owner-not-a-declared-dependency"
        : "table-not-reachable",
    table: tableName,
    tableOwner: describe(owner),
    caller: describe(rules.owner),
  };
}

/**
 * Refuse a table this caller may not reach.
 *
 * The message names the reason rather than merely refusing, because the two
 * fixes are different: a missing `dependsOn` entry is a one-line manifest
 * change, and a core table is a redirection to `ctx.services`.
 *
 * `via` says how the table was reached when it was not named directly — a
 * relation followed from another table — and is logged beside the reason, so
 * a refusal raised deep inside a relational query names the edge that led
 * there rather than only a table the caller never wrote down. It cannot
 * change the decision: the reason is computed before it is merged in.
 */
export function assertTableAccess(
  tableName: string,
  rules: TableAccessRules,
  via?: Record<string, string>
): void {
  const refusal = denial(tableName, rules);
  if (refusal) {
    throw NextlyError.forbidden({ logContext: { ...via, ...refusal } });
  }
}

/** The same rule, answered rather than thrown. */
export function canAccessTable(
  tableName: string,
  rules: TableAccessRules
): boolean {
  return denial(tableName, rules) === null;
}

/** One column contributed to a table the contributor does not own. */
export interface ContributedColumn {
  /** SQL column name. */
  name: string;
  /** The key the contributor declared it under. */
  key: string;
  /** Who contributed it; a column with none recorded is nobody's to reach. */
  contributedBy: SchemaOwner | undefined;
  /**
   * The column as compiled, from which a query builds its handle on it. A core
   * table's runtime definition is static and never carries contributions, so
   * the handle cannot be looked up there.
   */
  spec: ExtensionColumn;
}

function sameOwner(a: SchemaOwner, b: SchemaOwner): boolean {
  if (a.kind === "plugin" && b.kind === "plugin") return a.id === b.id;
  return a.kind === "app" && b.kind === "app";
}

/**
 * The contributed columns this caller may reach on `tableName`, or a refusal.
 *
 * The one rule for the columns a caller added to a table it does not own,
 * whether or not {@link assertTableAccess} lets it reach that table:
 *
 * - A table it may NOT reach — a collection, Single or field-group table, an
 *   extendable core table, or, for the app, a plugin's table — stays refused
 *   as a table. Its rows belong to their owner; the contributor reaches the
 *   storage it added, and only that.
 * - A table it MAY reach — a declared dependency's — already grants every
 *   column to the ordinary methods, so this is a narrower handle over the same
 *   grant. It is the one that can write the caller's own column there, since
 *   the owner's definition, which the ordinary methods write through, does not
 *   declare it.
 *
 * Either way every column named must be one the CALLER contributed: another
 * contributor's column and the table's own columns are refused alike,
 * whichever method asked — the read's selection and the write's set are both
 * judged here, before anything runs. A table the caller contributed nothing to
 * therefore has no column to name, reachable or not.
 */
export function assertContributedColumnAccess(
  tableName: string,
  keys: readonly string[],
  rules: TableAccessRules,
  contributions: ReadonlyMap<string, readonly ContributedColumn[]>
): ContributedColumn[] {
  // Annotated so a call narrows like a `throw` does.
  const refuse: (detail: Record<string, string>) => never = detail => {
    throw NextlyError.forbidden({
      logContext: {
        table: tableName,
        caller: describe(rules.owner),
        ...detail,
      },
    });
  };

  if (keys.length === 0) {
    throw NextlyError.invalidInput({
      message: `Name at least one column you contributed to "${tableName}".`,
      logContext: { reason: "no-contributed-columns-named", table: tableName },
    });
  }
  const available = contributions.get(tableName) ?? [];
  return keys.map(key => {
    const column = available.find(candidate => candidate.key === key);
    if (column === undefined) {
      refuse({ reason: "column-not-contributed", column: key });
    }
    if (
      column.contributedBy === undefined ||
      !sameOwner(column.contributedBy, rules.owner)
    ) {
      refuse({
        reason: "column-contributed-by-another-owner",
        column: key,
        contributor:
          column.contributedBy === undefined
            ? "unrecorded"
            : describe(column.contributedBy),
      });
    }
    return column;
  });
}
