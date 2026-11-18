/**
 * Storing every entity's translatable values per language: each entity whose main table still
 * holds translatable columns has them moved into its per-language table, each document's values
 * becoming its default language's row, and the columns dropped from the main table.
 *
 * Every installation keeps its translatable values per language once upgraded, a site with one
 * language included; before the upgrade only a translated entity did. The move is the one the
 * Schema Builder makes when an entity becomes translated (`buildCompanionTransitionStatements`),
 * so a value moves exactly as a translation switched on moves it. Which entities have values to
 * move is the boot's own answer (`valuesKeptOnMain`): the upgrade moves exactly what the boot
 * refuses to serve.
 *
 * @module cli/commands/upgrade-steps/localisation-values
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { sql } from "drizzle-orm";

import { applyCompanionTransition } from "../../../domains/i18n/migration/held-leaving-drops";
import {
  buildCompanionTransitionStatements,
  type CompanionFieldLike,
} from "../../../domains/i18n/migration/reconcile-companion";
import { resolveTransitionStore } from "../../../domains/i18n/migration/transition-recorder";
import { readI18nTransitionState } from "../../../domains/i18n/migration/transition-state";
import {
  valuesKeptOnMain,
  type LaidOutEntity,
} from "../../../domains/i18n/per-language-storage-layout";
import { liveCompanionShape } from "../../../domains/i18n/runtime/companion-io";
import { runStatement } from "../../../domains/schema/pipeline/_internal/run-statement";
import { NextlyError } from "../../../errors/nextly-error";
import type { UpgradeReport, UpgradeStepContext } from "../upgrade-step";

import { builtByOf, siteEntities, siteLanguages } from "./localisation-site";

/** An entity with translatable values still on its main table, and what the move does with them. */
interface ToMove {
  entity: LaidOutEntity;
  onMain: string[];
  /**
   * `copy`: no translations table yet, so the values move into it. `drop`: the copy across was
   * recorded as finished, so the main table's columns are leftovers nothing reads, and go.
   */
  how: "copy" | "drop";
}

/**
 * Each entity with translatable values still on its main table, and how they move. An entity whose
 * translations table is already there is moved only where its transition record says the copy
 * finished; with any other record (none, an unfinished copy, a disable the table outlived) nothing
 * says which copy is current, and the upgrade refuses, naming the one-time recovery.
 */
async function entitiesToMove(context: UpgradeStepContext): Promise<ToMove[]> {
  const adapter = context.adapter as unknown as DrizzleAdapter;
  const found = await valuesKeptOnMain(adapter, await siteEntities(context));
  const toMove: ToMove[] = [];
  const unresolved: string[] = [];
  let store: Awaited<ReturnType<typeof resolveTransitionStore>> | undefined;
  for (const { entity, onMain } of found) {
    if (!(await adapter.tableExists(`${entity.tableName}_locales`))) {
      toMove.push({ entity, onMain, how: "copy" });
      continue;
    }
    store ??= await resolveTransitionStore(adapter);
    const recorded = await readI18nTransitionState(
      store,
      transitionKindOf(entity),
      entity.slug
    );
    if (recorded.status === "seeded") {
      toMove.push({ entity, onMain, how: "drop" });
    } else {
      unresolved.push(
        `the ${entity.kind} "${entity.slug}" (${onMain.join(", ")})`
      );
    }
  }
  if (unresolved.length > 0) {
    throw new NextlyError({
      code: "NEXTLY_UPGRADE_LOCALISATION_UNRESOLVED",
      publicMessage:
        `The translatable values of ${unresolved.join("; ")} are both on the main table and in ` +
        `its translations table, and nothing records which is current. Run ` +
        `\`nextly migrate --repair-localization\` once, then the upgrade again. Nothing was changed.`,
      logContext: { entities: unresolved },
    });
  }
  return toMove;
}

/** How many entities have translatable values to move. */
export async function entitiesWithValuesToMove(
  context: UpgradeStepContext
): Promise<number> {
  return (await entitiesToMove(context)).length;
}

/** The kind a transition names an entity by. */
function transitionKindOf(
  entity: LaidOutEntity
): "collection" | "single" | "fieldGroup" {
  return entity.kind === "component" ? "fieldGroup" : entity.kind;
}

/** Move each entity's translatable values into its per-language table; how many entities moved. */
export async function moveValuesPerLanguage(
  context: UpgradeStepContext
): Promise<number> {
  const adapter = context.adapter as unknown as DrizzleAdapter;
  const languages = await siteLanguages(context);
  const found = await entitiesToMove(context);
  for (const { entity, onMain, how } of found) {
    if (how === "drop") {
      // The copy finished: the values are read from the translations table, so the main table's
      // columns only stand in the way of a single layout.
      for (const column of onMain) {
        await runStatement(
          adapter.getDrizzle(),
          adapter.dialect,
          sql`ALTER TABLE ${sql.identifier(entity.tableName)} DROP COLUMN ${sql.identifier(column)}`
        );
      }
      continue;
    }
    const fields = entity.fields as CompanionFieldLike[];
    const builtBy = builtByOf(entity);
    const companionExists = await adapter.tableExists(
      `${entity.tableName}_locales`
    );
    const plan = buildCompanionTransitionStatements({
      builtBy,
      slug: entity.slug,
      kind: transitionKindOf(entity),
      tableName: entity.tableName,
      dialect: adapter.dialect,
      defaultLocale: languages.defaultLocale,
      languageOrder: languages.codes,
      // A translated entity keeps a status per language where it is Draft/Published; one that is
      // not translated publishes as one document, its status on its main row alone.
      status: entity.localized === true && entity.status === true,
      wasStatus: false,
      wasLocalized: false,
      isLocalized: true,
      oldFields: fields,
      newFields: fields,
      companionExists,
      // What this database holds now, so a run that stopped part-way is finished, not repeated.
      ...(await liveCompanionShape(adapter, {
        tableName: entity.tableName,
        oldFields: fields,
        newFields: fields,
        builtBy,
        companionExists,
      })),
    });
    await applyCompanionTransition({
      adapter,
      plan,
      kind: transitionKindOf(entity),
      slug: entity.slug,
      tableName: entity.tableName,
    });
  }
  return found.length;
}

/** What the dry run lists of the move: each entity, and the columns that move. */
export async function valuesMoveReport(
  context: UpgradeStepContext
): Promise<UpgradeReport> {
  const { defaultLocale } = await siteLanguages(context);
  return {
    move: (await entitiesToMove(context)).map(({ entity, onMain, how }) =>
      how === "copy"
        ? `the ${entity.kind} "${entity.slug}": ${onMain.join(", ")} to its per-language table, as each document's "${defaultLocale}" values`
        : `the ${entity.kind} "${entity.slug}": ${onMain.join(", ")} left on its main table after its values were copied across, removed`
    ),
    conflicts: [],
    check: [],
  };
}
