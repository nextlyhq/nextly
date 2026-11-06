/**
 * `nextly init --dry-run`, run as a shell runs it, leaves the project folder
 * exactly as it was and ends with exit 0. The same run without the flag
 * changes the folder, so the project is one init really writes to.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { folderSnapshot } from "../../__tests__/helpers/folder-snapshot";
import {
  NEXTLY_RUN_TIMEOUT,
  runNextly,
} from "../../__tests__/helpers/run-nextly";

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("nextly init --dry-run", () => {
  it(
    "changes nothing in the project folder",
    async () => {
      const cwd = mkdtempSync(join(tmpdir(), "nextly-init-unchanged-"));
      made.push(cwd);
      mkdirSync(join(cwd, "app"));
      const before = folderSnapshot(cwd);

      const dry = await runNextly(["init", "--yes", "--dry-run"], cwd);
      expect(dry.status, dry.stderr).toBe(0);
      expect(dry.stdout).toContain("Would write nextly.config.ts");
      expect(dry.stdout).toContain("Dry run: nothing was changed.");
      expect(folderSnapshot(cwd)).toEqual(before);

      const real = await runNextly(["init", "--yes"], cwd);
      expect(real.status, real.stderr).toBe(0);
      expect(folderSnapshot(cwd)).not.toEqual(before);
    },
    NEXTLY_RUN_TIMEOUT * 2
  );
});
