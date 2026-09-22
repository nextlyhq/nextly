/**
 * What separates a command claim from a sentence that mentions pnpm.
 *
 * The cases below are the measured ones. Reading the raw text of `AGENTS.md`
 * rather than its code spans reported `pnpm settings`, `pnpm reads` and
 * `pnpm a` from three ordinary English sentences, and resolving every path
 * against the repository root reported fourteen files that exist perfectly well
 * beside the nested `AGENTS.md` that cites them. Both are false positives on
 * correct prose, which `derived-checks.md` calls the failure that gets an
 * advisory check deleted.
 */
import { describe, expect, it } from "vitest";

import {
  ANCHORS,
  claimsRepoRoot,
  codeSpans,
  missingAnchors,
  pathsIn,
  pnpmScriptsIn,
} from "./check-agent-contract.mjs";

const names = text => pnpmScriptsIn(text).map(entry => entry.name);

describe("reading claims out of a document", () => {
  it("reads an inline code span", () => {
    expect(codeSpans("run `pnpm build` first")).toEqual(["pnpm build"]);
  });

  it("reads a fenced block and drops its fences", () => {
    expect(codeSpans("before\n```sh\npnpm lint\n```\nafter")).toEqual(["pnpm lint"]);
  });

  it("reads nothing out of unformatted prose", () => {
    expect(codeSpans("pnpm settings live elsewhere")).toEqual([]);
  });
});

describe("naming the script a pnpm invocation runs", () => {
  it("finds a plain script", () => {
    expect(names("`pnpm check-types`")).toEqual(["check-types"]);
  });

  it("steps over a filter and reports the workspace it named", () => {
    expect(pnpmScriptsIn("`pnpm --filter playground nextly generate:types`")).toEqual([
      { filter: "playground", name: "nextly" },
    ]);
  });

  it("strips the dependents selector from a filter", () => {
    expect(pnpmScriptsIn("`pnpm --filter nextly... build`")).toEqual([
      { filter: "nextly", name: "build" },
    ]);
  });

  it("steps over an explicit run", () => {
    expect(names("`pnpm run lint`")).toEqual(["lint"]);
  });

  it("ignores pnpm's own verbs", () => {
    expect(names("`pnpm install --frozen-lockfile`")).toEqual([]);
  });

  /*
   * The positive control this module exists for. These three strings are
   * verbatim from `AGENTS.md` and each produced a finding before code spans
   * were the unit read. A check that stopped reading prose correctly would
   * report them again.
   */
  it.each([
    "- pnpm settings live in `pnpm-workspace.yaml`, not `.npmrc`",
    "  block in `package.json` — pnpm reads only auth and registry settings from",
    "  agrees with it: under pnpm a root dependency, or one hoisted for another",
  ])("reports nothing for prose: %s", line => {
    expect(names(line)).toEqual([]);
  });

  it("still reports a command inside that same prose", () => {
    // The negative control's companion: silence has to be a property of prose,
    // not of the reader having stopped working.
    expect(names("pnpm settings live in `pnpm-workspace.yaml`; run `pnpm fresh`")).toEqual([
      "fresh",
    ]);
  });
});

describe("naming a file a document claims exists", () => {
  it("finds a backticked path", () => {
    expect([...pathsIn("see `scripts/verify-merge.mjs`")]).toEqual([
      "scripts/verify-merge.mjs",
    ]);
  });

  it("keeps a path carrying a line suffix", () => {
    expect([...pathsIn("`packages/ui/turbo.json:12`")]).toEqual(["packages/ui/turbo.json"]);
  });

  it.each(["`src/**/*.ts`", "`packages/<pkg>/index.ts`", "`https://x.dev/a.json`", "`/etc/hosts.yml`"])(
    "ignores what cannot name one file: %s",
    span => {
      expect([...pathsIn(span)]).toEqual([]);
    }
  );
});

describe("deciding whether an unresolved path was a claim", () => {
  const topLevel = new Set(["packages", "scripts", "docs"]);

  it("treats a repo-root path as a claim", () => {
    expect(claimsRepoRoot("packages/nextly/src/gone.ts", topLevel)).toBe(true);
  });

  it("treats a fragment as prose, because the prose supplies its prefix", () => {
    // `packages/nextly/AGENTS.md` writes `src/config.ts` for its own file.
    expect(claimsRepoRoot("src/config.ts", topLevel)).toBe(false);
  });
});

describe("refusing a file set that cannot have found anything", () => {
  /*
   * The population assertion. Zero findings from zero files is byte-identical
   * to zero findings from a clean repository, and a COUNT does not separate
   * them either — a collector that dropped AGENTS.md while picking up three
   * skills matches any total. Membership is what gets asserted.
   */
  it("names every anchor missing from an empty set", () => {
    expect(missingAnchors([])).toEqual(ANCHORS);
  });

  it("accepts a rule file as covering the rules anchor", () => {
    expect(missingAnchors(["AGENTS.md", ".claude/rules/x.md", ".claude/skills/y/SKILL.md"]))
      .toEqual([]);
  });

  it("still refuses when only one anchor is missing", () => {
    expect(missingAnchors([".claude/rules/x.md", ".claude/skills/y/SKILL.md"]))
      .toEqual(["AGENTS.md"]);
  });
});
