// `nextly migrate` judges a field its files newly translate against the registry as it was before
// any file applied, driving `migrate:create` and `migrate` themselves against a SQLite file.
//
// After the files, the companion pass takes a translations column already there as the field's
// own. For a field the run newly translates, that column may be another field's leftover, and one
// that cannot hold the field is refused, failing the command. Whether the field is new is read from
// the registry, which the run rewrites from the config after its files: read at the start, the
// field is new and the run is refused; read later, it looks translated already and is only warned
// about; not read, the leftover is taken silently.

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineCollection, defineConfig } from "../../../config";
import { createAdapter } from "../../../database/factory";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { CommandContext } from "../../program";
import { createLogger } from "../../utils/logger";
import { runMigrate } from "../migrate";
import { runMigrateCreate } from "../migrate-create";

const loaded = vi.hoisted(() => ({
  config: undefined as unknown,
}));
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

let dir: string;
let instance: TestNextly | undefined;
let previousDialect: string | undefined;
let previousUrl: string | undefined;
let clock = 0;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "nextly-migrate-before-"));
  mkdirSync(join(dir, "migrations"));
  previousDialect = process.env.DB_DIALECT;
  previousUrl = process.env.DATABASE_URL;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(Date.UTC(2026, 9, 29, 12, 0, 0, 0)));
  const url = `file:${join(dir, "test.db")}`;
  process.env.DB_DIALECT = "sqlite";
  process.env.DATABASE_URL = url;
  _resetEnvCache();
  const adapter = await createAdapter({ type: "sqlite", url } as Parameters<
    typeof createAdapter
  >[0]);
  instance = await createTestNextly({ adapter });
});

afterEach(async () => {
  vi.useRealTimers();
  await instance?.destroy();
  instance = undefined;
  if (previousDialect === undefined) delete process.env.DB_DIALECT;
  else process.env.DB_DIALECT = previousDialect;
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
  _resetEnvCache();
  rmSync(dir, { recursive: true, force: true });
});

const SLUG = "mgbefore";
const COMPANION = `dc_${SLUG}_locales`;

const configWith = (withCode: boolean) =>
  defineConfig({
    localization: { locales: ["en", "es"], defaultLocale: "en" },
    db: { migrationsDir: "./migrations" },
    collections: [
      defineCollection({
        slug: SLUG,
        localized: true,
        fields: [
          { name: "title", type: "text", localized: true },
          ...(withCode
            ? [{ name: "code", type: "text", localized: true }]
            : []),
        ] as never,
      }),
    ],
  });

function command(): { context: CommandContext; said: string[] } {
  const said: string[] = [];
  const base = createLogger({ quiet: true });
  const capture = (message: string) => {
    said.push(message);
  };
  return {
    context: {
      logger: {
        ...base,
        info: capture,
        warn: capture,
        success: capture,
        error: capture,
      },
      options: {},
      cwd: dir,
    } as CommandContext,
    said,
  };
}

async function exiting(fn: () => Promise<void>): Promise<number | undefined> {
  const exit = vi.spyOn(process, "exit").mockImplementation(code => {
    throw new Error(`exit ${String(code)}`);
  });
  try {
    await fn();
    return undefined;
  } catch (error) {
    const match = /^exit (\d+)$/.exec((error as Error).message);
    if (match) return Number(match[1]);
    throw error;
  } finally {
    exit.mockRestore();
  }
}

async function migrateCreate(config: unknown, name: string): Promise<void> {
  loaded.config = config;
  clock += 1;
  vi.setSystemTime(new Date(Date.UTC(2026, 9, 29, 12, 0, 0, clock)));
  const { context, said } = command();
  const code = await exiting(() =>
    runMigrateCreate(name, { cwd: dir, nonInteractive: true }, context)
  );
  expect(code, said.join("\n")).toBeUndefined();
}

async function migrate(config: unknown) {
  loaded.config = config;
  const { context, said } = command();
  const code = await exiting(() => runMigrate({ cwd: dir }, context));
  return { code, said };
}

async function codeColumnType(): Promise<string | undefined> {
  const rows = (await instance?.adapter.executeQuery(
    `PRAGMA table_info("${COMPANION}")`
  )) as Array<{ name: string; type: string }>;
  return rows.find(row => row.name === "code")?.type;
}

describe("nextly migrate over a leftover translations column", () => {
  it("refuses a field its files newly translate, judged against the registry from before the files", async () => {
    await migrateCreate(configWith(false), "posts");
    const first = await migrate(configWith(false));
    expect(first.code, first.said.join("\n")).toBeUndefined();
    await instance?.adapter.executeQuery(
      `ALTER TABLE "${COMPANION}" ADD COLUMN "code" INTEGER`
    );

    await migrateCreate(configWith(true), "code");
    const second = await migrate(configWith(true));

    expect(second.code).toBe(1);
    expect(second.said.join(" ")).toMatch(
      /column \\?"code\\?" \((?:INTEGER|integer)\) that cannot hold every value code allows/
    );
    expect(await codeColumnType()).toBe("INTEGER");
  });
});
