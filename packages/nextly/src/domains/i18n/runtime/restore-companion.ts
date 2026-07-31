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

import { NextlyError } from "../../../errors/nextly-error";
import { resolveLocalizedFieldNames } from "../classify-fields";
import type {
  EnablingTransition,
  I18nTransitionKind,
  SeededTransition,
  TransitionStateStore,
  UntrackedTransition,
} from "../migration/transition-state";
import {
  beginI18nTransition,
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
  // Already restored. Terminal, and repeating the copy would overwrite live edits with rows main
  // has been authoritative over ever since.
  if (recorded.status === "restored") return false;

  const companionTableName = `${args.tableName}_locales`;
  try {
    // For an entity with no record, one cheap probe decides everything: no companion means it was
    // never localized, and there is nothing to bring back. Asked before the full introspection
    // because this is the overwhelmingly common case — every entity the configuration does not
    // localize reaches here on every sync and every reload, and almost none of them ever had a
    // companion.
    if (
      recorded.status === "untracked" &&
      !(await companionTableExists(adapter, companionTableName))
    ) {
      return false;
    }

    const {
      companionExists,
      columns: present,
      statusOnBoth,
    } = await localizedColumnsOnBothTables(
      adapter,
      args.tableName,
      companionTableName,
      restorableFields(args.fields)
    );
    // Confirmed through the write path's own probe. The snapshot above answers from introspection,
    // and a false negative is not recoverable: it decides both whether a record is deleted and
    // whether an untracked entity is one that was never localized at all.
    const companionIsThere =
      companionExists ||
      (await companionTableExists(adapter, companionTableName));

    // The state this restore is based on. `untracked` needs establishing first; the other two
    // already describe a transition.
    const based = await basisForRestore(args, recorded, companionIsThere);
    if (!based) return false;

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
      recorded: based.sourceLocale,
    });

    if (present.length > 0 || statusOnBoth) {
      await copyDefaultLocaleOntoMain(adapter, {
        tableName: args.tableName,
        companionTableName,
        fields: restorableFields(args.fields),
        dialect: args.dialect,
        locale: restoreLocale,
        // The other candidate, so a parent without a row in the chosen locale still comes back
        // from the one it does have rather than keeping a pre-localization value.
        fallbackLocale:
          restoreLocale === based.sourceLocale
            ? args.defaultLocale
            : based.sourceLocale,
        columns: present,
        // Decided by the physical tables, not the configuration. Publishing is per locale while
        // an entity is localized, so a row published only under a non-default locale carries that
        // state on its companion row alone; restoring its values without it would publish a draft
        // or unpublish live content. The desired schema does not say whether the columns are
        // there yet — the entity may have gained or lost Draft/Published in this same edit — so
        // the snapshot above answers instead.
        status: statusOnBoth,
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
      // its claim rather than having it overwritten by a completion it never saw. The claim token
      // travels with it: a re-enable that took the row over left its own token there, and a
      // comparison that omitted the one observed here would match no row at all.
      expect: based,
    });
    return present.length > 0 || statusOnBoth;
  } catch (error) {
    // Reported rather than thrown, for the same reason the create path reports: provisioning must
    // not refuse to start over one entity. The record is left untouched, so the next pass tries
    // again — the copy is idempotent until the record says it finished.
    onError?.(error);
    return false;
  }
}

/** The recorded state a restore copies from, and moves off when it finishes. */
interface RestoreBasis {
  status: "enabling" | "seeded";
  sourceLocale: string;
  owner?: string;
}

