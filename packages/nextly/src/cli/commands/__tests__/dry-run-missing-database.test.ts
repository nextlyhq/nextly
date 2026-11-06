/**
 * A dry run of a command that reads the database opens it read-only: where
 * the SQLite file `DATABASE_URL` names is not there, the dry run names that as
 * the real run's refusal and exits 0, and neither the file nor its folder is
 * made. Run as a shell runs it, through the CLI's own entry point.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { folderSnapshot } from "../../__tests__/helpers/folder-snapshot";
import {
  NEXTLY_RUN_TIMEOUT,
  runNextly,
} from "../../__tests__/helpers/run-nextly";

const projects: string[] = [];
afterEach(() => {
  for (const dir of projects.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("a dry run against a SQLite file that is not there", () => {
  it.each([
    ["migrate"],
    ["migrate:down"],
    ["migrate:baseline"],
    ["webhooks:prune"],
  ])(
    "%s --dry-run names it and makes nothing",
    async command => {
      const project = mkdtempSync(join(tmpdir(), "nextly-dry-missing-db-"));
      projects.push(project);
      writeFileSync(join(project, "nextly.config.ts"), "export default {};\n");
      const before = folderSnapshot(project);

      const run = await runNextly([command, "--dry-run"], project, {
        DB_DIALECT: "sqlite",
        DATABASE_URL: `file:${join(project, "data/app.db")}`,
      });

      expect(run.status, run.stdout + run.stderr).toBe(0);
      expect(run.stdout).toContain(
        "A real run would refuse: The database does not exist"
      );
      expect(existsSync(join(project, "data"))).toBe(false);
      expect(folderSnapshot(project)).toEqual(before);
    },
    NEXTLY_RUN_TIMEOUT
  );

  it(
    "build --dry-run checks no migrations against it and makes nothing",
    async () => {
      const project = mkdtempSync(join(tmpdir(), "nextly-dry-missing-db-"));
      projects.push(project);
      // A collection, so the build reaches its migration check.
      writeFileSync(
        join(project, "nextly.config.ts"),
        'export default { collections: [{ slug: "posts", fields: [{ name: "title", type: "text" }] }] };\n'
      );
      const before = folderSnapshot(project);

      const run = await runNextly(["build", "--dry-run"], project, {
        DB_DIALECT: "sqlite",
        DATABASE_URL: `file:${join(project, "data/app.db")}`,
      });

      expect(run.status, run.stdout + run.stderr).toBe(0);
      expect(run.stdout).toContain("Dry run: nothing was changed.");
      expect(existsSync(join(project, "data"))).toBe(false);
      expect(folderSnapshot(project)).toEqual(before);
    },
    NEXTLY_RUN_TIMEOUT
  );

  it(
    "migrate:fresh --dry-run plans as for an empty database, which a real run makes, and makes nothing",
    async () => {
      const project = mkdtempSync(join(tmpdir(), "nextly-dry-missing-db-"));
      projects.push(project);
      writeFileSync(join(project, "nextly.config.ts"), "export default {};\n");
      const before = folderSnapshot(project);

      const run = await runNextly(["migrate:fresh", "--dry-run"], project, {
        DB_DIALECT: "sqlite",
        DATABASE_URL: `file:${join(project, "data/app.db")}`,
      });

      expect(run.status, run.stdout + run.stderr).toBe(0);
      expect(run.stdout).not.toContain("A real run would refuse");
      expect(run.stdout).toContain("Would run the core tables' setup");
      expect(existsSync(join(project, "data"))).toBe(false);
      expect(folderSnapshot(project)).toEqual(before);
    },
    NEXTLY_RUN_TIMEOUT
  );
});
