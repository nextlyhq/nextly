/**
 * A translated field's rename, as the schema dialog decides it.
 *
 * The dialog's renames are answers about columns: a table, the column before and the column after.
 * A translated field's column lives on the companion `<table>_locales`, so its rename is an answer
 * naming that table. Read back to the fields that own the two columns, it is the same rename the
 * companion reconcile takes from a settings save, where the main table's rule decides it.
 *
 * @module domains/i18n/migration/companion-rename
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { RenameCandidate } from "../../schema/pipeline/pushschema-pipeline-interfaces";
import type { ColumnOrigin } from "../../schema/services/field-column-descriptor";
import { isFieldLocalized } from "../classify-fields";

import { ddlType } from "./ddl-types";
import { storageDiffers } from "./field-leaves-translation-rules";
import { fieldToLocalizedColumnSpec } from "./field-to-column-spec";
import type { CompanionFieldLike, FieldRename } from "./reconcile-companion";

/** One rename answer from the schema dialog, in the shape its apply request carries. */
export interface CompanionRenameResolution {
  tableName: string;
  fromColumn: string;
  toColumn: string;
  choice: "rename" | "drop_and_add";
}

/**
 * The field the dialog's answers rename on `tableName`'s companion, by field name, or undefined
 * when no answer names the companion as a rename, or its columns are not the fields' columns.
 */
export function companionRenameFromResolutions(
  resolutions: readonly CompanionRenameResolution[] | undefined,
  at: {
    tableName: string;
    oldFields: readonly CompanionFieldLike[];
    newFields: readonly CompanionFieldLike[];
    dialect: SupportedDialect;
    builtBy: ColumnOrigin;
  }
): FieldRename | undefined {
  const answer = (resolutions ?? []).find(
    r => r.tableName === `${at.tableName}_locales` && r.choice === "rename"
  );
  if (!answer) return undefined;
  const owner = (fields: readonly CompanionFieldLike[], column: string) =>
    fields.find(
      f =>
        fieldToLocalizedColumnSpec(f, at.dialect, at.builtBy)?.name === column
    )?.name;
  const from = owner(at.oldFields, answer.fromColumn);
  const to = owner(at.newFields, answer.toColumn);
  return from && to ? { from, to } : undefined;
}

/**
 * The rename the schema dialog offers for a translated field, on its companion: the field the
 * main table's rule (`detectFieldRename`) finds renamed, when it was translated before the change
 * and the entity stays translated. Offered in the dialog's own rename shape, so the admin's answer comes back as a
 * resolution naming the companion (`companionRenameFromResolutions`). Undefined when the rename is
 * not a translated field's, so the main table's own candidate stands alone, or when the field's
 * storage changes too.
 */
export function companionRenameCandidate(at: {
  tableName: string;
  /** The rename the main table's rule detects across the whole field lists, if any. */
  detected: { from: CompanionFieldLike; to: CompanionFieldLike } | null;
  wasLocalized: boolean;
  isLocalized: boolean;
  dialect: SupportedDialect;
  builtBy: ColumnOrigin;
}): RenameCandidate | undefined {
  const { detected } = at;
  if (!detected) return undefined;
  // Translated before; after, translated or shared, since either way its values follow the
  // column the rename keeps.
  if (!at.isLocalized || !isFieldLocalized(detected.from, at.wasLocalized)) {
    return undefined;
  }
  const from = fieldToLocalizedColumnSpec(
    detected.from,
    at.dialect,
    at.builtBy
  );
  const to = fieldToLocalizedColumnSpec(detected.to, at.dialect, at.builtBy);
  // A rename keeps the column's type, so one that changes the field's storage is not offered.
  if (!from || !to || storageDiffers(from, to)) return undefined;
  return {
    tableName: `${at.tableName}_locales`,
    fromColumn: from.name,
    toColumn: to.name,
    fromType: ddlType(from, at.dialect),
    toType: ddlType(to, at.dialect),
    typesCompatible: true,
    preservesValues: true,
    defaultSuggestion: "rename",
  };
}
