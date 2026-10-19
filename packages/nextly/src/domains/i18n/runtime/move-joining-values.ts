/**
 * Moves the values of fields joining translation into the default language's companion rows on a
 * live database, for the paths that change a translated entity without a migration file: the
 * Schema Builder's Single save and the schema dialogs of collections, Singles and field groups.
 *
 * Runs before the main table loses the fields' columns, which each of those paths does next, and
 * asks the database what the companion is now (whether it exists, which columns it has, whether it
 * keeps `_status`) so a run that stopped part-way, or a column the unattended reconcile added at
 * boot, is taken as it is rather than added again. What remains to be added to the companion
 * afterwards is the caller's reconcile's, which skips what this added.
 *
 * @module domains/i18n/runtime/move-joining-values
 */
import type { ColumnOrigin } from "../../schema/services/field-column-descriptor";
import { buildFieldsJoiningTranslationStatements } from "../migration/field-joins-translation";
import type { CompanionFieldLike } from "../migration/reconcile-companion";

import {
  companionHasColumn,
  companionHasStatusColumn,
  type CompanionIntrospectAdapter,
} from "./companion-io";

/**
 * Moves the values and returns the names of the fields whose companion columns now exist, for the
 * caller's companion reconcile to skip (`joinedBefore`). Nothing happens, and nothing is returned,
 * unless the entity is translated before and after the change and a field joins.
 *
 * @throws whatever the database refuses, before the main table has changed
 */
export async function moveValuesOfFieldsJoiningTranslation(
  adapter: CompanionIntrospectAdapter & {
    tableExists(name: string): Promise<boolean>;
  },
  args: {
    slug: string;
    tableName: string;
    /** Which builder made the main table, which decides a column's bounds. */
    builtBy: ColumnOrigin;
    defaultLocale: string;
    oldFields: readonly CompanionFieldLike[];
    newFields: readonly CompanionFieldLike[];
    wasLocalized: boolean;
    isLocalized: boolean;
    /** Whether the entity had Draft/Published before this change. */
    wasStatus: boolean;
    /** Whether it has Draft/Published after it. */
    status: boolean;
  }
): Promise<string[]> {
  if (!args.wasLocalized || !args.isLocalized) return [];
  const companionTable = `${args.tableName}_locales`;
  const companionExists = await adapter.tableExists(companionTable);
  const companionHasStatus = companionExists
    ? await companionHasStatusColumn(adapter, companionTable)
    : false;
  const planArgs = {
    slug: args.slug,
    tableName: args.tableName,
    dialect: adapter.dialect,
    builtBy: args.builtBy,
    defaultLocale: args.defaultLocale,
    oldFields: args.oldFields,
    newFields: args.newFields,
    // A companion created here has `_status` when the entity has Draft/Published after the change,
    // so the default-language rows it gets take each entry's publishing state.
    status:
      args.wasStatus && (companionExists ? companionHasStatus : args.status),
    companionStatus: args.status,
    companionExists,
  };
  const first = buildFieldsJoiningTranslationStatements(planArgs);
  if (first.statements.length === 0) return first.fields;

  const present = new Set<string>();
  for (const column of companionExists ? first.columns : []) {
    if (await companionHasColumn(adapter, companionTable, column)) {
      present.add(column);
    }
  }
  const plan =
    present.size > 0
      ? buildFieldsJoiningTranslationStatements({
          ...planArgs,
          companionColumns: present,
        })
      : first;
  for (const statement of plan.statements) {
    await adapter.executeQuery(statement);
  }
  return plan.fields;
}
