/**
 * The push's refusal of a column made required over rows that would break it.
 *
 * A Builder apply (collection, Single, field group) and the development push (`next dev`'s
 * auto-sync, the HMR reload, `db:sync`) all reach `PushSchemaPipeline.apply`. The classifier marks
 * a column becoming NOT NULL over rows that would break it, but an event nobody answered used to
 * be carried on to the database, which then failed the statement — after MySQL had committed the
 * renames and drops ahead of it. This asks the question before anything runs: every such column
 * the dialog or the terminal left unanswered is counted with the one counter every road uses, and
 * the apply is refused naming the entity, the field and the count. An answer that fills the rows
 * first (a chosen value, deleting them, keeping the field optional) is the remedy, so a column
 * that carries one is not counted here.
 *
 * @module domains/schema/pipeline/required-column-gate
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { sql } from "drizzle-orm";

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import {
  requiredColumnUncountedError,
  requiredColumnOverNullsError,
  type RequiredColumnBreak,
  type RequiredColumnEntity,
  type RequiredColumnEntityKind,
} from "../required-column-refusal";
import {
  fieldsByColumnOf,
  requiredColumnRegistries,
} from "../required-column-registries";

import {
  countRowsBreakingNotNull,
  querySqlRows,
} from "./classifier/count-helpers";
import type { ColumnSpec, Operation } from "./diff/types";
import type { PromptDispatchResult } from "./pushschema-pipeline-interfaces";
import type {
  ClassifierEvent,
  Resolution,
  ResolutionKind,
} from "./resolution/types";
import type { DesiredSchema } from "./types";

/** The answers that leave no null behind at the NOT NULL: each fills, removes or keeps them. */
const FILLING_ANSWERS: ReadonlySet<ResolutionKind> = new Set([
  "provide_default",
  "delete_nonconforming",
  "make_optional",
]);

/** An entity of the desired schema, with the fields its column is named from. */
interface Owner {
  entity: RequiredColumnEntity;
  fields: readonly { name?: string }[];
}

/** The order a field group's users are named in: collections, then Singles, then field groups. */
const KIND_ORDER: Record<RequiredColumnEntityKind, number> = {
  collection: 0,
  single: 1,
  fieldGroup: 2,
  table: 3,
};

/** Every entity of the desired schema by its table, lowercased: MySQL may fold a table's name. */
function ownersByTable(desired: DesiredSchema): Map<string, Owner> {
  const owners = new Map<string, Owner>();
  const add = (
    kind: RequiredColumnEntityKind,
    entities: Record<
      string,
      { slug: string; tableName: string; fields: readonly { name?: string }[] }
    >
  ) => {
    for (const e of Object.values(entities)) {
      owners.set(e.tableName.toLowerCase(), {
        entity: { kind, slug: e.slug },
        fields: e.fields,
      });
    }
  };
  add("collection", desired.collections);
  add("single", desired.singles);
  add("fieldGroup", desired.components);
  return owners;
}

/**
 * The field a column belongs to, as the author named it: a column is the field's name in snake
 * case (`getColumnDescriptor`), so `subTitle` is named rather than `sub_title`. A column no
 * top-level field produces is named as the column.
 */
function fieldNameOf(
  owner: Owner,
  column: string,
  dialect: SupportedDialect
): string {
  // The field whose column this is, by the descriptor every road maps fields through.
  return (
    fieldsByColumnOf(
      owner.fields as readonly FieldDefinition[],
      dialect,
      owner.entity.kind === "fieldGroup"
    ).get(column.toLowerCase()) ?? column
  );
}

/** A column the apply makes NOT NULL, and what to count in its way as the database stands. */
interface Tightening {
  tableName: string;
  /** The column as the apply leaves it named. */
  columnName: string;
  /** The column the rows are counted in now (before a rename the apply makes), or `null` for an
   * added column, which every existing row breaks. */
  countColumn: string | null;
  added: boolean;
}

const tighteningKey = (table: string, column: string) =>
  `${table.toLowerCase()}.${column.toLowerCase()}`;

/**
 * Every column the apply makes NOT NULL that no answer fills first: from the plan's operations
 * (an `add_column` NOT NULL with no default or generated value, a `change_column_nullable` to NOT
 * NULL), and the classifier's events besides. The operations, not the events, decide what is
 * counted: the classifier raises no event for a column with no null row when it ran, and a row can
 * lose its value while the prompt is open. A column renamed by the apply is counted under the name
 * it has now. Answers only take columns out: a fill, a delete or "make optional".
 */
