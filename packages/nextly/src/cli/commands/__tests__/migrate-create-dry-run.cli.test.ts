/**
 * `nextly migrate:create --dry-run`, run as a shell runs it, changes nothing in the project folder
 * and exits 0, and the same project without `--dry-run` gains the migration, so the fixture
 * reaches the writes the dry run skips.
 *
 * The database is a SQLite file inside the project: a run that connected would create it, so the
 * unchanged folder also shows this mode stays offline.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { folderSnapshot } from "../../__tests__/helpers/folder-snapshot";
import {
  NEXTLY_RUN_TIMEOUT,
  runNextly,
} from "../../__tests__/helpers/run-nextly";

const CONFIG = `
export default {
  collections: [{ slug: "mcd_posts", fields: [{ name: "title", type: "text" }] }],
  db: { migrationsDir: "./migrations" },
};
`;

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "nextly-create-dry-run-cli-"));
  writeFileSync(join(project, "nextly.config.ts"), CONFIG);
});

afterEach(() => {
  rmSync(project, { recursive: true, force: true });
});

const nextly = (args: string[]) =>
  runNextly(args, project, {
    DB_DIALECT: "sqlite",
    DATABASE_URL: `file:${join(project, "app.db")}`,
  });

describe("nextly migrate:create --dry-run", () => {
  it(
    "changes nothing in the project, where the real run writes the migration",
    async () => {
      const before = folderSnapshot(project);
      const dry = await nextly(["migrate:create", "init", "--dry-run"]);
      expect(dry.status, dry.stdout + dry.stderr).toBe(0);
      expect(dry.stdout).toContain("Dry run: nothing was changed.");
      expect(folderSnapshot(project)).toEqual(before);

      const real = await nextly(["migrate:create", "init"]);
      expect(real.status, real.stdout + real.stderr).toBe(0);
      const added = Object.keys(folderSnapshot(project)).filter(
        path => !(path in before)
      );
      // The migration and its snapshot, each named as the dry run named its own.
      expect(added).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^migrations\/\d{8}_\d{6}_\d{3}_init\.sql$/),
          expect.stringMatching(
            /^migrations\/meta\/\d{8}_\d{6}_\d{3}_init\.snapshot\.json$/
          ),
        ])
      );
      const named = (output: string) =>
        [...output.matchAll(/Would write (\S+)/g)].map(m =>
          m[1].replace(/\d{8}_\d{6}_\d{3}/, "<ts>")
        );
      expect(named(dry.stdout).sort()).toEqual(
        added
          .filter(path => /\.(sql|json)$/.test(path))
          .map(path => path.replace(/\d{8}_\d{6}_\d{3}/, "<ts>"))
          .sort()
      );
    },
    3 * NEXTLY_RUN_TIMEOUT
  );
});
