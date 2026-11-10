/**
 * The copies of the integration branch that cannot import
 * `integration-branch.mjs`, held to it: a hook, a root script, the Claude Code
 * environment and the changesets config each name the base as text, and one
 * left on `main` compares every branch with the wrong commit in silence.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { INTEGRATION_BASE, INTEGRATION_BRANCH } from "./integration-branch.mjs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("the integration branch", () => {
  it("is the remote-tracking ref of the branch it names", () => {
    expect(INTEGRATION_BASE).toBe(`origin/${INTEGRATION_BRANCH}`);
  });

  it("is the base the pre-push typecheck compares with", () => {
    const hook = read(".husky/pre-push");
    const bases = [...hook.matchAll(/TURBO_SCM_BASE=(\S+)/g)].map(match => match[1]);
    expect(bases.length, "TURBO_SCM_BASE assignments in the hook").toBeGreaterThan(0);
    for (const base of bases) expect(base).toBe(INTEGRATION_BASE);
  });

  it("is the base of the root fallow audit and of the Claude Code sessions' audit", () => {
    const { scripts } = JSON.parse(read("package.json"));
    expect(scripts["fallow:audit"]).toBe(`fallow audit --base ${INTEGRATION_BASE}`);
    expect(JSON.parse(read(".claude/settings.json")).env.FALLOW_AUDIT_BASE).toBe(INTEGRATION_BASE);
  });

  it("is what `changeset status` and `changeset add` compare a branch with", () => {
    expect(JSON.parse(read(".changeset/config.json")).baseBranch).toBe(INTEGRATION_BRANCH);
  });
});
