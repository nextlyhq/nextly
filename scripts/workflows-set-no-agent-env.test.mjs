/**
 * Next.js's upgrade reminder stays quiet in CI (`CI` is set) unless a coding
 * agent's environment variable is also set: then it ignores `CI`, and a build
 * that finds an advisory ends with exit 1. So no workflow or local action sets
 * one. The names are read from the detector Next.js itself bundles, so a name
 * it learns in a later release is checked here without an edit.
 */
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

const fromPlayground = createRequire(new URL("../apps/playground/package.json", import.meta.url));
const detector = readFileSync(join(dirname(fromPlayground.resolve("next/package.json")), "dist/compiled/@vercel/detect-agent/index.js"), "utf8");
const AGENT_VARIABLES = [...new Set([...detector.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)].map(([, name]) => name))];

const files = [
  ...readdirSync(new URL("../.github/workflows/", import.meta.url))
    .filter(name => /\.ya?ml$/.test(name))
    .map(name => `.github/workflows/${name}`),
  ...readdirSync(new URL("../.github/actions/", import.meta.url)).map(name => `.github/actions/${name}/action.yml`),
];

describe("the variables that tell Next.js a coding agent is building", () => {
  it("are read from Next.js's own detector", () => {
    expect(AGENT_VARIABLES).toEqual(expect.arrayContaining(["CLAUDECODE", "CODEX_CI", "CURSOR_AGENT", "AI_AGENT"]));
    expect(files.length).toBeGreaterThan(20);
  });

  it("are set by no workflow or local action, as an env key or in a script", () => {
    const set = files.flatMap(path => {
      const text = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
      return AGENT_VARIABLES.filter(name => new RegExp(`(^|[\\s"'{,])${name}\\s*[:=]`, "m").test(text)).map(name => `${path} ${name}`);
    });
    expect(set).toEqual([]);
  });
});
