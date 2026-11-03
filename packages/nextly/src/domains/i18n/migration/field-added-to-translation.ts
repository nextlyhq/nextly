/**
 * The `adds` file of translated fields added to an entity that is already translated: each one's
 * column added to the entity's translations table on the way up, and dropped on the way down.
 *
 * Rendered by the companion reconcile's own builder (`buildCompanionReconcileStatements`), the one
 * `nextly migrate`'s reconcile adds a missing translations column with, so a reconcile after this
 * file finds nothing to add, and the two can't come to disagree about the column's type.
 *
 * @module domains/i18n/migration/field-added-to-translation
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { fieldToLocalizedColumnSpec } from "./field-to-column-spec";
import {
  buildCompanionReconcileStatements,
  type CompanionFieldLike,
} from "./reconcile-companion";
import type { I18nTransitionKind } from "./transition-state";
import type { CompanionMigrationSpec } from "./types";

export interface FieldAddedToTranslationPlan {
  /** Describes the added columns, for the file's header. */
  spec: CompanionMigrationSpec;
  upSql: string;
  downSql: string;
}

/**
 * The `adds` file for `added`, beside the translated fields whose columns the translations table
 * already has (`recorded`).
 */
export function planFieldAddedToTranslationMigration(args: {
  slug: string;
  kind: I18nTransitionKind;
  tableName: string;
  dialect: SupportedDialect;
  defaultLocale: string;
  /** Whether the entity has Draft/Published, which the translations table's `_status` follows. */
  status: boolean;
  recorded: readonly CompanionFieldLike[];
  added: readonly CompanionFieldLike[];
}): FieldAddedToTranslationPlan {
  const { dialect } = args;
  const withAdded = [...args.recorded, ...args.added];
  // Between two lists that differ only in the added fields, with the translations table's other
  // columns stated as they are, the builder emits only those fields' ADD, or on the way down their
  // DROP.
  const between = (
    oldLocalized: CompanionFieldLike[],
    newLocalized: CompanionFieldLike[]
  ) =>
    buildCompanionReconcileStatements({
      slug: args.slug,
      kind: args.kind,
      tableName: args.tableName,
      oldLocalized,
      newLocalized,
      dialect,
      status: args.status,
      builtBy: "codeFirst",
      companionExists: true,
      companionHasStatus: args.status,
      companionHasUpdatedAt: true,
    });
  const asFile = (statements: string[]) =>
    statements.map(s => `${s};`).join("\n\n");
  return {
    spec: {
      dialect,
      collection: args.slug,
      kind: args.kind,
      mainTable: args.tableName,
      companionTable: `${args.tableName}_locales`,
      defaultLocale: args.defaultLocale,
      parentIdType: dialect === "mysql" ? "VARCHAR(36)" : "TEXT",
      columns: args.added.flatMap(
        f => fieldToLocalizedColumnSpec(f, dialect, "codeFirst") ?? []
      ),
    },
    upSql: asFile(between([...args.recorded], withAdded)),
    downSql: asFile(between(withAdded, [...args.recorded])),
  };
}
