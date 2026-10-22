/**
 * The `unique` companion migrations `migrate:create` writes for a translated entity whose fields
 * become or stop being unique within each language: the per-language unique indexes the previous
 * snapshot recorded (`uniqueLocalizedColumns`) brought to the ones the config now asks for.
 *
 * Two files rather than one, because they run on either side of everything else: the drops before
 * the main migration and every other companion file, since SQLite will not drop a column an index
 * uses and MySQL will not drop one a functional key part uses, and the creates after them all,
 * once every column they key on exists. Each file's DOWN undoes exactly its UP.
 *
 * @module domains/i18n/migration/plan-translated-unique-migration
 */
import type { TableSpec } from "../../schema/pipeline/diff/types";

import {
  companionUniqueIndexChanges,
  companionUniqueIndexName,
  type UniqueFieldLike,
  type UniqueTranslatedColumn,
  uniqueTranslatedColumns,
} from "./companion-unique-indexes";
import type { CompanionMigrationSpec } from "./types";

/** One `unique` file's statements. */
export interface TranslatedUniqueFile {
  upSql: string;
  downSql: string;
}

/** An entity's `unique` files, each null when it has nothing to do. */
export interface TranslatedUniquePlan {
  drops: TranslatedUniqueFile | null;
  creates: TranslatedUniqueFile | null;
}

const asSql = (statements: readonly string[]) =>
  statements.map(s => `${s};`).join("\n\n");

/**
 * The `unique` files for one translated entity, or null when its per-language unique indexes
 * stay as they were.
 *
 * `previous` is the entity's main table in the previous snapshot. Unless it was translated there,
 * the companion is new in this migration and holds no index yet.
 */
export function planTranslatedUniqueMigration(args: {
  /** The entity's companion as the config now describes it. */
  spec: CompanionMigrationSpec;
  fields: readonly UniqueFieldLike[];
  previous:
    | Pick<
        TableSpec,
        "localized" | "localizedColumns" | "uniqueLocalizedColumns"
      >
    | undefined;
}): TranslatedUniquePlan | null {
  const { dialect, companionTable } = args.spec;
  const had: UniqueTranslatedColumn[] = (
    args.previous?.localized === true
      ? (args.previous.uniqueLocalizedColumns ?? [])
      : []
  ).map(column => ({ field: column, column }));
  const wanted = uniqueTranslatedColumns({
    fields: args.fields,
    entityLocalized: true,
    dialect,
    builtBy: "codeFirst",
  });
  const translatedColumns = [
    ...new Set([
      ...(args.previous?.localizedColumns ?? []),
      ...args.spec.columns.map(c => c.name),
    ]),
  ];
  const indexed = (columns: readonly UniqueTranslatedColumn[]) =>
    new Set(
      columns.map(c => companionUniqueIndexName(companionTable, c.column))
    );
  const forward = companionUniqueIndexChanges({
    dialect,
    companionTable,
    wanted,
    translatedColumns,
    liveIndexNames: indexed(had),
  });
  // The way back: the indexes this change drops are created again, and the ones it creates go.
  const back = companionUniqueIndexChanges({
    dialect,
    companionTable,
    wanted: had,
    translatedColumns,
    liveIndexNames: indexed(wanted),
  });
  const file = (up: string[], down: string[]) =>
    up.length === 0 ? null : { upSql: asSql(up), downSql: asSql(down) };
  const plan = {
    drops: file(forward.drops, back.creates),
    creates: file(forward.creates, back.drops),
  };
  return plan.drops === null && plan.creates === null ? null : plan;
}
