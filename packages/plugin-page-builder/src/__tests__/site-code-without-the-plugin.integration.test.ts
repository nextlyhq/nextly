/**
 * The site code Single while the page builder is out of the configuration.
 *
 * Its one sanctioned writer is the site code route, and every other is refused
 * by the Single's own hooks, which leave with the plugin. So nothing may write
 * it until the plugin is back: what is stored is what the route last judged.
 *
 * @module __tests__/site-code-without-the-plugin.integration.test
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text } from "nextly/config";
import { createAdapter } from "nextly/database";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import { pageBuilder } from "../plugin";
import { SITE_CODE_SLUG, SITE_CODE_WRITE_CONTEXT } from "../site-code/storage";

import { scratchDatabase, type ScratchDatabase } from "./scratch-database";

describe.each(getConfiguredTestDialects())(
  "site code while the page builder is out of the configuration (%s)",
  (dialect: TestDialect) => {
    let folder: string;
    let database: ScratchDatabase;
    let site: TestNextly | undefined;

    beforeEach(async () => {
      folder = mkdtempSync(join(tmpdir(), "pb-site-code-"));
      database = await scratchDatabase(dialect, folder);
      vi.stubEnv("DB_DIALECT", dialect);
      vi.stubEnv("DATABASE_URL", database.url);
    }, 60_000);

    afterEach(async () => {
      await site?.destroy();
      site = undefined;
      await database.drop();
      rmSync(folder, { recursive: true, force: true });
      vi.unstubAllEnvs();
    }, 60_000);

    async function boot(withPlugin: boolean): Promise<TestNextly> {
      await site?.destroy();
      site = await createTestNextly({
        adapter: await createAdapter({ type: dialect, url: database.url }),
        collections: [
          defineCollection({ slug: "notes", fields: [text({ name: "body" })] }),
        ],
        plugins: withPlugin ? [pageBuilder()] : [],
      });
      return site;
    }

    const write = (on: TestNextly, context?: Record<string, unknown>) =>
      on.nextly.updateSingle({
        slug: SITE_CODE_SLUG as never,
        data: {
          headSource: context === undefined ? "unjudged" : "judged",
          _overwrite: true,
        } as never,
        overrideAccess: true,
        ...(context === undefined ? {} : { context }),
      } as never);

    const stored = async (on: TestNextly) =>
      (
        (await on.nextly.findSingle({
          slug: SITE_CODE_SLUG as never,
          overrideAccess: true,
        } as never)) as { headSource?: unknown }
      ).headSource;

    it("takes no write until the plugin is back, a system write included", async () => {
      const installed = await boot(true);
      await write(installed, { ...SITE_CODE_WRITE_CONTEXT });
      // The control: the Single's own hooks refuse it while the plugin is there.
      await expect(write(installed)).rejects.toMatchObject({
        code: "CONFLICT",
      });

      const without = await boot(false);
      await expect(write(without)).rejects.toMatchObject({
        code: "ENTITY_REMOVED_FROM_CODE",
        publicMessage: expect.stringContaining(PAGE_BUILDER_PLUGIN_NAME),
      });
      expect(await stored(without)).toBe("judged");

      const back = await boot(true);
      expect(await stored(back)).toBe("judged");
      await write(back, { ...SITE_CODE_WRITE_CONTEXT });
    }, 180_000);
  }
);
