/**
 * `nextly upgrade --dry-run`, run as the command runs, over an installation from before the
 * localisation model: it prints what will move, what conflicts and what an editor should check,
 * under their headings, and with `--json` the same plan as one document; and it writes nothing,
 * every table holding as many rows afterwards as before.
 *
 * The plausible broken commands: one that prints the counts alone, and a dry run that writes.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { Command } from "commander";
import { sql } from "drizzle-orm";
import { afterEach, expect, it, vi } from "vitest";

import { createAdapter } from "../../../database/factory";
import {
  bootSite,
  seedLegacyStates,
  type UpgradeDatabase,
} from "../../../domains/i18n/__tests__/helpers/localisation-upgrade-fixture";
import { _resetPerLanguageStorage } from "../../../domains/i18n/per-language-storage";
import { _resetEnvCache } from "../../../shared/lib/env";
import { upgradeAction } from "../upgrade";

let dir: string | undefined;
let database: UpgradeDatabase | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  await database?.close();
  database = undefined;
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
  _resetPerLanguageStorage();
  vi.unstubAllEnvs();
});

/** The rows of the tables the upgrade would change, by table. */
async function rowCounts(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of [
    "dc_articles",
    "dc_articles_locales",
    "dc_notes",
    "single_footer",
    "nextly_versions",
  ]) {
    const [row] = await database!.adapter.queryStatement<{ n: unknown }>(
      sql`SELECT COUNT(*) AS ${sql.identifier("n")} FROM ${sql.identifier(table)}`
    );
    counts[table] = Number(row?.n ?? 0);
  }
  return counts;
}

/** Run `nextly upgrade` with `flags` from `cwd`, and what it printed. */
async function upgradeCommand(
  flags: { dryRun: true; json?: boolean },
  cwd: string
): Promise<string[]> {
  const printed: string[] = [];
  const log = vi
    .spyOn(console, "log")
    .mockImplementation((...parts: unknown[]) => {
      printed.push(stripVTControlCharacters(parts.map(String).join(" ")));
    });
  const program = new Command().option("--cwd <dir>").option("--no-color");
  program.setOptionValue("cwd", cwd);
  const command = program.command("upgrade");
  await upgradeAction({ ...flags, confirmBackedUp: true }, command);
  log.mockRestore();
  return printed;
}

it("prints what moves, what conflicts and what to check, as lines and as JSON, and writes nothing", async () => {
  dir = await mkdtemp(join(tmpdir(), "nextly-upgrade-dry-run-"));
  const url = `file:${join(dir, "site.db")}`;
  vi.stubEnv("DB_DIALECT", "sqlite");
  vi.stubEnv("DATABASE_URL", url);
  _resetEnvCache();
  const adapter = (await createAdapter({
    type: "sqlite",
    url,
  } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
  database = { dialect: "sqlite", adapter, close: () => adapter.disconnect() };
  const t = await bootSite(database, "legacy");
  await seedLegacyStates(t, database);
  const before = await rowCounts();

  const lines = await upgradeCommand({ dryRun: true }, dir);
  const text = lines.join("\n");
  expect(text).toMatch(/Would move:/);
  expect(text).toMatch(/notes[^\n]*title[^\n]*per-language table/);
  expect(text).toMatch(/Conflicts, and how a real run settles them:/);
  expect(text).toMatch(/articles[^\n]*code changed in es and fr/);
  expect(text).toMatch(/An editor should check:/);
  expect(text).toMatch(/Dry run: nothing was changed\./);

  const json = await upgradeCommand({ dryRun: true, json: true }, dir);
  const plan = JSON.parse(json.join("\n")) as {
    report: { move: string[]; conflicts: string[]; check: string[] };
  };
  expect(plan.report.move.length).toBeGreaterThan(0);
  expect(plan.report.conflicts).toEqual([
    expect.stringMatching(/articles[\s\S]*code changed in es and fr/),
  ]);

  expect(await rowCounts()).toEqual(before);
});