function unansweredTightenings(
  operations: readonly Operation[],
  events: readonly ClassifierEvent[],
  resolutions: readonly Resolution[]
): Tightening[] {
  const answeredIds = new Set(
    resolutions.filter(r => FILLING_ANSWERS.has(r.kind)).map(r => r.eventId)
  );
  const answered = new Set(
    events
      .filter(e => answeredIds.has(e.id))
      .map(e => tighteningKey(e.tableName, e.columnName))
  );
  const renamedFrom = new Map(
    operations.flatMap(op =>
      op.type === "rename_column"
        ? [[tighteningKey(op.tableName, op.toColumn), op.fromColumn] as const]
        : []
    )
  );
  const byKey = new Map<string, Tightening>();
  const tighten = (tableName: string, columnName: string, added: boolean) => {
    const key = tighteningKey(tableName, columnName);
    if (byKey.has(key)) return;
    byKey.set(key, {
      tableName,
      columnName,
      added,
      countColumn: added ? null : (renamedFrom.get(key) ?? columnName),
    });
  };
  for (const op of operations) {
    if (op.type === "add_column" && addedWithNoValue(op.column)) {
      tighten(op.tableName, op.column.name, true);
    } else if (op.type === "change_column_nullable" && !op.toNullable) {
      tighten(op.tableName, op.columnName, false);
    }
  }
  for (const event of events) {
    if (
      event.kind === "add_not_null_with_nulls" ||
      event.kind === "add_required_field_no_default"
    ) {
      // The classifier runs before the renames are answered, so it reads a column a confirmed
      // rename fills as added. The apply renames it instead, carrying its rows' values, so it is
      // counted in the column it is renamed from, as a column made NOT NULL is.
      const renamed = renamedFrom.has(
        tighteningKey(event.tableName, event.columnName)
      );
      tighten(
        event.tableName,
        event.columnName,
        event.kind === "add_required_field_no_default" && !renamed
      );
    }
  }
  return [...byKey.values()].filter(
    t => !answered.has(tighteningKey(t.tableName, t.columnName))
  );
}

/** A column added NOT NULL that gives existing rows no value: no default, nothing the database fills. */
function addedWithNoValue(column: ColumnSpec): boolean {
  return (
    !column.nullable &&
    column.default === undefined &&
    column.autoIncrement !== true &&
    column.primaryKey !== true
  );
}

/** The rows in a column's way, by parent for a field group; a count that fails refuses. */
async function countTightening(
  db: unknown,
  dialect: SupportedDialect,
  target: Tightening,
  owner: Owner | undefined
): Promise<Awaited<ReturnType<typeof countRowsBreakingNotNull>>> {
  try {
    return await countRowsBreakingNotNull(db, dialect, {
      table: target.tableName,
      column: target.countColumn,
      byParent: owner?.entity.kind === "fieldGroup",
    });
  } catch (cause) {
    // A count that fails cannot say the change is safe: refused before anything runs.
    throw requiredColumnUncountedError({
      table: target.tableName,
      field: owner
        ? fieldNameOf(owner, target.columnName, dialect)
        : target.columnName,
      cause,
    });
  }
}

/**
 * A field group's users with the rows each holds, in a stable order; a parent table nothing
 * registers is still counted in the total, unnamed.
 */
function namedUsers(
  byParentTable: ReadonlyMap<string, number>,
  owners: ReadonlyMap<string, Owner>,
  registry: ReadonlyMap<string, RequiredColumnEntity>
): Array<RequiredColumnEntity & { count: number }> {
  return [...byParentTable]
    .flatMap(([table, count]) => {
      const entity =
        owners.get(table.toLowerCase())?.entity ??
        registry.get(table.toLowerCase());
      return entity ? [{ ...entity, count }] : [];
    })
    .sort(
      (a, b) =>
        KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.slug.localeCompare(b.slug)
    );
}

/**
 * The entity each table belongs to, from the registries. A field group's Builder apply knows only
 * the field group, so the collections and Singles holding its rows are named from their registry
 * rows' `table_name`. A registry the database does not have yet names nothing.
 */
