/**
 * A collection made in the Schema Builder leaves nothing a migration does not record: right
 * after its create, `migrate:check` and `nextly migrate` both find the project up to date.
 *
 * The create goes through the dispatcher as the Builder's dialog sends it, with no `admin`
 * settings of its own. A settings comparison that read the definition the Builder wrote apart
 * from the snapshot the same save recorded named a settings change no one made, and every command
 * that refuses such changes then refused a project after its first Builder collection.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runMigrate } from "../../../../cli/commands/migrate";
import { runMigrateCheck } from "../../../../cli/commands/migrate-check";
import type { CommandContext } from "../../../../cli/program";
import { createLogger } from "../../../../cli/utils/logger";
import { defineConfig } from "../../../../config";
import { createAdapter } from "../../../../database/factory";
import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import {
  createTestNextly,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../../services";
import { _resetEnvCache } from "../../../../shared/lib/env";

const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
// `cli/program` imports every command; the commands driven here are handed their context.
vi.mock("../../../../cli/program", () => ({
  createContext: () => ({ logger: createLogger({ quiet: true }) }),
}));
// The commands load the project's configuration through this loader; here it is the one the
// instance was booted with.
vi.mock("../../../../cli/utils/config-loader", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../../../cli/utils/config-loader")
  >()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

const MIGRATIONS = "./database/history";
const DEFINITION = "./schema/builder.json";
const PROJECT = defineConfig({
  collections: [],
  db: { migrationsDir: MIGRATIONS, uiSchemaFile: DEFINITION },
});

let instance: TestNextly | undefined;
let basePath: string;
const previousEnv = {
  dialect: process.env.DB_DIALECT,
  url: process.env.DATABASE_URL,
};

beforeEach(async () => {
  basePath = await mkdtemp(join(tmpdir(), "nextly-builder-create-"));
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

/** Run a command over the project, as its CLI would: its exit code and what it said. */
async function command(
  run: (context: CommandContext) => Promise<void>
): Promise<{ code: number | undefined; said: string[] }> {
  loaded.config = PROJECT;
  const said: string[] = [];
  const capture = (message: string) => {
    said.push(message);
  };
  const context = {
    logger: {
      ...createLogger({ quiet: true }),
      error: capture,
      info: capture,
      success: capture,
      warn: capture,
    },
    options: {},
    cwd: basePath,
  } as CommandContext;
  const printed = vi.spyOn(console, "error").mockImplementation(message => {
    said.push(String(message));
  });
  const exit = vi.spyOn(process, "exit").mockImplementation(code => {
    throw new Error(`exit ${String(code)}`);
  });
  try {
    await run(context);
    return { code: undefined, said };
  } catch (error) {
    const match = /^exit (\d+)$/.exec((error as Error).message);
    if (match) return { code: Number(match[1]), said };
    const e = error as { message?: string; why?: string };
    said.push(String(e.message), String(e.why));
    return { code: 1, said };
  } finally {
    exit.mockRestore();
    printed.mockRestore();
  }
}

// SQLite over a file, which the commands' own connection opens as the instance's.
describe("a collection made in the Schema Builder (sqlite)", () => {
  it("leaves migrate:check and nextly migrate nothing to name after its create", async () => {
    const url = `file:${join(basePath, "test.db")}`;
    process.env.DB_DIALECT = "sqlite";
    process.env.DATABASE_URL = url;
    _resetEnvCache();
    const adapter = await createAdapter({ type: "sqlite", url } as Parameters<
      typeof createAdapter
    >[0]);
    instance = await createTestNextly({
      adapter,
      basePath,
      db: { migrationsDir: MIGRATIONS, uiSchemaFile: DEFINITION },
    });

    // As the Builder's new-collection dialog sends it: no admin settings of its own.
    await dispatchCollections(
      {} as ServiceContainer,
      "createCollection",
      {},
      {
        name: "authors",
        label: "Author",
        fields: [{ name: "name", type: "text" }],
      }
    );
    const definition = join(basePath, "schema", "builder.json");
    expect(existsSync(definition)).toBe(true);
    const meta = join(basePath, "database", "history", "meta");
    const recorded = readdirSync(meta)
      .filter(f => f.endsWith(".snapshot.json"))
      .map(f => {
        const file = JSON.parse(readFileSync(join(meta, f), "utf-8")) as {
          entities?: { collections?: Record<string, unknown> };
        };
        return JSON.stringify(file.entities?.collections?.authors ?? null);
      })
      .join("\n");
    // What the save wrote to the definition and what it recorded, shown on a failure.
    const written = `definition: ${readFileSync(definition, "utf-8")}\nrecorded: ${recorded}`;

    const checked = await command(context =>
      runMigrateCheck({ cwd: basePath }, context)
    );
    expect(
      checked.code,
      `${checked.said.join("\n")}\n${written}`
    ).toBeUndefined();

    const migrated = await command(context =>
      runMigrate(
        { cwd: basePath, throwOnFailure: true } as Parameters<
          typeof runMigrate
        >[0],
        context
      )
    );
    expect(migrated.code, migrated.said.join("\n")).toBeUndefined();
    expect(migrated.said.join("\n")).toContain(
      "Nothing to migrate. Database is up to date."
    );
  }, 60_000);
});
