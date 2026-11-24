/**
 * The development server's block of the changes not yet in a migration, driven through a start's
 * reload, a reload after a configuration edit and `migrate:create`, on each configured dialect,
 * registered by a test file that chooses the storage layout (`dev-drift-block*.integration.test.ts`).
 *
 * A translated collection is used, so a per-language layout keeps its text fields in their
 * translations table, which a block read from the main tables alone would miss. What would
 * separate a correct block from a broken one: a block at a start that is in step; no block after
 * an edit the push applied; one that misses the added field; "fully captured" never said, or said
 * twice; anything said again after a reload that changed nothing.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { defineCollection, defineConfig } from "../../../../config";
import { DRIFT_HEADER, FULLY_CAPTURED } from "../../../../init/drift-block";
import { reloadNextlyConfig } from "../../../../init/reload-config";
import { describeEachDialect } from "../../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { consoleLogger } from "../../../../shared/types";
import { _resetEnvCache } from "../../../../shared/lib/env";

import { type Loaded, pendingProject } from "./pending-project";

const SLUG = "ddposts";

const LOCALIZATION = { locales: ["en", "es"], defaultLocale: "en" };

/** The project with the translated collection holding `fields` (text, translated). */
const siteWith = (...fields: string[]) =>
  defineConfig({
    localization: LOCALIZATION,
    db: { migrationsDir: "./migrations" },
    collections: [
      defineCollection({
        slug: SLUG,
        localized: true,
        fields: fields.map(name => ({
          name,
          type: "text" as const,
          localized: true,
        })),
      }),
    ],
  });

export function devDriftBlockCases(loaded: Loaded, layout: string): void {
  describeEachDialect(
    `the development server's block of changes not yet in a migration, ${layout}`,
    dialect => {
      let dir: string;
      let handle: TestNextly | undefined;
      let said: { warn: string[]; info: string[] };
      const { create } = pendingProject(loaded, () => dir);

      beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "nextly-dev-drift-block-"));
        vi.stubEnv("CI", "");
        vi.stubEnv("DB_DIALECT", dialect);
        vi.stubEnv("DATABASE_URL", "");
        _resetEnvCache();
        said = { warn: [], info: [] };
      });

      afterEach(async () => {
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
        _resetEnvCache();
        await handle?.destroy();
        handle = undefined;
        rmSync(dir, { recursive: true, force: true });
      });

      /** Start a development server over `config`, its project in `dir`, as `next dev` does. */
      async function start(config: ReturnType<typeof siteWith>) {
        handle = await createTestNextly({
          ...(dialect === "sqlite" ? {} : { dialect }),
          basePath: dir,
          localization: LOCALIZATION,
          collections: config.collections,
        });
        vi.stubEnv("NODE_ENV", "development");
        vi.spyOn(consoleLogger, "warn").mockImplementation(line => {
          said.warn.push(String(line));
        });
        vi.spyOn(consoleLogger, "info").mockImplementation(line => {
          said.info.push(String(line));
        });
        loaded.config = config;
        await reloadNextlyConfig({ atStart: true });
      }

      /** A save of `config` under `next dev`: the reload that applies it. */
      async function save(config: ReturnType<typeof siteWith>) {
        loaded.config = config;
        await reloadNextlyConfig();
      }

      const blocks = () =>
        said.warn.filter(line => line.startsWith(DRIFT_HEADER));
      const captured = () => said.info.filter(line => line === FULLY_CAPTURED);

      it("start, add a field, read the block", async () => {
        expect((await create(siteWith("title"))).code).toBeUndefined();
        await start(siteWith("title"));
        // In step with its migrations: nothing said.
        expect(blocks()).toEqual([]);

        await save(siteWith("title", "summary"));

        expect(blocks()).toHaveLength(1);
        expect(blocks()[0]).toContain(`${SLUG}: field summary added`);
        expect(blocks()[0]).toContain("nextly migrate:create");
      });

      it("after migrate:create, says fully captured once", async () => {
        expect((await create(siteWith("title"))).code).toBeUndefined();
        await start(siteWith("title"));
        await save(siteWith("title", "summary"));
        expect(blocks()).toHaveLength(1);

        // Run in another process as a developer runs it: the server sees the migration it wrote.
        expect(
          (await create(siteWith("title", "summary"))).code
        ).toBeUndefined();
        await vi.waitFor(() => expect(captured()).toHaveLength(1), {
          timeout: 10_000,
          interval: 100,
        });

        // A reload that changed nothing says nothing more.
        await save(siteWith("title", "summary"));
        expect(captured()).toHaveLength(1);
        expect(blocks()).toHaveLength(1);
      });
    }
  );
}
