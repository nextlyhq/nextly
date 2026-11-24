/**
 * What each kind of start says of a problem in the Builder's definitions, on every dialect.
 *
 * A collection the Schema Builder owns holds a password marked translatable: the commands refuse
 * it, and the site serves it. A production start says so from the rows it reads anyway; a
 * development start leaves it to its reload, which reads the definition file, and says it itself
 * wherever that reload does not come. It is said once, and the site serves whatever is said.
 *
 * The starts are real, and so is the configuration loader; only the configuration's bundle is
 * stood in for, as the loader imports it through Node's VM, which the test runner does not provide.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stood = vi.hoisted(() => ({
  config: {} as unknown,
  judgingFails: false,
}));

vi.mock("../../cli/utils/config-bundler", () => ({
  bundleAndRequire: async () => ({
    mod: { default: stood.config },
    dependencies: [],
  }),
}));
// The rules the start judges by, made to fail for one case.
vi.mock("../../shared/lib/config-problems", async importOriginal => {
  const original =
    await importOriginal<typeof import("../../shared/lib/config-problems")>();
  return {
    ...original,
    builderDefinitionProblems: (
      ...args: Parameters<typeof original.builderDefinitionProblems>
    ) => {
      if (stood.judgingFails) throw new Error("s3cret-in-a-message");
      return original.builderDefinitionProblems(...args);
    },
  };
});

import { createScratchDatabase } from "../../__tests__/helpers/fresh-database";
import { recordStatements } from "../../__tests__/helpers/record-statements";
import { clearConfigCache } from "../../cli/utils/config-loader";
import { createAdapter } from "../../database/factory";
import { _resetBuilderWarningsForTest } from "../../di/builder-problems-at-start";
import { shutdownServices } from "../../di/register";
import { dispatchCollections } from "../../dispatcher/handlers/collection-dispatcher";
import { MetaService } from "../../domains/meta/services/meta-service";
import { getNextly, shutdownNextly, startSettled } from "../../init";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
} from "../../plugins/test-nextly";
import { _resetEnvCache } from "../../shared/lib/env";
import { sanitizeConfig } from "../../shared/types/config";
import { reloadNextlyConfig } from "../reload-config";

const SOUND = [
  { name: "body", type: "text" },
  { name: "pin", type: "password" },
];
/** A password marked translatable, which none can be: refused by the commands, served by the site. */
const PROBLEM = [SOUND[0], { name: "pin", type: "password", localized: true }];
const AT_START = "Problems in the Schema Builder's definitions";
const AT_LOAD = "Problem in the Builder's definitions at ui-schema.json";

