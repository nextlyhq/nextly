/**
 * The Windows job in `ci.yml` runs the gates `.husky/pre-push` runs, no more
 * and no fewer.
 *
 * The hook skips itself in CI, so the job lists the hook's gates on its own. A
 * gate added to one and not the other would leave a Windows-only failure in it
 * unreported, or report one the hook never meets.
 *
 * A gate is read as a line that runs `pnpm`, after any environment assignments
 * or a leading `if !`, and is named by what it runs: the script for
 * `pnpm <script>` and `pnpm run <script>`, the task for `pnpm turbo <task>`.
 * Its options are not compared, since the hook narrows `turbo test` to what a
 * push affects and the job runs every workspace. A gate written another way,
 * such as `node scripts/…`, is not read, so give a new gate a `pnpm` script.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/** Installing dependencies prepares the job; it is not a gate. */
const NOT_GATES = new Set(["install"]);

const PNPM_LINE = /^\s*(?:if\s+!\s+)?(?:[A-Z_]+=\S+\s+)*pnpm\s+(.+)$/;

/** The gates the lines of a script run, by name. */
export function gatesIn(text) {
  const gates = new Set();
  for (const line of text.split("\n")) {
    const match = PNPM_LINE.exec(line);
    if (!match) continue;
    const [first, second] = match[1].trim().split(/\s+/);
    const name = first === "turbo" ? `turbo ${second}` : first === "run" ? second : first;
    if (!NOT_GATES.has(name)) gates.add(name);
  }
  return gates;
}

const hookGates = gatesIn(readFileSync(join(root, ".husky", "pre-push"), "utf8"));
const windowsJob = load(readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf8")).jobs["windows-gates"];
const jobGates = gatesIn(windowsJob.steps.map(step => step.run ?? "").join("\n"));

describe("the Windows job and the pre-push hook", () => {
  it("reads the gates the hook runs, so an empty match cannot pass", () => {
    for (const gate of ["lint:design", "build", "turbo check-types", "turbo test"]) {
      expect(hookGates).toContain(gate);
    }
  });

  it("run the same gates", () => {
    expect([...jobGates].sort()).toEqual([...hookGates].sort());
  });

  it("name a gate by what it runs, not by its options", () => {
    expect(
      gatesIn(
        [
          "pnpm lint:design",
          "pnpm run build",
          "pnpm turbo lint --continue \\",
          "  pnpm turbo test --continue $GATE_FILTERS -- --maxWorkers=2",
          "  if ! TURBO_SCM_BASE=origin/main pnpm turbo check-types --affected; then",
          "pnpm install --frozen-lockfile",
          "# pnpm lint:not-a-gate is a comment",
        ].join("\n")
      )
    ).toEqual(new Set(["lint:design", "build", "turbo lint", "turbo test", "turbo check-types"]));
  });
});
