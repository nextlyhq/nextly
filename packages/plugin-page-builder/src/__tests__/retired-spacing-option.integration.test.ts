/**
 * The site-wide spacing model an earlier release recorded, on every
 * configured dialect: read by nothing, and cleared with the site style's next
 * save, inside that save's transaction.
 *
 * What separates a correct release from a plausible broken one:
 * - a `classic` row left in the options table reaches neither the loaded site
 *   style nor the sheet a page compiles from, so the page compiles with the
 *   engine's default, container gaps; a release still reading the row hands
 *   `classic` on;
 * - one save of the site style removes the row and keeps every other option;
 * - a save that fails after the cleanup ran (seen gone inside the transaction)
 *   leaves the row as it was: removed outside the save's transaction, it
 *   would stay removed.
 *
 * @module __tests__/retired-spacing-option.integration.test
 */
import { definePlugin, type PluginDefinition } from "@nextlyhq/plugin-sdk";
import { eq } from "@nextlyhq/plugin-sdk/db";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import { pageBuilder } from "../plugin";
import { RETIRED_SPACING_OPTION } from "../retired-spacing-option";
import { SCHEMA_PREFIX, siteOptions } from "../schema/tables";
import { siteSheet } from "../site-style";
import { loadSiteStyle } from "../site-style-load";
import { SITE_STYLE_SLUG } from "../site-style-storage";

/** The plugin's options table, as the database names it. */
const OPTIONS_TABLE = `${SCHEMA_PREFIX}__${siteOptions.name}`;

/** What the failing plugin is told to do on the next save of the site style. */
const nextSave = { fail: false, sawRowGone: false };

/**
 * Fails the next save of the site style when told to, after the page
 * builder's handlers on it, and notes whether the row was already gone on the
 * save's own transaction.
 */
const failingSave: PluginDefinition = definePlugin({
  name: "@t/failing-site-style-save",
  version: "1.0.0",
  nextly: ">=0.0.0",
  dependsOn: { [PAGE_BUILDER_PLUGIN_NAME]: "*" },
  init(ctx) {
    ctx.hooks.onInTransaction(`single:${SITE_STYLE_SLUG}`, async write => {
      if (!nextSave.fail) return;
      const row = await write.db
        .select(siteOptions)
        .where(eq(write.db.table(siteOptions).name, RETIRED_SPACING_OPTION))
        .first();
      nextSave.sawRowGone = row === null || row === undefined;
      throw new Error("Refused by the test after the cleanup ran.");
    });
  },
});

describe.each(getConfiguredTestDialects())(
  "a spacing model an earlier release recorded (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
      nextSave.fail = false;
      nextSave.sawRowGone = false;
    });

    const quote = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

    /** A site holding a `classic` model and one other option. */
    async function boot(): Promise<TestNextly> {
      current = await createTestNextly({
        dialect,
        plugins: [pageBuilder(), failingSave],
      });
      for (const [id, name, value] of [
        ["spacing-model", RETIRED_SPACING_OPTION, "classic"],
        ["kept-option", "kept-probe", "kept"],
      ]) {
        await current.adapter.executeQuery(
          `INSERT INTO ${quote(OPTIONS_TABLE)} (${quote("id")}, ${quote("name")}, ${quote("value")}) VALUES ('${id}', '${name}', '${value}')`
        );
      }
      return current;
    }

    /** The option rows by name, as `<name>=<value>`, sorted. */
    async function options(t: TestNextly): Promise<string[]> {
      const rows = await t.adapter.executeQuery<{
        name: unknown;
        value: unknown;
      }>(
        `SELECT ${quote("name")}, ${quote("value")} FROM ${quote(OPTIONS_TABLE)} WHERE ${quote("name")} IN ('${RETIRED_SPACING_OPTION}', 'kept-probe')`
      );
      return rows.map(row => `${String(row.name)}=${String(row.value)}`).sort();
    }

    /** One save of the site style, as the editor's Design panel makes. */
    const saveStyle = (t: TestNextly) =>
      t.nextly.updateSingle({
        slug: SITE_STYLE_SLUG,
        data: {
          tokens: {
            tokens: [
              { name: "brand", kind: "color", values: { light: "#123456" } },
            ],
          },
          _overwrite: true,
        },
        overrideAccess: true,
      });

    it("reads nothing of it: the site style and the page's sheet carry no spacing model", async () => {
      const t = await boot();
      // CONTROL: the row is there to be read.
      expect(await options(t)).toEqual([
        "kept-probe=kept",
        "spacing-mode=classic",
      ]);

      const style = await loadSiteStyle({ nextly: t.nextly as never });

      expect(style).not.toHaveProperty("spacingMode");
      // What the page compiles from: with no model handed on, the engine
      // spaces blocks by their container's gap.
      expect(siteSheet(style)).not.toHaveProperty("spacingMode");
    });

    it("removes it with the next save of the site style, keeping every other option", async () => {
      const t = await boot();

      await saveStyle(t);

      expect(await options(t)).toEqual(["kept-probe=kept"]);
    });

    it("leaves it as it was when that save fails after the cleanup ran", async () => {
      const t = await boot();
      nextSave.fail = true;

      await expect(saveStyle(t)).rejects.toThrow();

      // The cleanup ran on the save's transaction, and went with it.
      expect(nextSave.sawRowGone).toBe(true);
      expect(await options(t)).toEqual([
        "kept-probe=kept",
        "spacing-mode=classic",
      ]);
    });
  }
);
