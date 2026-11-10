/**
 * Where a site's spacing model is kept: one row of the plugin's own
 * `page_builder__site_options` table, named `spacing-mode`.
 *
 * ## The row is the mode and the run-once marker at once
 *
 * A site with no row compiles under the engine's default (`gaps`). The row is
 * written in exactly two ways, and its presence means one of them happened:
 *
 * - the one-time step at start ({@link SpacingModeStore.adoptIfUnset}), which
 *   records `classic` for a site that already had content and `gaps` for one
 *   that did not, so content added later never changes the answer;
 * - the owner's choice ({@link SpacingModeStore.choose}), from the editor.
 *
 * The step's decision and its write are ONE conflict-safe insert, so there is
 * no claim, no lease and no window in which a stopped process leaves the
 * decision half made. Two instances starting at once both insert and the
 * unique index on `name` keeps one; the other is told it lost and writes
 * nothing. An owner's choice is an update, or an insert when there is no row
 * yet, and the step's insert-if-absent can never overwrite it: once a row
 * exists, by either path, the step's insert is refused.
 *
 * Reached only through the plugin's `ctx.db`: no collection, so no admin
 * screen, REST route or Direct API call writes the row except the routes this
 * plugin declares.
 *
 * @module spacing-mode-store
 */
import { spacingModeOf, type SpacingMode } from "@nextlyhq/blocks-engine";
import { eq } from "@nextlyhq/plugin-sdk/db";
import {
  isUniqueViolation,
  type PluginDatabase,
} from "@nextlyhq/plugin-sdk/schema";

import { siteOptions } from "./schema/tables";
import type { SpacingModeReader } from "./spacing-mode-reader";

/** The option's name in the table. */
export const SPACING_MODE_OPTION = "spacing-mode";

/** The spacing model's reads and its two writes. */
export interface SpacingModeStore extends SpacingModeReader {
  /** The owner's choice. Always written, replacing whatever was recorded. */
  choose(mode: SpacingMode): Promise<void>;
  /**
   * Record `mode` only when nothing is recorded yet. `true` when this call
   * wrote it, `false` when a row was already there (or another writer's
   * insert won the race), in which case nothing changed.
   */
  adoptIfUnset(mode: SpacingMode): Promise<boolean>;
}

/** Which database, so a lost race to insert the row is recognised. */
type Dialect = Parameters<typeof isUniqueViolation>[0];

/** The spacing model over the plugin's own database surface. */
export function spacingModeStore(
  db: Pick<PluginDatabase, "select" | "insert" | "update" | "table">,
  dialect: Dialect
): SpacingModeStore {
  const t = () => db.table(siteOptions);
  const named = () => eq(t().name, SPACING_MODE_OPTION);

  /** Insert the row; `false` when one already holds the name. */
  const insert = async (mode: SpacingMode): Promise<boolean> => {
    try {
      await db.insert(siteOptions, { name: SPACING_MODE_OPTION, value: mode });
      return true;
    } catch (error) {
      if (!isUniqueViolation(dialect, error)) throw error;
      return false;
    }
  };

  const update = async (mode: SpacingMode): Promise<boolean> =>
    (await db.update(siteOptions, { value: mode }).where(named())) === 1;

  return {
    read: async () => {
      const row = await db.select(siteOptions).where(named()).first();
      if (row === null) return null;
      // A value this build does not know reads as the default model rather
      // than failing the render that asked.
      return spacingModeOf((row as { value?: unknown }).value);
    },

    choose: async mode => {
      if (await update(mode)) return;
      if (await insert(mode)) return;
      // Another writer inserted between the update and the insert; the owner's
      // choice still wins, so it is written over that row.
      await update(mode);
    },

    adoptIfUnset: insert,
  };
}
