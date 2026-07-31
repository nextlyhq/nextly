/**
 * Bring an entity's content back onto its main table when localization is turned off in
 * configuration.
 *
 * The Schema Builder's toggle has always done this: disabling localization restores the default
 * locale onto main, archives the other languages, and drops the companion. Setting
 * `localized: false` in `nextly.config.ts` did none of it — provisioning skipped every entity that
 * was not localized, so the companion was simply abandoned. Reads then resolve through the main
 * table again and return whatever it held before the entity was localized, because every write
 * since had gone to the companion alone. The user's edits are still on disk and no longer visible,
 * which is the enable-side defect in mirror image.
 *
 * Two things separate this from the Builder's disable, and both follow from it running unattended:
 *
 * - **Nothing is dropped.** `db:sync` persists registry metadata before its destructive prompt, so
 *   a drop here would run even for an operator who then declined the change. The companion is left
 *   standing and inert; `nextly migrate` removes it under supervision.
 * - **Nothing is archived.** Archiving exists to make the drop recoverable. With the companion
 *   still holding every translation, copying them into `nextly_i18n_archive` would only duplicate
 *   them.
 *
 * Runs once per transition, gated on the durable record rather than on physical shape. A companion
 * that exists tells you nothing about whether its values have already been copied back, and
 * repeating the copy is not harmless: main is authoritative after a restore, so a second pass
 * would overwrite live edits with the companion's now-stale rows.
 *
 * @module domains/i18n/runtime/restore-companion
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type {
  I18nTransitionKind,
  TransitionStateStore,
} from "../migration/transition-state";
import {
  forgetI18nTransition,
  readI18nTransitionState,
  recordI18nRestore,
} from "../migration/transition-state";

import type { CompanionIntrospectAdapter } from "./companion-io";
import { localizedColumnsOnBothTables } from "./companion-io";

/** Minimal field shape the restore needs — matches `CompanionFieldLike` in companion-io. */
interface RestorableField {
  name: string;
  type: string;
  localized?: boolean;
}

export interface RestoreCompanionArgs {
  kind: I18nTransitionKind;
  slug: string;
  tableName: string;
  fields: RestorableField[];
  dialect: SupportedDialect;
  /**
   * The locale whose companion values become the main table's content, when the app still names
   * one.
   *
   * Optional because turning localization off often means removing the `localization` block
   * outright, and that is precisely when a restore is owed. The recorded source locale stands in:
   * it is the language the companion was seeded with and the one the main table already held, so
   * it is the best answer available and the only one that survives the config being deleted. The
   * configured default wins when there is one, because the default locale may have moved on while
   * the entity was localized and the current content then lives under the newer code.
   */
  defaultLocale?: string;
  store: TransitionStateStore;
}

/**
 * Copy the default locale's companion values back onto the main table for an entity whose
 * configuration no longer says it is localized.
 *
 * Returns whether a restore actually ran, so a caller can report it. A false return is the ordinary
 * case: entities that were never localized have no record, and one already restored has nothing
 * left to owe.
 *
 * MUST run after the schema push, not before it. Turning localization off puts the translatable
 * fields back into the desired main-table shape, so the push is what re-creates the columns this
 * writes into. Running first would meet a table that has nowhere to put the values.
 */
export async function restoreDisabledCompanion(
  adapter: CompanionIntrospectAdapter,
  args: RestoreCompanionArgs,
  onError?: (error: unknown) => void
): Promise<boolean> {
  const recorded = await readI18nTransitionState(
    args.store,
    args.kind,
    args.slug
  );
  // `untracked` covers both an entity that was never localized and one whose transition predates
  // this record. Neither can be restored from here: the second is missing the one fact that cannot
  // be re-derived, which is why `nextly migrate` owns repairing it.
  if (recorded.status === "untracked" || recorded.status === "restored") {
    return false;
  }

  const restoreLocale = args.defaultLocale ?? recorded.sourceLocale;
  const companionTableName = `${args.tableName}_locales`;
  try {
    const { companionExists, columns: restorable } =
      await localizedColumnsOnBothTables(
        adapter,
        args.tableName,
        companionTableName,
        args.fields
      );
    if (!companionExists) {
      // The companion is already gone — a `nextly migrate` run, or a teardown. There is nothing to
      // copy and nothing left for the record to describe, so it stops describing it rather than
      // leaving a restore permanently owed against a table that does not exist.
      await forgetI18nTransition(args.store, args.kind, args.slug);
      return false;
    }

    if (restorable.length > 0) {
      const { buildDefaultLocaleRestoreStatements } = await import(
        "../migration/generate-down"
      );
      const statements = buildDefaultLocaleRestoreStatements(
        {
          dialect: args.dialect,
          mainTable: args.tableName,
          companionTable: companionTableName,
          defaultLocale: restoreLocale,
        },
        restorable
      );
      for (const statement of statements) {
        await adapter.executeQuery(statement);
      }
    }

    // Recorded even when no column needed copying. The transition is over either way, and leaving
    // the record saying the companion is authoritative would make every later pass re-examine an
    // entity that has nothing left to do.
    await recordI18nRestore(args.store, {
      kind: args.kind,
      slug: args.slug,
      sourceLocale: restoreLocale,
    });
    return restorable.length > 0;
  } catch (error) {
    // Reported rather than thrown, for the same reason the create path reports: provisioning must
    // not refuse to start over one entity. The record is left untouched, so the next pass tries
    // again — the copy is idempotent until the record says it finished.
    onError?.(error);
    return false;
  }
}
