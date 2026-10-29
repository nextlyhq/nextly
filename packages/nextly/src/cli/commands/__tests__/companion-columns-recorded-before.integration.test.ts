// `db:sync` and its `--watch` loop judge a field they newly translate against the registry as it
// was before their syncs rewrote it, driving each command itself against a real SQLite file.
//
// The companion pass takes a translations column already there as the field's own. For a field the
// run newly translates, that column may be another field's leftover, and one that cannot hold the
// field is refused. Whether the field is new to translation is read from the registry, which the
// syncs rewrite before the pass runs: read before them, the field is new and the run is refused;
// read after them, it looks translated already and the run only warns; not read at all, the
// leftover column is taken silently. So each case separates the order the command reads in.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineCollection, defineConfig } from "../../../config";
import { createAdapter } from "../../../database/factory";
import { describeError } from "../../../errors/index";
import { NO_PLUGIN_CONSENT } from "../../../plugins/plugin-consent";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { CommandContext } from "../../program";
import { createCliAdapter } from "../../utils/adapter";
import type { LoadConfigResult } from "../../utils/config-loader";
import { createLogger } from "../../utils/logger";
import { runDbSync } from "../db-sync";
import type { ResolvedDevOptions } from "../db-sync";
import { createDebouncedSync } from "../dev-watcher";
import { installRegistryResolver } from "../migrate";

const loaded = vi.hoisted(() => ({
  config: undefined as unknown,
}));
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

let dir: string;
let previousDialect: string | undefined;
let previousUrl: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-recorded-before-"));
  previousDialect = process.env.DB_DIALECT;
  previousUrl = process.env.DATABASE_URL;
  process.env.DB_DIALECT = "sqlite";
  process.env.DATABASE_URL = `file:${join(dir, "test.db")}`;
  // The command's adapter reads the environment once per process; each test has a database file
  // of its own.
  _resetEnvCache();
});

afterEach(() => {
  if (previousDialect === undefined) delete process.env.DB_DIALECT;
  else process.env.DB_DIALECT = previousDialect;
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
  _resetEnvCache();
  rmSync(dir, { recursive: true, force: true });
});

const SLUG = "rbefore";
const COMPANION = `dc_${SLUG}_locales`;

/** The collection with `code` absent, shared, or translated. */
function configWith(
  code: "absent" | "shared" | "translated"
): LoadConfigResult["config"] {
  return defineConfig({
    localization: { locales: ["en", "es"], defaultLocale: "en" },
    collections: [
      defineCollection({
        slug: SLUG,
        localized: true,
        fields: [
          { name: "title", type: "text", localized: true },
          ...(code === "absent"
            ? []
            : [
                {
                  name: "code",
                  type: "text",
                  localized: code === "translated",
                },
              ]),
        ] as never,
      }),
    ],
  });
}

/** What the command logged, by level. */
function command(): {
  options: ResolvedDevOptions;
  context: CommandContext;
  said: { warn: string[]; error: string[] };
} {
  const said = { warn: [] as string[], error: [] as string[] };
  const base = createLogger({ quiet: true });
  return {
    options: { cwd: dir, autoSync: true } as ResolvedDevOptions,
    context: {
      logger: {
        ...base,
        warn: (message: string) => said.warn.push(message),
        error: (message: string) => said.error.push(message),
      },
      options: {},
      cwd: dir,
    } as unknown as CommandContext,
    said,
  };
}

/**
 * `runDbSync` for `config`: whether it failed, by an exit or by rejecting to the command's
 * top-level handler, and everything it said, with the failure as that handler prints it.
 */
async function dbSync(config: LoadConfigResult["config"]) {
  loaded.config = config;
  const { options, context, said } = command();
  const exit = vi.spyOn(process, "exit").mockImplementation(code => {
    throw new Error(`exit ${String(code)}`);
  });
  try {
    await runDbSync(options, context);
    return { failed: false, said: said.error.join(" ") };
  } catch (error) {
    return {
      failed: true,
      said: [...said.error, describeError(error)].join(" "),
    };
  } finally {
    exit.mockRestore();
  }
}

