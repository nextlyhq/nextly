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

import { NextlyError } from "../../../errors";
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import { resolveRegistryNameFromCatalog } from "../../field-groups/storage/resolve-storage-names";
import {
  requiredColumnBreakMessage,
  requiredColumnOverNullsError,
  type RequiredColumnBreak,
  type RequiredColumnEntity,
  type RequiredColumnEntityKind,
} from "../required-column-refusal";
import { toSnakeCase } from "../services/field-column-descriptor";

import {
  countRowsBreakingNotNull,
  querySqlRows,
} from "./classifier/count-helpers";
import type { PromptDispatchResult } from "./pushschema-pipeline-interfaces";
import type {
  AddNotNullWithNullsEvent,
  AddRequiredFieldNoDefaultEvent,
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

type RequiredColumnEvent =
  | AddNotNullWithNullsEvent
  | AddRequiredFieldNoDefaultEvent;

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
function fieldNameOf(owner: Owner, column: string): string {
  const wanted = column.toLowerCase();
  const field = owner.fields.find(
    f => typeof f.name === "string" && toSnakeCase(f.name) === wanted
  );
  return field?.name ?? column;
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
  const registries: [RequiredColumnEntityKind, string][] = [
    ["collection", "dynamic_collections"],
    ["single", "dynamic_singles"],
    [
      "fieldGroup",
      fieldGroupRegistryTable ??
        // Resolved as the push resolves it: the registry may sit under its migrated name. A
        // catalog that cannot answer leaves the current spelling, and a missing table names none.
        (await resolveRegistryNameFromCatalog({
          dialect,
          getDrizzle: <T>() => db as T,
        }).catch(() => STORAGE_FORMAT.registryTable)),
    ],
  ];
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
  /** The field-group registry's name; absent, it is resolved from the catalog when needed. */
  fieldGroupRegistryTable?: string;
}): Promise<void> {
  const { db, dialect } = args;
  const answered = new Set(
    args.resolutions
      .filter(r => FILLING_ANSWERS.has(r.kind))
      .map(r => r.eventId)
  );
  const unanswered = args.events.filter(
    (e): e is RequiredColumnEvent =>
      (e.kind === "add_not_null_with_nulls" ||
        e.kind === "add_required_field_no_default") &&
      !answered.has(e.id)
  );
  if (unanswered.length === 0) return;

  const owners = ownersByTable(args.desired);
  // Read once, and only when a field group's rows have to be named.
  let registry: Map<string, RequiredColumnEntity> | undefined;
  const breaks: RequiredColumnBreak[] = [];
  const unowned: { table: string; column: string; count: number }[] = [];

  for (const event of unanswered) {
    const added = event.kind === "add_required_field_no_default";
    const owner = owners.get(event.tableName.toLowerCase());
    const byParent = owner?.entity.kind === "fieldGroup";
    const { total, byParentTable } = await countRowsBreakingNotNull(
      db,
      dialect,
      {
        table: event.tableName,
        // An added column holds null in every existing row.
        column: added ? null : event.columnName,
        byParent,
      }
    );
    if (total === 0) continue;
    if (owner === undefined) {
      unowned.push({
        table: event.tableName,
        column: event.columnName,
        count: total,
      });
      continue;
    }
    let users: (RequiredColumnEntity & { count: number })[] | undefined;
    if (byParent) {
      registry ??= await registryEntitiesByTable(
        db,
        dialect,
        args.fieldGroupRegistryTable
      );
      const named = registry;
      users = [...byParentTable]
        .flatMap(([table, count]) => {
          const entity =
            owners.get(table.toLowerCase())?.entity ??
            named.get(table.toLowerCase());
          // A parent table nothing registers is still counted in the total, unnamed.
          return entity ? [{ ...entity, count }] : [];
        })
        .sort(
          (a, b) =>
            KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
            a.slug.localeCompare(b.slug)
        );
    }
    breaks.push({
      entity: owner.entity,
      field: fieldNameOf(owner, event.columnName),
      count: total,
      added,
      ...(users ? { users } : {}),
    });
  }

  if (unowned.length > 0) {
    // A table outside the entities (a plugin's, an extension's) has no entity or field to name, so
    // its refusal names the table and the column instead, under the same code.
    throw NextlyError.validation({
      errors: [
        ...breaks.map(b => ({
          path: `fields.${b.field}`,
          code: "REQUIRED_COLUMN_HAS_NULLS",
          message: requiredColumnBreakMessage(b),
        })),
        ...unowned.map(u => ({
          path: `tables.${u.table}.${u.column}`,
          code: "REQUIRED_COLUMN_HAS_NULLS",
          message: `Table '${u.table}': column '${u.column}' cannot become NOT NULL while ${u.count === 1 ? "1 row holds" : `${u.count} rows hold`} no value in it.`,
        })),
      ],
      logContext: { reason: "required-column-over-nulls", unowned },
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
  answers: Pick<PromptDispatchResult, "resolutions">
): Promise<void> {
  return refuseRequiredColumnsOverNulls({
    db: apply.db,
    dialect: apply.dialect,
    desired: apply.desired,
    events: classification.events,
    resolutions: answers.resolutions,
  });
}
