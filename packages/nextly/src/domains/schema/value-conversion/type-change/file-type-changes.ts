/**
 * A migration file's field type changes, judged value by value against the database it is about
 * to run on, as a Schema Builder save's and a code-first apply's are: the same pairing of fields
 * (`fieldTypeChangesOf`), the same judgement of each stored value and the same refusals
 * (`fieldTypeChangeRefusals`), so a change refused in the Builder is refused in a file too.
 *
 * A file says what it changes in two places. Its snapshot records every entity's fields as the
 * file leaves them, and the newest snapshot before it records them as they were; its statements
 * rename columns. A type change that keeps its column writes no statement at all, so the two
 * snapshots are where it is read. A file run without snapshots on both sides (a hand-written one,
 * or one older than recorded fields) states no field types, and nothing is judged.
 *
 * Asked by `nextly migrate` for each pending file, before the file's first statement, where the
 * files before it in the run have already applied and its values are as it will find them.
 *
 * @module domains/schema/value-conversion/type-change/file-type-changes
 */
import { NextlyError } from "../../../../errors/nextly-error";
import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import { DEFAULT_TABLE_NAME_RESOLVERS } from "../../migrate/resolved-schema";
import { renamesIn } from "../../migrate/statement-targets";
import type {
  EntitySettingsRecord,
  RecordedEntitySettings,
  SettingsEntityKind,
} from "../../migrate-create/entity-settings";
import { builtByFor } from "../../pipeline/registered-collections";
import { mysqlLiveRunAt } from "../../pipeline/sql-templates/mysql-live-restate";
import {
  type ConfirmedColumnRename,
  renamedFieldsOf,
} from "../../pipeline/ui-type-changes";
import {
  getColumnDescriptor,
  type SupportedDialect,
} from "../../services/field-column-descriptor";

import {
  type EntityTypeChangeInput,
  entityLabel,
  fieldTypeChangeRefusals,
  fieldTypeChangesOf,
  perLanguageBefore,
  type TypeChangeRefusal,
  typeChangeError,
} from "./field-type-changes";

/** What a file states: the entities before it and after it, and its own statements. */
export interface FileTypeChangeSource {
  /** The file's name, which every refusal names. */
  filename: string;
  /** The entities the newest snapshot ordered before the file records. */
  before: EntitySettingsRecord | undefined;
  /** The entities the file's own snapshot records. */
  target: EntitySettingsRecord | undefined;
  /** The file's UP statements, as the runner splits them, for the renames they make. */
  statements: readonly string[];
  dialect: SupportedDialect;
}

/** One refusal of a file's type changes, with the entity it is of. */
interface FileTypeChangeRefusal extends TypeChangeRefusal {
  entity: { kind: SettingsEntityKind; slug: string };
}

/** Each kind of entity, by the key a snapshot records it under. */
const KINDS = [
  ["collections", "collection"],
  ["singles", "single"],
  ["fieldGroups", "fieldGroup"],
] as const satisfies readonly (readonly [
  keyof EntitySettingsRecord,
  SettingsEntityKind,
])[];

/** An entity's table, as every migrate command spells it from its declaration. */
function tableOf(
  kind: SettingsEntityKind,
  slug: string,
  settings: RecordedEntitySettings["settings"]
): string {
  const dbName =
    typeof settings.dbName === "string" && settings.dbName !== ""
      ? settings.dbName
      : undefined;
  const entity = { slug, ...(dbName === undefined ? {} : { dbName }) };
  return kind === "collection"
    ? DEFAULT_TABLE_NAME_RESOLVERS.collection(entity)
    : kind === "single"
      ? DEFAULT_TABLE_NAME_RESOLVERS.single(entity)
      : DEFAULT_TABLE_NAME_RESOLVERS.component(entity);
}

/** A recorded declaration's fields, or undefined where it records none. */
function fieldsOf(
  recorded: RecordedEntitySettings
): FieldDefinition[] | undefined {
  const fields = recorded.settings.fields;
  return Array.isArray(fields) ? (fields as FieldDefinition[]) : undefined;
}

/**
 * The column renames the file's statements make: a plain `RENAME COLUMN`, and on MySQL the
 * prepared run `migrate:create` writes to rename a column a check uses, which amounts to the plain
 * rename (`mysqlLiveRunAt`). The run's other statements rename nothing.
 */