describe.each(getConfiguredTestDialects())(
  "a start serving a Builder collection with a problem (%s)",
  (dialect: TestDialect) => {
    let dir: string;
    let home: string;
    let url: string;
    let drop: () => Promise<void>;
    let warned: string[];

    const adapterFor = () =>
      createAdapter({ type: dialect, url } as Parameters<
        typeof createAdapter
      >[0]) as Promise<DrizzleAdapter>;
    const said = (what: string) => warned.filter(line => line.includes(what));

    beforeEach(async () => {
      home = process.cwd();
      dir = realpathSync(mkdtempSync(join(tmpdir(), "nextly-told-at-start-")));
      process.chdir(dir);
      if (dialect === "sqlite") {
        url = `file:${join(dir, "app.db")}`;
        drop = async () => undefined;
      } else {
        const scratch = await createScratchDatabase(dialect, "nextly_told");
        url = scratch.url;
        drop = scratch.drop;
      }
      vi.stubEnv("DB_DIALECT", dialect);
      vi.stubEnv("DATABASE_URL", url);
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
      _resetEnvCache();
      stood.config = {};
      stood.judgingFails = false;
      clearConfigCache();
      _resetBuilderWarningsForTest();

      // The collection, made by the Schema Builder; then its stored fields and, where a case asks
      // for one, the definition file hold the problem.
      vi.stubEnv("NODE_ENV", "development");
      await createTestNextly({
        adapter: (await adapterFor()) as never,
        basePath: dir,
        db: { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" },
      });
      await dispatchCollections(
        {} as Parameters<typeof dispatchCollections>[0],
        "createCollection",
        {},
        { name: "cases", label: "Cases", fields: SOUND }
      );
      await shutdownServices();
      warned = [];
      vi.spyOn(console, "warn").mockImplementation((...parts: unknown[]) => {
        warned.push(parts.map(String).join(" "));
      });
    }, 240_000);

    afterEach(async () => {
      await shutdownNextly();
      await shutdownServices();
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      _resetEnvCache();
      clearConfigCache();
      process.chdir(home);
      await drop();
      rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
    });

    /** Gives the collection's registry row, and the definition file, these fields. */
    async function holds(fields: unknown[]): Promise<void> {
      const adapter = await adapterFor();
      const value = JSON.stringify(fields).replaceAll("'", "''");
      await adapter.executeQuery(
        `UPDATE dynamic_collections SET fields = '${value}' WHERE slug = 'cases'`
      );
      await adapter.disconnect();
      writeFileSync(
        join(dir, "ui-schema.json"),
        JSON.stringify({
          collections: [{ slug: "cases", fields }],
          singles: [],
          components: [],
        })
      );
    }
    const configFile = () =>
      writeFileSync(join(dir, "nextly.config.mjs"), "export default {};\n");

    /** A start, and what it serves of the collection. */
    async function started(mode: "production" | "development" | "test") {
      vi.stubEnv("NODE_ENV", mode);
      _resetEnvCache();
      const nextly = await getNextly({
        config: sanitizeConfig({
          db: {
            migrationsDir: "./migrations",
            uiSchemaFile: "./ui-schema.json",
          },
        } as never) as never,
        adapter: await adapterFor(),
      } as never);
      await startSettled();
      return nextly.find({ collection: "cases" });
    }

    it("in production says it once, in names and codes, and serves the collection", async () => {
      await holds(PROBLEM);

      const served = await started("production");
      await shutdownNextly();
      await started("production");

      expect(served.items).toEqual([]);
      expect(said(AT_START), warned.join("\n")).toHaveLength(1);
      expect(said(AT_START)[0]).toContain("collection 'cases'");
      expect(said(AT_START)[0]).toContain("FIELD_NEVER_TRANSLATABLE");
      expect(said(AT_LOAD)).toEqual([]);
    }, 300_000);

    it("in production sends the database no more for it", async () => {
      const statements = async () => {
        const probe = await adapterFor();
        const recorder = await recordStatements(probe, dialect);
        try {
          await started("production");
        } finally {
          recorder.uninstall();
        }
        await shutdownNextly();
        await probe.disconnect();
        return recorder.statements;
      };
      /** How often the collections' registry is read for their fields. */
      const registryReads = (sent: readonly string[]) =>
        sent
          .map(statement => statement.trim().toLowerCase())
          .filter(
            statement =>
              statement.startsWith("select") &&
              statement.includes("dynamic_collections") &&
              statement.includes("fields")
          ).length;
      // The first production start of a database settles what later ones find settled.
      await statements();
      const sound = await statements();
      await holds(PROBLEM);
      const withProblem = await statements();

      expect(withProblem).toHaveLength(sound.length);
      // Judged from the one read of it the start makes anyway.
      expect(registryReads(withProblem)).toBe(1);
      expect(said(AT_START)).toHaveLength(1);
    }, 300_000);

    it("in production says nothing of a sound definition", async () => {
      await started("production");

      expect(said(AT_START)).toEqual([]);
    }, 300_000);

    it("in production starts and serves where the judging fails, saying only that", async () => {
      await holds(PROBLEM);
      stood.judgingFails = true;

      const served = await started("production");

      expect(served.items).toEqual([]);
      const failed = said("could not be checked");
      expect(failed, warned.join("\n")).toHaveLength(1);
      expect(warned.join("\n")).not.toContain("s3cret-in-a-message");
    }, 300_000);

    it("in development leaves it to the reload, which says it once from the file", async () => {
      configFile();
      await holds(PROBLEM);

      await started("development");

      expect(said(AT_START), warned.join("\n")).toEqual([]);
      expect(said(AT_LOAD), warned.join("\n")).toHaveLength(1);
    }, 300_000);

    it("in development says it again at a start where nothing changed", async () => {
      configFile();
      await holds(PROBLEM);
      await started("development");
      await shutdownNextly();
      // A new process has said nothing yet; the file is as it was.
      warned.length = 0;
      _resetBuilderWarningsForTest();
      vi.resetModules();
      const fresh = await import("../../init");
      vi.stubEnv("NODE_ENV", "development");
      await fresh.getNextly({
        config: sanitizeConfig({
          db: {
            migrationsDir: "./migrations",
            uiSchemaFile: "./ui-schema.json",
          },
        } as never) as never,
        adapter: await adapterFor(),
      } as never);
      await fresh.startSettled();
      await fresh.shutdownNextly();

      expect(said(AT_LOAD), warned.join("\n")).toHaveLength(1);
    }, 300_000);

    it.each([
      ["with its schema apply disabled", "1", true],
      ["with no configuration file to reload", undefined, false],
    ])(
      "in development says it itself %s",
      async (_, disabled, withFile) => {
        if (disabled !== undefined) {
          vi.stubEnv("NEXTLY_DISABLE_BOOT_APPLY", disabled);
        }
        if (withFile) configFile();
        await holds(PROBLEM);

        const served = await started("development");

        expect(served.items).toEqual([]);
        expect(said(AT_START), warned.join("\n")).toHaveLength(1);
      },
      300_000
    );

    it("in development says it itself where a Builder save is left unsettled", async () => {
      configFile();
      await holds(PROBLEM);
      const adapter = await adapterFor();
      await new MetaService(adapter as never, console as never).set(
        "builder-save-in-progress:single:unreadable_one",
        "not a record"
      );
      await adapter.disconnect();

      const served = await started("development");

      expect(served.items).toEqual([]);
      // The start met the record and held its changes back.
      expect(said("is not settled").length, warned.join("\n")).toBeGreaterThan(
        0
      );
      expect(said(AT_START), warned.join("\n")).toHaveLength(1);
    }, 300_000);

    it("outside production and development says it itself", async () => {
      await holds(PROBLEM);

      await started("test");

      expect(said(AT_START), warned.join("\n")).toHaveLength(1);
    }, 300_000);

    it("says nothing more at a save's reload of the same file, and speaks anew when it changes", async () => {
      configFile();
      await holds(PROBLEM);
      await started("development");
      expect(said(AT_LOAD)).toHaveLength(1);

      await reloadNextlyConfig();
      expect(said(AT_LOAD)).toHaveLength(1);

      await holds([{ name: "body", type: "acme-rating" }, PROBLEM[1]]);
      await reloadNextlyConfig();
      expect(said(AT_LOAD).length, warned.join("\n")).toBeGreaterThan(1);
      expect(said(AT_START)).toEqual([]);
    }, 300_000);
  }
);