/**
 * The transition this restore completes, establishing one first if the entity has none.
 *
 * An entity with no record is not necessarily one that was never localized, and the companion says
 * which. A companion exists only because localization was on — whether that happened before
 * transitions were recorded, or the entity was localized from birth, makes no difference in this
 * direction. Either way every edit since went to the companion, and disabling without copying them
 * back republishes whatever main held beforehand while the real content sits in a table nothing
 * reads any more.
 *
 * That is the reverse of the enable direction, where absence of a record genuinely is ambiguous and
 * the repair is opt-in: there the question is whether a copy is OWED, and a from-birth entity owes
 * nothing. Here the question is only whether content exists to bring back.
 *
 * The transition is established through the ordinary claim, so two processes disabling the same
 * entity cannot both copy. `enabling` is the honest state to establish: it means the companion is
 * authoritative and main owes a copy, which is exactly true, and a crash mid-restore leaves it
 * there for the next pass to repeat harmlessly.
 *
 * Null when there is nothing to do or nothing that can be decided — no companion, or no locale to
 * name as the one main will hold.
 */
async function basisForRestore(
  args: RestoreCompanionArgs,
  recorded: EnablingTransition | SeededTransition | UntrackedTransition,
  companionIsThere: boolean
): Promise<RestoreBasis | null> {
  if (recorded.status !== "untracked") {
    if (companionIsThere) return recorded;
    // The companion is already gone — a `nextly migrate` run, or a teardown. There is nothing to
    // copy and nothing left for the record to describe, so it stops describing it rather than
    // leaving a restore permanently owed against a table that does not exist.
    await forgetI18nTransition(args.store, args.kind, args.slug);
    return null;
  }

  // No companion and no record: never localized, nothing to bring back.
  if (!companionIsThere) return null;

  const sourceLocale = args.defaultLocale;
  if (typeof sourceLocale !== "string" || sourceLocale.length === 0) {
    // Nothing recorded the language, and the configuration no longer names one either. Refusing is
    // the only honest answer: the copy has to declare what language main ends up holding, and
    // inventing that is the guesswork the record exists to stop.
    throw NextlyError.internal({
      logContext: {
        reason:
          "cannot restore an untracked companion without a configured default locale",
        slug: args.slug,
        kind: args.kind,
      },
    });
  }

  await beginI18nTransition(args.store, {
    kind: args.kind,
    slug: args.slug,
    sourceLocale,
  });
  // Re-read rather than assume: the claim can be lost, and the copy must run against the state
  // actually in the row.
  const claimed = await readI18nTransitionState(
    args.store,
    args.kind,
    args.slug
  );
  return claimed.status === "enabling" ? claimed : null;
}

/**
 * The fields whose values the companion is still entitled to supply.
 *
 * A field can be made shared while its entity stays localized. Reconciliation is additive, so its
 * companion column survives while writes correctly go to the restored main-table column — and a
 * later entity-level disable would then copy that abandoned companion value over the current one.
 *
 * Answered by the same classifier the schema pipeline uses to decide which columns the companion
 * gets in the first place, so the two cannot disagree about what "shared" means. That matters
 * because sharing has two spellings and only one of them is written down: `localized: false` says
 * it outright, while a field that simply carries no flag is shared or not according to a per-type
 * default. Reading the flag alone treats a defaulted field as unclaimed, which — for an entity
 * whose remaining fields all rely on the default — leaves nothing claimed at all and hands back
 * every field including the one explicitly marked shared.
 *
 * The physical intersection with the companion narrows this further, and is what actually decides
 * a field the configuration no longer mentions.
 */
function restorableFields(fields: RestorableField[]): RestorableField[] {
  // Classified as if the entity were still localized: it is being turned off, and the question is
  // which columns the companion owned while it was on.
  const owned = new Set(resolveLocalizedFieldNames(fields, true));
  // A field the configuration declares shared outright is never restored from, in any branch.
  // Reconciliation is additive, so one made shared while its entity stayed localized keeps a
  // companion column that the physical intersection would accept — and copying it back would
  // overwrite the value main has been authoritative for ever since.
  const notShared = fields.filter(f => f.localized !== false);
  // Nothing classified as localized means the flags were cleared in the same edit that disabled
  // the entity, which says nothing about what the companion held while it was on. There is no
  // per-field split left to honour, so what remains after the explicit exclusions is offered and
  // the physical intersection decides. A genuine split, where some fields still classify as
  // localized, is a statement about the entity's shape and is honoured as one.
  if (owned.size === 0) return notShared;
  return notShared.filter(f => owned.has(f.name));
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
