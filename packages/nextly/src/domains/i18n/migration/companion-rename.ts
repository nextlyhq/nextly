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

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
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
 * The rename the dialog's answers make on `tableName`'s companion, by field name: the one this
 * server offers for the change (`offeredCompanionRename`), when an answer names exactly that
 * candidate as a rename. Undefined otherwise. An answer the server did not offer, stale or made
 * up, is dropped as the main table's are (`BrowserPromptDispatcher`): it could otherwise attach
 * one field's translations to another field, or rename onto a column that is already there.
 */
export async function companionRenameFromResolutions(
  resolutions: readonly CompanionRenameResolution[] | undefined,
  at: OfferedCompanionRenameArgs
): Promise<FieldRename | undefined> {
  const answers = (resolutions ?? []).filter(
    r => r.tableName === `${at.tableName}_locales` && r.choice === "rename"
  );
  if (answers.length === 0) return undefined;
  const offered = await offeredCompanionRename(at);
  if (!offered) return undefined;
  const { candidate, rename } = offered;
  const matches = answers.some(
    r =>
      r.fromColumn === candidate.fromColumn && r.toColumn === candidate.toColumn
  );
  return matches ? rename : undefined;
}

/** What {@link offeredCompanionRename} decides from: the change, and the entity around it. */
export interface OfferedCompanionRenameArgs {
  tableName: string;
  oldFields: readonly CompanionFieldLike[];
  newFields: readonly CompanionFieldLike[];
  /** Whether the entity was translated before the change, and is after it. */
  wasLocalized: boolean;
  isLocalized: boolean;
  dialect: SupportedDialect;
  builtBy: ColumnOrigin;
}

/**
 * The companion rename this change offers, as the schema dialog's candidate and by field name: the
 * field the main table's rule (`detectFieldRename`) finds renamed, offered on its companion
 * (`companionRenameCandidate`). One answer for the preview that offers it and the apply that takes
 * the admin's reply, so the apply accepts only what was offered.
 */
export async function offeredCompanionRename(
  at: OfferedCompanionRenameArgs
): Promise<{ candidate: RenameCandidate; rename: FieldRename } | undefined> {
  const { DynamicCollectionSchemaService } = await import(
    "../../dynamic-collections/services/dynamic-collection-schema-service"
  );
  const detected = new DynamicCollectionSchemaService(
    undefined,
    at.dialect
  ).detectFieldRename(
    at.oldFields as unknown as FieldDefinition[],
    at.newFields as unknown as FieldDefinition[]
  );
  const candidate = companionRenameCandidate({ ...at, detected });
  return candidate && detected
    ? {
        candidate,
        rename: { from: detected.from.name, to: detected.to.name },
      }
    : undefined;
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
