import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);

/*
 * The command as a contributor starts it, on a Node that strips no types.
 *
 * `engines` allows Node 22.12, which runs no TypeScript without a flag, so
 * every module the command loads must be JavaScript. Node 24 strips types by
 * default and would hide a `.ts` import; turning that off here reproduces the
 * older Node on whichever one runs the tests. Vitest transforms TypeScript
 * itself, so only a separate process can see this.
 */
describe("the visual check's entry, on a Node without type stripping", () => {
  it("loads and prints its usage", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--no-experimental-strip-types",
        "scripts/visual-check/run.mjs",
        "--help",
      ],
      { cwd: ROOT, encoding: "utf8" }
    );
    expect(result.stderr).not.toMatch(/ERR_UNKNOWN_FILE_EXTENSION|\.ts/);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^Usage: pnpm visual-check/m);
  });
});
