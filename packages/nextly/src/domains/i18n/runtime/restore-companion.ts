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
import { eq } from "drizzle-orm";

import type {
  I18nTransitionKind,
  TransitionStateStore,
} from "../migration/transition-state";
import {
  forgetI18nTransition,
  readI18nTransitionState,
  recordI18nRestore,
} from "../migration/transition-state";

import { copyDefaultLocaleOntoMain } from "./companion-copy";
import type { CompanionIntrospectAdapter } from "./companion-io";
import {
  companionTableExists,
  localizedColumnsOnBothTables,
} from "./companion-io";
import { buildCompanionRuntimeTable } from "./companion-registration";

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

  const companionTableName = `${args.tableName}_locales`;
  try {
    const { companionExists, columns: present } =
      await localizedColumnsOnBothTables(
        adapter,
        args.tableName,
        companionTableName,
        restorableFields(args.fields)
      );
    // Confirmed through the write path's own probe before anything is forgotten. The snapshot
    // above answers from introspection, and a false negative here is not recoverable: the record
    // it deletes carries the source locale, which is the one fact nothing else can supply.
    if (
      !companionExists &&
      !(await companionTableExists(adapter, companionTableName))
    ) {
      // The companion is already gone — a `nextly migrate` run, or a teardown. There is nothing to
      // copy and nothing left for the record to describe, so it stops describing it rather than
      // leaving a restore permanently owed against a table that does not exist.
      await forgetI18nTransition(args.store, args.kind, args.slug);
      return false;
    }

    // Which locale actually holds this entity's content. The configured default is the right
    // answer whenever the companion has rows in it, and wrong when the entity was only ever
    // authored under the locale the transition recorded — the restore is guarded on a matching
    // companion row, so it would quietly copy nothing while the record below declared the
    // transition over. `restored` is terminal, so no later pass would retry.
    const restoreLocale = await resolveRestoreLocale(adapter, {
      tableName: args.tableName,
      fields: restorableFields(args.fields),
      dialect: args.dialect,
      preferred: args.defaultLocale,
      recorded: recorded.sourceLocale,
    });

    if (present.length > 0) {
      await copyDefaultLocaleOntoMain(adapter, {
        tableName: args.tableName,
        companionTableName,
        fields: restorableFields(args.fields),
        dialect: args.dialect,
        locale: restoreLocale,
        // The other candidate, so a parent without a row in the chosen locale still comes back
        // from the one it does have rather than keeping a pre-localization value.
        fallbackLocale:
          restoreLocale === recorded.sourceLocale
            ? args.defaultLocale
            : recorded.sourceLocale,
        columns: present,
      });
    }

    // Recorded even when no column needed copying. The transition is over either way, and leaving
    // the record saying the companion is authoritative would make every later pass re-examine an
    // entity that has nothing left to do.
    await recordI18nRestore(args.store, {
      kind: args.kind,
      slug: args.slug,
      sourceLocale: restoreLocale,
      // The state read before the copy, so a re-enable that claimed this entity while it ran keeps
      // its claim rather than having it overwritten by a completion it never saw.
      expect: {
        status: recorded.status,
        sourceLocale: recorded.sourceLocale,
      },
    });
    return present.length > 0;
  } catch (error) {
    // Reported rather than thrown, for the same reason the create path reports: provisioning must
    // not refuse to start over one entity. The record is left untouched, so the next pass tries
    // again — the copy is idempotent until the record says it finished.
    onError?.(error);
    return false;
  }
}

/**
 * The fields whose values the companion actually owns.
 *
 * A field can be made shared (`localized: false`) while its entity stays localized. Reconciliation
 * is additive, so its companion column survives while writes correctly go to the restored
 * main-table column — and a later entity-level disable would then copy that abandoned companion
 * value over the current one.
 *
 * The flags decide when any of them are set, which is the case that produces the hazard. When none
 * are — the ordinary shape after turning localization off, where the per-field flags are usually
 * cleared along with the entity's — every field is a candidate and the physical intersection with
 * the companion decides instead.
 */
function restorableFields(fields: RestorableField[]): RestorableField[] {
  const claimed = fields.filter(f => f.localized === true);
  return claimed.length > 0 ? claimed : fields;
}

/**
 * The locale to restore from: the configured default when the companion holds it, otherwise the
 * one the transition recorded.
 *
 * They differ when the default moved while the entity was localized and its content was only ever
 * authored under the old one. Preferring the configured default unconditionally means the guarded
 * copy matches no row, restores nothing, and the record still marks the transition finished — with
 * the content left in a companion nothing reads.
 */
async function resolveRestoreLocale(
  adapter: CompanionIntrospectAdapter,
  args: {
    tableName: string;
    fields: RestorableField[];
    dialect: SupportedDialect;
    preferred?: string;
    recorded: string;
  }
): Promise<string> {
  const preferred = args.preferred;
  if (!preferred || preferred === args.recorded) return args.recorded;

  const companion = buildCompanionRuntimeTable({
    slug: args.tableName,
    tableName: args.tableName,
    fields: args.fields.map(f => ({ ...f, localized: true })),
    dialect: args.dialect,
    localized: true,
  });
  if (!companion) return args.recorded;
  const columns = companion.table as Record<string, unknown>;

  const rows = await adapter
    .getDrizzle<LocaleProbeDb>()
    .select({ locale: columns._locale })
    .from(companion.table)
    .where(eq(columns._locale as never, preferred))
    .limit(1);
  return rows.length > 0 ? preferred : args.recorded;
}

/** The slice of Drizzle the locale probe drives — declared like the other structural ports here. */
interface LocaleProbeDb {
  select(projection: Record<string, unknown>): {
    from(table: unknown): {
      where(condition: unknown): { limit(n: number): Promise<unknown[]> };
    };
  };
}
