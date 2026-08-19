import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * AGENTS.measured.md is generated, and a generated file with no consumer
 * silently rots: the workspace gains a package, the enforced scope list
 * moves, and the committed copy keeps describing the old repository with a
 * banner that says it can be trusted. This regenerates the cheap,
 * deterministic rows and holds the committed copy to matching them, so any
 * change to what they measure forces a regeneration in the same change.
 * Heavy rows are excluded: their values depend on build state, which a unit
 * test neither controls nor should.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STABLE_ROWS = ["packages", "pr-scopes", "engines"];

function section(text, id) {
  const m = text.match(new RegExp(`## ${id}\\n[\\s\\S]*?\\n\`\`\`\\n([\\s\\S]*?)\\n\`\`\``));
  expect(m, `row ${id} not found`).toBeTruthy();
  return m[1];
}

describe("AGENTS.measured.md matches a fresh regeneration of its stable rows", () => {
  it("packages, pr-scopes and engines are current", () => {
    const fresh = spawnSync(
      "node",
      ["scripts/measure-facts.mjs", `--only=${STABLE_ROWS.join(",")}`, "--stdout"],
      { cwd: repoRoot, encoding: "utf8" },
    );
    expect(fresh.status, fresh.stderr).toBe(0);
    const committed = readFileSync(resolve(repoRoot, "AGENTS.measured.md"), "utf8");
    for (const id of STABLE_ROWS) {
      expect(section(committed, id)).toEqual(section(fresh.stdout, id));
    }
  });
});
