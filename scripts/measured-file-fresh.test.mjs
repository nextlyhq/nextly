import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * AGENTS.measured.md is generated, and a generated file with no consumer
 * silently rots: the workspace gains a package, the enforced scope list
 * moves, and the committed copy keeps describing the old repository with a
 * banner that says it can be trusted. This regenerates the three
 * rows that are cheap AND deterministic — packages, pr-scopes, engines —
 * and holds the committed copy to matching them, so any change to what they
 * measure forces a regeneration in the same change. Heavy rows are excluded
 * because their values depend on build state, which a unit test neither
 * controls nor should; the comment-convention row is excluded because its
 * count moves with any file added anywhere, and each row carries the
 * revision it was read at, so an aged count is visibly old rather than
 * silently wrong.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STABLE_ROWS = ["packages", "pr-scopes", "engines"];

function section(text, id) {
  const fence = String.fromCharCode(96, 96, 96);
  // Comparison starts after the command line: it carries a per-run revision
  // stamp, which legitimately differs between the committed file and a fresh
  // regeneration on a dirty tree.
  const m = text.match(new RegExp("## " + id + "\\n[\\s\\S]*?\\n" + fence + "\\n\\$[^\\n]*\\n([\\s\\S]*?)\\n" + fence));
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
