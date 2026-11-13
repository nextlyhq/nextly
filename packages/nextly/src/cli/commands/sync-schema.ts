/**
 * The schema part of `nextly db:sync` and of each re-sync its watch makes, in one order, so the
 * two cannot drift:
 *
 * 1. the registry read as it is before anything changes, and the fields a translated entity makes
 *    shared found from it (`fieldsLeavingUnder`), any that can't be moved refused before anything
 *    changes;
 * 2. the companion pass before the pushes, which copies content into a translations table while
 *    the main table still has it;
 * 3. the pushes, with each leaving field's Required and Unique held back, so its new main column
 *    is added over rows that have no value for it yet;
 * 4. the companion pass after them, then the leaving fields' move as a `next dev` reload makes it
 *    (`moveFieldsLeavingOnReload`): other languages archived, the default language's value copied
 *    onto the main table, the settings pushed, and the translations column dropped last.
 *
 * Before the move, a field made shared kept every value in its translations column while its new
 * main column stayed empty, and every read of it returned nothing.
 *
 * @module cli/commands/sync-schema
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { readRecordedEntities } from "../../domains/i18n/migration/recorded-before";
import { describeError } from "../../errors/index";
import { NextlyError } from "../../errors/nextly-error";
import type { CommandContext } from "../program";
import type { CLIDatabaseAdapter } from "../utils/adapter";
import type { LoadConfigResult } from "../utils/config-loader";

import type { ResolvedDevOptions } from "./db-sync";
import {
  ensureLocalizedCompanions,
  publishExtensionSchema,
  syncCollections,
  syncComponents,
  syncSingles,
} from "./dev-build";

/** The three pushes, collections first, as each sync expects of the ones before it. */
async function pushEntities(
  configResult: LoadConfigResult,
  adapter: CLIDatabaseAdapter,
  options: ResolvedDevOptions,
  context: CommandContext
): Promise<void> {
  await syncCollections(configResult, adapter, options, context);
  await syncSingles(configResult, adapter, options, context);
  await syncComponents(configResult, adapter, options, context);
}

/** Stops the run, naming the entities whose translated fields stay where they are. */
function translationsStayPut(
  slugs: readonly string[],
  changed: boolean
): never {
  throw NextlyError.conflict({
    reason: "state",
    message:
      `Fields leaving translation in ${slugs.join(", ")} were not moved${changed ? "" : ", and nothing was changed"} (see above). ` +
      "Their values are intact in the translations table. Fix the error above and sync again.",
    logContext: {
      reason: "fields-leaving-translation-not-moved",
      entities: slugs,
      changed,
    },
  });
}

/**
 * Steps 1 to 4 of the module, under the run's `--no-auto-sync` and production rules. Called inside
 * the run's pinned field-type scope: a companion holds the translated subset of the same fields,
 * so it resolves plugin types against the config being materialized, as the pushes do.
 */
export async function syncSchemaInOrder(
  configResult: LoadConfigResult,
  adapter: CLIDatabaseAdapter,
  options: ResolvedDevOptions,
  context: CommandContext
): Promise<void> {
  const { logger } = context;
  const { config } = configResult;
  const live = adapter as unknown as DrizzleAdapter;
  const autoSync = options.autoSync !== false;
  // The pushes and the companion passes change nothing in production, so nothing is moved there.
  const moves = autoSync && process.env.NODE_ENV !== "production";

  // Every entity as the registry records it before the syncs below rewrite it, so the companion
  // passes can tell a field this run newly translates, and the move a field it makes shared.
  const recordedBefore = autoSync
    ? await readRecordedEntities(live, config, error =>
        logger.warn(
          `The registry could not be read, so no translations column is judged this run: ${describeError(error)}`
        )
      )
    : undefined;
  // Loaded, as the reload loads it, only when there is a record to judge: with none, no field
  // leaves, and the schema services it reaches have nothing to do.
  const mover =
    moves && recordedBefore !== undefined
      ? await import("../../domains/i18n/runtime/fields-leaving-on-reload")
      : undefined;
  // A field group's table is the one its config names, as the companion passes take it.
  const leaving = mover
    ? await mover.fieldsLeavingUnder(
        live,
        config,
        new Map(),
        recordedBefore,
        m => logger.error(m)
      )
    : { entries: [], refused: [] };
  if (leaving.refused.length > 0) {
    translationsStayPut(leaving.refused, false);
  }

  // Before the pushes, so an entity gaining localization has its existing content copied into the
  // companion while the main table still carries it. The drop the push then applies is a cleanup
  // rather than a loss.
  if (autoSync) {
    await ensureLocalizedCompanions(config, adapter, context, "beforeApply", {
      recordedBefore,
    });
  }

  // Before the pushes, which plan plugin tables and contributed elements from it.
  await publishExtensionSchema(configResult, adapter, context);
  await pushEntities(
    {
      ...configResult,
      config:
        mover?.configWithLeavingSettingsHeld(config, leaving.entries) ?? config,
    },
    adapter,
    options,
    context
  );

  // The companion of every localized entity, which the pushes do not manage, after all three:
  // it references its main table. Gated on `--no-auto-sync` as the pushes are, since it issues DDL
  // and can copy rows.
  if (!autoSync) return;
  await ensureLocalizedCompanions(config, adapter, context, "afterApply", {
    recordedBefore,
  });
  if (!mover || leaving.entries.length === 0) return;
  const stopped = await mover.moveFieldsLeavingOnReload({
    adapter: live,
    entries: leaving.entries,
    deferred: new Set(),
    config,
    blockedBy: [],
    // The settings push: the config as it is, whose leaving fields' values are now shared.
    push: async () => {
      await pushEntities(configResult, adapter, options, context);
      return { success: true };
    },
    report: m => logger.error(m),
  });
  if (stopped.length > 0) translationsStayPut(stopped, true);
}
