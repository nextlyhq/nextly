/**
 * Whether a site keeps migration files: one written migration with its snapshot is in its folder.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, it } from "vitest";

import { keepsMigrationFiles } from "../snapshot-io";

let cwd: string;
const site = { migrationsDir: "./migrations" };

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "nextly-keeps-migrations-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

/** A file of the migrations folder, its folders made. */
function file(...path: string[]): void {
  const at = join(cwd, "migrations", ...path);
  mkdirSync(join(at, ".."), { recursive: true });
  // What it holds is not read: a file an earlier release wrote counts as any other.
  writeFileSync(at, "{}", "utf8");
}

it("is no where the folder is missing or empty", async () => {
  expect(await keepsMigrationFiles({ cwd, ...site })).toBe(false);
  mkdirSync(join(cwd, "migrations", "meta"), { recursive: true });
  expect(await keepsMigrationFiles({ cwd, ...site })).toBe(false);
});

it("is no where it holds SQL and no snapshot, which records no table", async () => {
  file("20261125_120000_000_by_hand.sql");
  expect(await keepsMigrationFiles({ cwd, ...site })).toBe(false);
});

it("is no for a snapshot whose migration is not there", async () => {
  file("meta", "20261125_120000_000_left.snapshot.json");
  expect(await keepsMigrationFiles({ cwd, ...site })).toBe(false);
});

it("is yes with one migration and its snapshot, a baseline's alone included", async () => {
  file("20261125_120000_000_baseline.sql");
  file("meta", "20261125_120000_000_baseline.snapshot.json");
  expect(await keepsMigrationFiles({ cwd, ...site })).toBe(true);
});

it("looks in the folder the site names", async () => {
  file("20261125_120000_000_baseline.sql");
  file("meta", "20261125_120000_000_baseline.snapshot.json");
  expect(await keepsMigrationFiles({ cwd, migrationsDir: "./other" })).toBe(
    false
  );
});
