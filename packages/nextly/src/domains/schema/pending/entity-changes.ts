/**
 * The changes not yet in a migration, by entity: what the development server names (each entity
 * and what changed in it: a field added, removed or changed, its settings changed), read from the
 * one comparison `migrate:check` reports from (`unwrittenChangesOf`), never computed beside it.
 *
 * An entity's recorded settings name its fields, so a field's change is read there, by the name
 * the configuration gives it. A table change is listed only where no settings change of its
 * entity already names it (a newest snapshot that predates the record, or a table no entity
 * declares, such as an extension table), and so is a file `migrate:create` writes beside the main
 * one. Pure.
 *
 * @module domains/schema/pending/entity-changes
 */
import type {
  TableOwner,
  UnwrittenChanges,
} from "../migrate/unwritten-changes";
import { describePermissionChange } from "../migrate-create/declared-permissions";
import {
  entityLabel,
  SETTINGS_RECORDED,
} from "../migrate-create/entity-settings";
import type { Operation } from "../pipeline/diff/types";

/** One entity, or a table no entity declares, with what changed in it. */
export interface EntityChanges {
  /** The entity as a report names it (`entityLabel`), `table <name>`, or `permissions`. */
  label: string;
  changes: string[];
}

/** What a settings path says changed: a field by its name, the field order, or a setting. */
function settingsChange(path: string): string | undefined {
  if (path === SETTINGS_RECORDED) return undefined;
  if (path === "added" || path === "removed") return path;
  if (path === "fields (order)") return "field order changed";
  const field = /^fields\.([^.\s]+)(.*)$/.exec(path);
  if (field === null) return `setting ${path} changed`;
  const [, name, rest] = field;
  if (rest === " (added)") return `field ${name} added`;
  if (rest === " (removed)") return `field ${name} removed`;
  return `field ${name} changed`;
}

/** A table change, as a report names it. */
function tableChange(op: Operation): string {
  switch (op.type) {
    case "add_table":
      return "table added";
    case "drop_table":
      return "table removed";
    case "rename_table":
      return `table renamed from ${op.fromName}`;
    case "add_column":
      return `column ${op.column.name} added`;
    case "drop_column":
      return `column ${op.columnName} removed`;
    case "rename_column":
      return `column ${op.fromColumn} renamed to ${op.toColumn}`;
    case "change_column_type":
    case "change_column_nullable":
    case "change_column_default":
      return `column ${op.columnName} changed`;
    default:
      return "indexes or keys changed";
  }
}

/** The table a change is made to. */
function tableOf(op: Operation): string {
  switch (op.type) {
    case "add_table":
      return op.table.name;
    case "rename_table":
      return op.toName;
    default:
      return op.tableName;
  }
}

/** The changes not yet in a migration, by entity, in the order the comparison names them. */
export function entityChangesOf(
  changes: Pick<
    UnwrittenChanges,
    "tables" | "beside" | "settings" | "permissions" | "owners"
  >
): EntityChanges[] {
  const byLabel = new Map<string, string[]>();
  const add = (label: string, change: string) => {
    const list = byLabel.get(label) ?? [];
    if (!list.includes(change)) list.push(change);
    byLabel.set(label, list);
  };
  const named = new Set<string>();
  for (const change of changes.settings) {
    const label = entityLabel(change.kind, change.slug);
    for (const path of change.changes) {
      const said = settingsChange(path);
      if (said === undefined) continue;
      add(label, said);
      named.add(label);
    }
  }
  const labelOf = (table: string): string => {
    const owner: TableOwner | undefined = changes.owners?.get(table);
    return owner === undefined
      ? `table ${table}`
      : entityLabel(owner.kind, owner.slug);
  };
  for (const op of changes.tables) {
    const label = labelOf(tableOf(op));
    if (!named.has(label)) add(label, tableChange(op));
  }
  for (const file of changes.beside) {
    const label = labelOf(file.table);
    if (!named.has(label)) add(label, file.kind);
  }
  if (changes.permissions.length > 0) {
    for (const change of changes.permissions) {
      add("permissions", describePermissionChange(change));
    }
  }
  return [...byLabel].map(([label, list]) => ({ label, changes: list }));
}
