/**
 * One option of the plugin's own `page_builder__site_options` table, read by
 * its name: the one read every option kept there shares.
 *
 * @module site-option-read
 */
import { eq } from "@nextlyhq/plugin-sdk/db";
import type { PluginDatabase } from "@nextlyhq/plugin-sdk/schema";

import { siteOptions } from "./schema/tables";

/** The value stored under `name`, or null when no row holds that name. */
export async function readSiteOption(
  db: Pick<PluginDatabase, "select" | "table">,
  name: string
): Promise<string | null> {
  const row = await db
    .select(siteOptions)
    .where(eq(db.table(siteOptions).name, name))
    .first();
  const value = (row as { value?: unknown } | null)?.value;
  return typeof value === "string" ? value : null;
}
