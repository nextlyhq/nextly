/**
 * `nextly generate:types --dry-run`, `nextly generate:manifest --dry-run` and
 * `nextly build --dry-run` change nothing in the project folder, run as a
 * shell runs them.
 *
 * Each command is the CLI's own entry point in a process of its own, so the
 * project's `nextly.config.ts` is bundled and loaded as only a real process
 * does it. The folder is compared file by file before and after the dry run;
 * the same project is then run without the flag, and that run does change the
 * folder, which shows the fixture reaches the writes the dry run skips.
 *
 * No database: the generate commands open none, and the build is given
 * `--skip-migrations-check`, its one read of a database.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { folderSnapshot } from "../../__tests__/helpers/folder-snapshot";
import {
  NEXTLY_RUN_TIMEOUT,
  runNextly,
} from "../../__tests__/helpers/run-nextly";

/** A config with one collection and, when `blocks`, a plugin declaring one block. */
const config = (blocks: boolean) => `
const pageBuilder = {
  name: "@nextlyhq/plugin-page-builder",
  version: "1.0.0",
  nextly: "*",
};
const acmeBlocks = {
  name: "@acme/blocks",
  version: "1.0.0",
  nextly: "*",
  contributes: {
    declarations: {
      "@nextlyhq/plugin-page-builder": {
        blocks: [
          {
            name: "acme/hero",
            version: 1,
            description: "The hero block.",
            example: { props: {} },
            render: () => null,
          },
        ],
      },
    },
  },
};
export default {
  collections: [{ slug: "posts", fields: [{ name: "title", type: "text" }] }],
  plugins: ${blocks ? "[pageBuilder, acmeBlocks]" : "[pageBuilder]"},
  typescript: { outputFile: "./src/types/nextly-types.ts" },
};
`;

const MANIFEST = "src/types/blocks.manifest.json";
const DRY_RUN_DONE = "Dry run: nothing was changed.";

const projects: string[] = [];

afterEach(() => {
  for (const dir of projects.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A project folder holding `nextly.config.ts`, and `files` beside it. */
function project(blocks: boolean, files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "nextly-generate-dry-run-"));
  projects.push(dir);
  writeFileSync(join(dir, "nextly.config.ts"), config(blocks));
  mkdirSync(join(dir, "src/app"), { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

/** Runs `args` with and without `--dry-run`, answering both runs and the folder at each step. */
async function dryThenReal(dir: string, args: string[]) {
  const before = folderSnapshot(dir);
  const dry = await runNextly([...args, "--dry-run"], dir);
  const afterDry = folderSnapshot(dir);
  const real = await runNextly(args, dir);
  return { before, dry, afterDry, real, afterReal: folderSnapshot(dir) };
}

describe("a dry run of a generating command changes nothing", () => {
  it(
    "generate:types",
    async () => {
      const dir = project(true);

      const run = await dryThenReal(dir, ["generate:types"]);

      expect(run.dry.status, run.dry.stderr).toBe(0);
      expect(run.dry.stdout).toContain("Would write src/types/nextly-types.ts");
      expect(run.dry.stdout).toContain(DRY_RUN_DONE);
      expect(run.afterDry).toEqual(run.before);
      expect(run.real.status, run.real.stderr).toBe(0);
      expect(run.afterReal["src/types/nextly-types.ts"]).toBeDefined();
      expect(run.afterReal[MANIFEST]).toBeDefined();
    },
    NEXTLY_RUN_TIMEOUT * 2
  );

  it(
    "generate:manifest, writing the manifest",
    async () => {
      const dir = project(true);

      const run = await dryThenReal(dir, ["generate:manifest"]);

      expect(run.dry.status, run.dry.stderr).toBe(0);
      expect(run.dry.stdout).toContain(`Would write ${MANIFEST}`);
      expect(run.dry.stdout).toContain(DRY_RUN_DONE);
      expect(run.afterDry).toEqual(run.before);
      expect(run.real.status, run.real.stderr).toBe(0);
      expect(run.afterReal[MANIFEST]).toBeDefined();
    },
    NEXTLY_RUN_TIMEOUT * 2
  );

  it(
    "build",
    async () => {
      const dir = project(false);

      const run = await dryThenReal(dir, ["build", "--skip-migrations-check"]);

      expect(run.dry.status, run.dry.stderr).toBe(0);
      expect(run.dry.stdout).toContain("Would write src/types/nextly-types.ts");
      expect(run.dry.stdout).toContain(DRY_RUN_DONE);
      expect(run.afterDry).toEqual(run.before);
      expect(run.real.status, run.real.stderr).toBe(0);
      expect(run.afterReal["src/types/nextly-types.ts"]).toBeDefined();
    },
    NEXTLY_RUN_TIMEOUT * 2
  );

  it(
    "generate:manifest, removing a stale manifest",
    async () => {
      const dir = project(false, { [MANIFEST]: "{}\n" });

      const run = await dryThenReal(dir, ["generate:manifest"]);

      expect(run.dry.status, run.dry.stderr).toBe(0);
      expect(run.dry.stdout).toContain(`Would remove ${MANIFEST}`);
      expect(run.dry.stdout).toContain(DRY_RUN_DONE);
      expect(run.afterDry).toEqual(run.before);
      expect(run.real.status, run.real.stderr).toBe(0);
      expect(run.afterReal[MANIFEST]).toBeUndefined();
    },
    NEXTLY_RUN_TIMEOUT * 2
  );
});