/**
 * One re-sync of the `--watch` loop for `config`. The watcher reports nothing when it finishes, so
 * this waits for its last step, permission seeding, or for an error, and then for the claim the
 * re-sync holds to be released.
 */
async function watchedResync(config: LoadConfigResult["config"]) {
  const { options, context, said } = command();
  let finished!: () => void;
  const done = new Promise<void>(resolve => {
    finished = resolve;
  });
  const logger = {
    ...context.logger,
    error: (message: string) => {
      said.error.push(message);
      finished();
    },
    success: (message: string) => {
      if (message.startsWith("Permissions:")) finished();
    },
  };
  const cli = await createCliAdapter();
  installRegistryResolver(cli as unknown as DrizzleAdapter);
  try {
    const result: LoadConfigResult = {
      config,
      appConfig: config,
      projectRoot: process.cwd(),
      dependencies: [],
      pluginConsent: NO_PLUGIN_CONSENT,
    };
    createDebouncedSync(cli, options, { ...context, logger })(result);
    await done;
    await new Promise(resolve => setTimeout(resolve, 500));
  } finally {
    await cli.disconnect();
  }
  return said;
}

/** A column of another kind on the translations table, as an earlier field could leave it. */
async function leaveIntegerColumn(): Promise<void> {
  const adapter = await createAdapter({
    type: "sqlite",
    url: `file:${join(dir, "test.db")}`,
  } as Parameters<typeof createAdapter>[0]);
  try {
    await adapter.executeQuery(
      `ALTER TABLE "${COMPANION}" ADD COLUMN "code" INTEGER`
    );
  } finally {
    await adapter.disconnect();
  }
}

async function codeColumnType(): Promise<string | undefined> {
  const adapter = await createAdapter({
    type: "sqlite",
    url: `file:${join(dir, "test.db")}`,
  } as Parameters<typeof createAdapter>[0]);
  try {
    const rows = (await adapter.executeQuery(
      `PRAGMA table_info("${COMPANION}")`
    )) as Array<{ name: string; type: string }>;
    return rows.find(row => row.name === "code")?.type;
  } finally {
    await adapter.disconnect();
  }
}

async function mainHasCode(): Promise<boolean> {
  const adapter = await createAdapter({
    type: "sqlite",
    url: `file:${join(dir, "test.db")}`,
  } as Parameters<typeof createAdapter>[0]);
  try {
    const rows = (await adapter.executeQuery(
      `PRAGMA table_info("dc_${SLUG}")`
    )) as Array<{ name: string }>;
    return rows.some(row => row.name === "code");
  } finally {
    await adapter.disconnect();
  }
}

const CANNOT_HOLD =
  /column \\?"code\\?" \((?:INTEGER|integer)\) that cannot hold every value code allows/;

describe("a field newly translated over a leftover translations column", () => {
  it("db:sync refuses one it adds as translated, judged against the registry from before its syncs", async () => {
    expect((await dbSync(configWith("absent"))).failed).toBe(false);
    await leaveIntegerColumn();

    const { failed, said } = await dbSync(configWith("translated"));

    expect(failed).toBe(true);
    expect(said).toMatch(CANNOT_HOLD);
    expect(await codeColumnType()).toBe("INTEGER");
  });

  it("db:sync --watch refuses one it adds as translated, judged against the registry from before its syncs", async () => {
    expect((await dbSync(configWith("absent"))).failed).toBe(false);
    await leaveIntegerColumn();

    const said = await watchedResync(configWith("translated"));

    expect(said.error.join(" ")).toMatch(CANNOT_HOLD);
    expect(await codeColumnType()).toBe("INTEGER");
  });

  it("db:sync refuses a shared field it now translates, keeping the field's shared column", async () => {
    expect((await dbSync(configWith("shared"))).failed).toBe(false);
    await leaveIntegerColumn();

    const { failed, said } = await dbSync(configWith("translated"));

    expect(failed).toBe(true);
    expect(said).toMatch(CANNOT_HOLD);
    expect(await codeColumnType()).toBe("INTEGER");
    // A code-first table keeps a translated field's column on the main table too, so the shared
    // values are still where they were.
    expect(await mainHasCode()).toBe(true);
  });
});