function columnRenamesIn(
  statements: readonly string[],
  dialect: SupportedDialect
): ConfirmedColumnRename[] {
  return statements.flatMap((statement, at) => {
    const run =
      dialect === "mysql" ? mysqlLiveRunAt(statements, at) : undefined;
    if (run?.kind === "rename") {
      const { tableName, fromColumn, toColumn } = run;
      return [{ tableName, fromColumn, toColumn }];
    }
    return (renamesIn(statement, dialect) ?? []).flatMap(rename =>
      rename.kind === "column"
        ? [
            {
              tableName: rename.table,
              fromColumn: rename.from,
              toColumn: rename.to,
            },
          ]
        : []
    );
  });
}

/**
 * The entities whose field types the file changes, each as the type-change precondition reads it:
 * an entity both snapshots record, whose fields, paired by name or by a rename the file's
 * statements make, change type with a column on both sides. An entity the file adds or removes,
 * one whose fields either snapshot does not record, and one whose types the file leaves alone are
 * not among them, and read no row.
 */
export function fileTypeChangesOf(
  source: FileTypeChangeSource
): { kind: SettingsEntityKind; slug: string; input: EntityTypeChangeInput }[] {
  const { before, target, dialect } = source;
  if (before === undefined || target === undefined) return [];
  const renames = columnRenamesIn(source.statements, dialect);
  return KINDS.flatMap(([key, kind]) =>
    Object.entries(target[key]).flatMap(([slug, after]) => {
      const was = before[key][slug];
      const previous = was === undefined ? undefined : fieldsOf(was);
      const next = fieldsOf(after);
      if (was === undefined || previous === undefined || next === undefined) {
        return [];
      }
      const table = tableOf(kind, slug, after.settings);
      const translationsTable = `${table}_locales`;
      const builtBy = builtByFor(kind, after.source === "builder");
      const renamed = renamedFieldsOf(
        previous,
        next,
        renames,
        new Set([table.toLowerCase(), translationsTable.toLowerCase()]),
        field =>
          getColumnDescriptor(field, dialect, builtBy)?.name.toLowerCase()
      );
      const changes = fieldTypeChangesOf({
        previous,
        next,
        ...(renamed.size > 0 ? { renamed } : {}),
        dialect,
        builtBy,
      });
      if (changes.length === 0) return [];
      return [
        {
          kind,
          slug,
          input: {
            label: `${entityLabel(kind, slug)} (migration ${source.filename})`,
            table,
            // A field translated before the file keeps each language's value in the companion;
            // a file that turns translation on or off has the values where they were, so the
            // companion is always named and each value read from whichever table holds it.
            translationsTable,
            ...perLanguageBefore(was.settings, table, previous),
            previous,
            next,
            ...(renamed.size > 0 ? { renamed } : {}),
            builtBy,
          },
        },
      ];
    })
  );
}

/**
 * Every refusal of the file's field type changes, judged on the values the database holds now:
 * each blocked change, and each change that would lose a value, since a file clears no value its
 * new type cannot read. Empty where the file changes no field type, or every value is kept. Each
 * names its entity, the field and the file.
 */
export async function fileTypeChangeRefusals(
  db: unknown,
  source: FileTypeChangeSource
): Promise<FileTypeChangeRefusal[]> {
  const refusals: FileTypeChangeRefusal[] = [];
  for (const { kind, slug, input } of fileTypeChangesOf(source)) {
    for (const refusal of await fieldTypeChangeRefusals(
      db,
      source.dialect,
      input
    )) {
      refusals.push({ ...refusal, entity: { kind, slug } });
    }
  }
  return refusals;
}

/**
 * Refuse the file before its first statement where any of its field type changes is blocked or
 * would lose a value (`fileTypeChangeRefusals`), naming every refusal at once.
 *
 * @throws {NextlyError} a validation error listing each refusal, with its entity and field
 */
export async function refuseFileTypeChanges(
  db: unknown,
  source: FileTypeChangeSource
): Promise<void> {
  const refusals = await fileTypeChangeRefusals(db, source);
  if (refusals.length === 0) return;
  throw NextlyError.validation({
    errors: refusals.map(refusal => typeChangeError(refusal)),
    logContext: {
      file: source.filename,
      entities: [
        ...new Set(refusals.map(r => `${r.entity.kind}:${r.entity.slug}`)),
      ],
      fields: refusals.map(refusal => refusal.path),
    },
  });
}
