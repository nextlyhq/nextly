/**
 * Relations between extension tables, and tables Nextly does not manage.
 *
 * Two features that share one property: both describe a table WITHOUT
 * describing its DDL.
 *
 * ## Relations
 *
 * A `ref` column already records where it points, so the edge it implies is
 * derived rather than declared again — declaring both is how the two come to
 * disagree, and a relational query following the wrong one returns rows that
 * look plausible.
 *
 * ## Adopted tables
 *
 * A table that already exists, created by something other than Nextly. It gets
 * typed access and nothing else: no DDL, no diff, no migration, and no drop
 * — ever. That last is the whole point. An adopted table is by definition one
 * Nextly did not create, so it is exactly the table whose loss nobody could
 * undo from a migration.
 *
 * @module domains/schema/extension/relations
 * @since 1.0.0
 */
import type { DynamicRelationEdge } from "../../../database/schema-registry";
import { NextlyError } from "../../../errors/nextly-error";

import type { ExtensionTable, SchemaOwner } from "./types";

/** One declared relation, before it becomes an edge. */
export interface RelationInput {
  kind: "one" | "many";
  /** The property the relation is reachable under. */
  key: string;
  targetTable: string;
  /** The local column for `one`; the target's column for `many`. */
  column: string;
}

function refuse(path: string, message: string): never {
  throw NextlyError.validation({
    errors: [{ path, code: "INVALID", message }],
  });
}

/**
 * The `one` edges a table's `ref` columns already imply.
 *
 * Derived rather than requiring a second declaration. A `ref` states where a
 * column points; asking the author to say it twice means the two can disagree,
 * and a relational query following the wrong one returns rows that look right.
 */
export function impliedEdges(table: ExtensionTable): DynamicRelationEdge[] {
  return table.columns
    .filter(column => column.references !== undefined)
    .map(column => ({
      // Keyed by the authored property, so `userId: col.ref("users")` is
      // reachable as `user` rather than as the column name.
      key: column.key.replace(/Id$/, "") || column.key,
      fromColumn: column.name,
      targetTable: column.references as string,
    }));
}

/**
 * Whether this owner may relate to that table.
 *
 * The same rule `ref` uses, and for the same reason: a relation to another
 * plugin's table is a real dependency on its shape, and `dependsOn` is what
 * lets the resolver order the two and refuse an incompatible version. Without
 * it the edge is a guess that happens to work until the other plugin renames
 * a column.
 */
export function assertRelationAllowed(args: {
  owner: SchemaOwner;
  dependsOn: ReadonlySet<string>;
  targetTable: string;
  targetOwner: SchemaOwner | { kind: "core" } | { kind: "entity" } | undefined;
  path: string;
}): void {
  const { targetOwner } = args;
  if (!targetOwner) {
    refuse(
      args.path,
      `Relation targets "${args.targetTable}", which no table declares.`
    );
  }
  // Core and entity tables are readable by anyone: they are Nextly's, not
  // another participant's, and nothing about them is a private contract.
  if (targetOwner.kind === "core" || targetOwner.kind === "entity") return;
  if (targetOwner.kind === "app") {
    if (args.owner.kind === "app") return;
    refuse(
      args.path,
      `A plugin may not relate to the app's table "${args.targetTable}".`
    );
  }
  if (args.owner.kind === "plugin" && targetOwner.id === args.owner.id) return;
  if (args.dependsOn.has(targetOwner.id)) return;

  refuse(
    args.path,
    `Relation targets "${args.targetTable}", owned by plugin "${targetOwner.id}", which is not in dependsOn. Declare the dependency so the resolver can order the two and refuse an incompatible version.`
  );
}

/** Turn declared relations into edges, with `many` reversed onto its target. */
export function toEdges(
  tableName: string,
  relations: readonly RelationInput[]
): { own: DynamicRelationEdge[]; reverse: Map<string, DynamicRelationEdge[]> } {
  const own: DynamicRelationEdge[] = [];
  const reverse = new Map<string, DynamicRelationEdge[]>();

  for (const relation of relations) {
    if (relation.kind === "one") {
      own.push({
        key: relation.key,
        fromColumn: relation.column,
        targetTable: relation.targetTable,
      });
      continue;
    }
    // A `many` is an edge on the OTHER table pointing back here. Registering
    // it on this one would describe a column this table does not have.
    const edges = reverse.get(relation.targetTable) ?? [];
    edges.push({
      key: relation.key,
      fromColumn: relation.column,
      targetTable: tableName,
    });
    reverse.set(relation.targetTable, edges);
  }

  return { own, reverse };
}

/** A table Nextly reads and writes but does not maintain. */
export interface AdoptedTable {
  name: string;
  /** Always `app`: adopting is a statement about this installation. */
  owner: { kind: "app" };
  columns: ExtensionTable["columns"];
}

/**
 * Refuse an adoption that would shadow a table Nextly manages.
 *
 * The danger is one-directional and worth naming: adopting a MANAGED table
 * would make the pipeline believe a table it maintains is one it must not
 * touch, so the next schema change would silently stop being applied — and
 * nothing would report it, because "not managed" is exactly the state that
 * produces no operations.
 */
export function assertAdoptable(
  name: string,
  managedNames: ReadonlySet<string>
): void {
  if (!managedNames.has(name)) return;
  refuse(
    `db.schema.adoptTable.${name}`,
    `"${name}" is a table Nextly manages. Adopting it would stop schema changes to it being applied, with nothing reporting that they had stopped.`
  );
}
