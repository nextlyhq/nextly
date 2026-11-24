/**
 * What the Schema Builder's own saves take that the code rules refuse, so a definition file the
 * commands judge (`builderDefinitionProblems`) is not refused for what the product itself wrote.
 *
 * Each shape is sent through the Builder's own entry points, creating an entity and changing its
 * fields, and the definition file the save wrote is then judged as a command judges it.
 */
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAdapter } from "../../../../database/factory";
import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { builderDefinitionProblems } from "../../../../shared/lib/config-problems";
import { _resetEnvCache } from "../../../../shared/lib/env";

const DEFINITION = "./schema/builder.json";
type Container = Parameters<typeof dispatchCollections>[0];

let instance: TestNextly | undefined;
let basePath: string;
const previousEnv = {
  dialect: process.env.DB_DIALECT,
  url: process.env.DATABASE_URL,
};

beforeEach(async () => {
  basePath = await mkdtemp(join(tmpdir(), "nextly-builder-allowances-"));
  // The Builder's save applies its change, and records it, in development.
  vi.stubEnv("NODE_ENV", "development");
});

afterEach(async () => {
  await instance?.destroy();
  instance = undefined;
  vi.unstubAllEnvs();
  for (const [key, value] of [
    ["DB_DIALECT", previousEnv.dialect],
    ["DATABASE_URL", previousEnv.url],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  _resetEnvCache();
  await rm(basePath, { recursive: true, force: true });
});

describe.each(getConfiguredTestDialects())(
  "the Schema Builder's own saves (%s)",
  dialect => {
    async function boot(): Promise<void> {
      const db = { migrationsDir: "./migrations", uiSchemaFile: DEFINITION };
      if (dialect !== "sqlite") {
        instance = await createTestNextly({
          dialect: dialect as TestDialect,
          basePath,
          db,
        });
        return;
      }
      const url = `file:${join(basePath, "test.db")}`;
      process.env.DB_DIALECT = "sqlite";
      process.env.DATABASE_URL = url;
      _resetEnvCache();
      const adapter = await createAdapter({ type: "sqlite", url } as Parameters<
        typeof createAdapter
      >[0]);
      instance = await createTestNextly({ adapter, basePath, db });
    }

    const text = (name: string) => ({ name, type: "text" });
    const create = (fields: unknown[]) =>
      dispatchCollections(
        {} as Container,
        "createCollection",
        {},
        { name: "cases", label: "Cases", fields }
      );
    const change = (fields: unknown[]) =>
      dispatchCollections(
        {} as Container,
        "applySchemaChanges",
        { collectionName: "cases" },
        { fields, confirmed: true, schemaVersion: 1 }
      );
    /** The definition file the saves wrote. */
    const written = () =>
      JSON.parse(readFileSync(join(basePath, DEFINITION), "utf8")) as {
        collections: Array<{ slug: string; fields: unknown[] }>;
      };
    /** What a command that reads the entities would report of it. */
    const reported = () =>
      builderDefinitionProblems(written(), {}, DEFINITION).map(
        problem => [problem.code, problem.path] as const
      );
    const laidOut = { type: "group", fields: [text("subtitle")] };

    it("take a field named by a SQL keyword when its fields change, and the file is not refused for it", async () => {
      await boot();
      await create([text("heading")]);

      await change([text("heading"), text("select"), text("order")]);

      expect(written().collections[0]?.fields).toEqual([
        text("heading"),
        text("select"),
        text("order"),
      ]);
      expect(reported()).toEqual([]);
    });

    it("take a group with no name at the top when its fields change, and the file is not refused for it", async () => {
      await boot();
      await create([text("heading")]);

      await change([text("heading"), laidOut]);

      expect(written().collections[0]?.fields).toEqual([
        text("heading"),
        laidOut,
      ]);
      expect(reported()).toEqual([]);
    });

    it.each(["group", "repeater"])(
      "take a group with no name inside a %s of a new collection, and the file is not refused for it",
      async type => {
        await boot();
        const holder = { name: "holder", type, fields: [laidOut] };

        await create([holder]);

        expect(written().collections[0]?.fields).toEqual([holder]);
        expect(reported()).toEqual([]);
      }
    );
  }
);
