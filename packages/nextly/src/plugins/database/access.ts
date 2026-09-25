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
 * @module plugins/database/access
 * @since 1.0.0
 */
import type { SchemaOwner } from "../../domains/schema/extension/types";
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