async function registryEntitiesByTable(
  db: unknown,
  dialect: SupportedDialect,
  fieldGroupRegistryTable: string | undefined
): Promise<Map<string, RequiredColumnEntity>> {
  const byTable = new Map<string, RequiredColumnEntity>();
  const registries = await requiredColumnRegistries(
    db,
    dialect,
    fieldGroupRegistryTable
  );
  for (const [kind, registry] of registries) {
    const rows = await querySqlRows<{ slug: string; table_name: string }>(
      db,
      dialect,
      sql`SELECT ${sql.identifier("slug")} AS slug, ${sql.identifier("table_name")} AS table_name FROM ${sql.identifier(registry)}`
    ).catch(() => []);
    for (const row of rows) {
      byTable.set(String(row.table_name).toLowerCase(), {
        kind,
        slug: String(row.slug),
      });
    }
  }
  return byTable;
}

/**
 * Refuses the apply, before any statement runs, when a column it makes NOT NULL has rows that
 * would break it and no answer fills them first.
 *
 * Counted now rather than taken from the classifier's event, with the counter every road shares,
 * so a row filled since the dialog opened is not counted against it. A field group's table holds
 * the rows of every collection and Single that uses it, so its rows are counted by the table
 * holding them and each of those is named with its count; one whose rows all hold a value is not
 * named. A column on a table no collection, Single or field group owns is refused naming the
 * table, since there is no entity to name. A count that fails throws, so the apply fails closed.
 *
 * @throws NextlyError (validation, `REQUIRED_COLUMN_HAS_NULLS`) naming every breaking column
 */
export async function refuseRequiredColumnsOverNulls(args: {
  db: unknown;
  dialect: SupportedDialect;
  desired: DesiredSchema;
  events: readonly ClassifierEvent[];
  resolutions: readonly Resolution[];
  /** The apply's operations as answered: every column it makes NOT NULL is counted. */
  operations: readonly Operation[];
  /** The field-group registry's name; absent, it is resolved from the catalog when needed. */
  fieldGroupRegistryTable?: string;
}): Promise<void> {
  const { db, dialect } = args;
  const unanswered = unansweredTightenings(
    args.operations,
    args.events,
    args.resolutions
  );
  if (unanswered.length === 0) return;

  const owners = ownersByTable(args.desired);
  // Read once, and only when a field group's rows have to be named.
  let registry: Promise<Map<string, RequiredColumnEntity>> | undefined;
  const readRegistry = () =>
    (registry ??= registryEntitiesByTable(
      db,
      dialect,
      args.fieldGroupRegistryTable
    ));
  const breaks: RequiredColumnBreak[] = [];

  for (const target of unanswered) {
    const { added } = target;
    const owner = owners.get(target.tableName.toLowerCase());
    const counted = await countTightening(db, dialect, target, owner);
    if (counted.total === 0) continue;
    if (owner === undefined) {
      // A table outside the entities (a plugin's, an extension's) is named by its table and column.
      breaks.push({
        entity: { kind: "table", slug: target.tableName },
        field: target.columnName,
        count: counted.total,
        added,
      });
      continue;
    }
    const users =
      owner.entity.kind === "fieldGroup"
        ? namedUsers(counted.byParentTable, owners, await readRegistry())
        : undefined;
    breaks.push({
      entity: owner.entity,
      field: fieldNameOf(owner, target.columnName, dialect),
      count: counted.total,
      added,
      ...(users ? { users } : {}),
    });
  }

  if (breaks.length > 0) throw requiredColumnOverNullsError(breaks);
}

/**
 * The gate as `PushSchemaPipeline.apply` asks it, from what it holds once the answers are known:
 * its arguments, the classification and the dispatcher's answers. One call there, so the apply
 * carries the question and this module carries the whole answer.
 */
export function refuseNotNullOverNulls(
  apply: { db: unknown; dialect: SupportedDialect; desired: DesiredSchema },
  classification: { events: readonly ClassifierEvent[] },
  answers: Pick<PromptDispatchResult, "resolutions">,
  operations: readonly Operation[]
): Promise<void> {
  return refuseRequiredColumnsOverNulls({
    db: apply.db,
    dialect: apply.dialect,
    desired: apply.desired,
    events: classification.events,
    resolutions: answers.resolutions,
    operations,
  });
}
