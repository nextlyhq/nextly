/**
 * The site-wide spacing model an earlier release recorded, cleared with the
 * site's next save of its site style.
 *
 * Earlier releases kept the model ("classic" or "gaps") as a row named
 * `spacing-mode` in the plugin's options table. Blocks are always spaced by
 * the gap of the container holding them now: nothing reads the row, so a site
 * recorded as "classic" already renders with gaps, and the row is only left
 * behind. It is removed inside the save's own transaction, so a save that
 * fails leaves it as it was, and a save that commits leaves the table without
 * it.
 *
 * At a save rather than at start, and not by a migration: removing rows in a
 * migration needs the deployer's consent to lose data, which a deploy with no
 * one to ask refuses, and a start should change nothing. The Site Style
 * Single itself has no field for the model, so the row is all there is to
 * clear.
 *
 * @module retired-spacing-option
 */
import type { InTransactionContext, PluginContext } from "@nextlyhq/plugin-sdk";
import { eq } from "@nextlyhq/plugin-sdk/db";

import { siteOptions } from "./schema/tables";
import { SITE_STYLE_SLUG } from "./site-style-storage";

/** The row's name in the plugin's options table. */
export const RETIRED_SPACING_OPTION = "spacing-mode";

/** Clear the row on every write of the site style, as the host named it. */
export function registerRetiredSpacingOptionCleanup(
  ctx: Pick<PluginContext, "hooks" | "self">
): void {
  const slug = ctx.self.singles[SITE_STYLE_SLUG] ?? SITE_STYLE_SLUG;
  ctx.hooks.onInTransaction(`single:${slug}`, write =>
    clearRetiredSpacingOption(write.db)
  );
}

/** Remove the row on the write's transaction; one statement, none if absent. */
async function clearRetiredSpacingOption(
  db: Pick<InTransactionContext["db"], "delete" | "table">
): Promise<void> {
  await db
    .delete(siteOptions)
    .where(eq(db.table(siteOptions).name, RETIRED_SPACING_OPTION));
}
