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
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ANCHORS,
  CONTRIBUTING,
  EXTENSIONLESS_FILES,
  REVIEW_PROMPT,
  REQUIRED_RULES,
  claimsBareFile,
  claimsFilePath,
  instructionCopyFindings,
  guidanceReferences,
  ruleFindings,
  instructionFiles,
  unresolvedIn,
  claimsRepoRoot,
  codeSpans,
  missingAnchors,
  namesAWorkspace,
  pathsIn,
  gitIgnored,
  pnpmScriptsIn,
  rootInstructions,
  routedSkills,
  routerDisagreements,
  skillFindings,
  workspaceScripts,
} from "./check-agent-contract.mjs";
import { header } from "./agent-instructions.mjs";
import { syncSkillCopy } from "./agent-skills.mjs";

const CHECK = fileURLToPath(new URL("./check-agent-contract.mjs", import.meta.url));

const names = text => pnpmScriptsIn(text).map(entry => entry.name);

/** The required section with the forms it prescribes, as a fixture's AGENTS.md carries it. */
const WHOLE_FILE_SECTION = '## A whole-file write is a delete plus a create\n\nRefuse the write: `set -o noclobber`, or `{ flag: "wx" }`.\n';

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

  /*
   * The subcommand is REPORTED rather than dropped. `generate:types` belongs to
   * the nextly CLI, not to pnpm, so this module cannot decide whether it still
   * exists — listing a tool's own commands here would be a second copy of them.
   * Recording it is what stops the checker's silence reading as coverage of the
   * exact reference it was written to protect.
   */
  it("steps over a filter, reports the workspace, and records the subcommand", () => {
    expect(pnpmScriptsIn("`pnpm --filter playground nextly generate:types`")).toEqual([
      { filter: "playground", name: "nextly", subcommands: ["generate:types"] },
    ]);
  });

  it("records no subcommand when the invocation is just a script", () => {
    expect(pnpmScriptsIn("`pnpm check-types`")[0].subcommands).toEqual([]);
  });

  it("does not read a shell comment as a subcommand", () => {
    // `pnpm --filter <pkg>... build  # trailing ... includes <pkg> itself`
    expect(pnpmScriptsIn("`pnpm build # trailing words explain the flag`")[0].subcommands).toEqual([]);
  });

  it("strips the dependents selector from a filter", () => {
    expect(pnpmScriptsIn("`pnpm --filter nextly... build`")).toEqual([
      { filter: "nextly", name: "build", subcommands: [] },
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

  it("keeps an extensionless dotfile, which the extension allowlist discarded", () => {
    // AGENTS.md names `.nvmrc` twice. It reached no check at all, so renaming
    // it left this module green.
    expect([...pathsIn("pin the version in `.nvmrc`")]).toEqual([".nvmrc"]);
  });

  it.each(["`.wslconfig`", "`.nextly-admin`", "`.item`", "`.cause`"])(
    "ignores a dot-led token that names no repository file: %s",
    span => {
      // Each of these is real prose from the instruction files, and accepting
      // every single-dot token — the shape `.nvmrc` also has — reported all
      // four. A Windows file outside any repository, a directory prefix, a CSS
      // class and a property of `Error`.
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

  /*
   * 🔴 The rule above is right for a skill and wrong for a nested guide, and
   * the case that separates them is the DELETION — which the test above does
   * not reach, because `src/config.ts` resolving from the package is why it is
   * never asked about. Measured against the real repository: deleting
   * `packages/nextly/src/config.ts` left the check reporting OK.
   */
  const basenames = new Set(["ci.yml"]);

  it("reports a nested guide's relative path once its target is gone", () => {
    expect(claimsFilePath("src/config.ts", { topLevel, basenames, nestedGuide: true })).toBe(true);
  });

  it("still treats the same path in a skill as a fragment", () => {
    expect(claimsFilePath("src/config.ts", { topLevel, basenames, nestedGuide: false })).toBe(false);
  });

  it("reports a repo-root path from either source", () => {
    for (const nestedGuide of [true, false]) {
      expect(claimsFilePath("packages/nextly/src/gone.ts", { topLevel, basenames, nestedGuide }))
        .toBe(true);
    }
  });

  it("hands a bare name to the bare-name rule", () => {
    expect(claimsFilePath("ci.yml", { topLevel, basenames, nestedGuide: true })).toBe(false);
    expect(claimsFilePath("gone.yml", { topLevel, basenames, nestedGuide: true })).toBe(true);
  });
});

describe("refusing a file set that cannot have found anything", () => {
  /*
   * The population assertion. Zero findings from zero files is byte-identical
   * to zero findings from a clean repository, and a COUNT does not separate
   * them either — a collector that dropped AGENTS.md while picking up three
   * skills matches any total. Membership is what gets asserted.
   */
  const COMPLETE = ["AGENTS.md", ...REQUIRED_RULES, ".claude/rules/another-rule.md", ".agents/skills/y/SKILL.md", REVIEW_PROMPT, CONTRIBUTING];

  it("names every anchor missing from an empty set", () => {
    expect(missingAnchors([])).toEqual([...ANCHORS, ...REQUIRED_RULES]);
  });

  it("is satisfied by a complete set", () => {
    expect(missingAnchors(COMPLETE)).toEqual([]);
  });

  it("still refuses when only one anchor is missing", () => {
    expect(missingAnchors(COMPLETE.filter(f => f !== "AGENTS.md"))).toEqual(["AGENTS.md"]);
  });

  /*
   * 🔴 The anchor for `.claude/rules` accepts ANY file under it, so deleting
   * the rule AGENTS.md names while another file kept the directory non-empty
   * left the check green. Its exact presence is the property, not membership
   * of the directory.
   */
  it.each(REQUIRED_RULES)("refuses when %s is gone, even though other rules remain", rule => {
    expect(missingAnchors(COMPLETE.filter(f => f !== rule))).toEqual([rule]);
  });
});

describe("holding the skill router and the skills directory to one set", () => {
  const table = [
    "| Load this | When you are about to |",
    "|---|---|",
    "| `testing-evidence` | add or judge a test |",
    "| `derived-checks` | write a gate |",
  ].join("\n");

  it("reads the names out of the router rows", () => {
    expect([...routedSkills(table)]).toEqual(["testing-evidence", "derived-checks"]);
  });

  it("does not mistake other inline code for a row", () => {
    expect([...routedSkills("run `pnpm build` and see `AGENTS.md`")]).toEqual([]);
  });

  it("is silent when the two sides agree", () => {
    expect(routerDisagreements(new Set(["a"]), new Set(["a"]))).toEqual([]);
  });

  /*
   * Both directions, because they fail differently: a routed skill that does
   * not exist sends a reader to nothing, while a skill nobody routes to loads
   * only if its description wins, with no fallback behind it.
   */
  it("names a skill the router invented", () => {
    expect(routerDisagreements(new Set(["ghost"]), new Set())).toEqual([
      { name: "ghost", side: "routed but absent from .agents/skills" },
    ]);
  });

  it("names a skill the router forgot", () => {
    expect(routerDisagreements(new Set(), new Set(["orphan"]))).toEqual([
      { name: "orphan", side: "present in .agents/skills but not routed by AGENTS.md" },
    ]);
  });
});

describe("the command, run against another checkout", () => {
  /*
   * The findings are asserted through their functions above; this runs the
   * command itself, as CI does with `--root`, on a checkout whose copy has
   * drifted, so the wiring from a finding to the exit code and the printed fix
   * is covered too. The second run is the control: the same checkout, synced.
   */
  it("fails on a drifted copy, naming the fix, and passes once it is synced", () => {
    const base = mkdtempSync(join(tmpdir(), "agent-contract-cli-"));
    const put = (path, text) => {
      mkdirSync(dirname(join(base, path)), { recursive: true });
      writeFileSync(join(base, path), text);
    };
    try {
      const agents = `| \`a\` | when a applies |\n\n\`.claude/rules/integration-tests.md\` is read by path.\n\n${WHOLE_FILE_SECTION}`;
      put("AGENTS.md", agents);
      put("CLAUDE.md", header("AGENTS.md", agents) + agents);
      put(".claude/rules/integration-tests.md", '---\npaths:\n  - "**/*.integration.test.ts"\n---\n\nA rule.\n');
      put(".github/review-prompt.md", "Review.\n");
      put("CONTRIBUTING.md", "Contributing.\n");
      put("package.json", "{}\n");
      put(".agents/skills/a/SKILL.md", "---\nname: a\ndescription: when a applies\n---\n");
      put(".claude/skills/a/SKILL.md", "---\nname: a\ndescription: edited in the copy by hand\n---\n");
      execFileSync("git", ["init", "-q"], { cwd: base });
      execFileSync("git", ["add", "-A"], { cwd: base });
      const run = () => spawnSync(process.execPath, [CHECK, "--root", base], { encoding: "utf8" });

      const drifted = run();
      expect(drifted.status).toBe(1);
      expect(drifted.stderr).toContain(".claude/skills/a/SKILL.md: differs from .agents/skills — run pnpm skills:sync");

      syncSkillCopy(base);
      const synced = run();
      expect(synced.stderr).toBe("");
      expect(synced.status).toBe(0);

      // A flag with no directory is refused, not read as this checkout.
      expect(spawnSync(process.execPath, [CHECK, "--root"], { encoding: "utf8" }).status).toBe(64);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  /**
   * A checkout that meets the contract through AGENTS.md alone, with git
   * initialised; each test below adds a root override its own way. `put`
   * writes a file, `copy` makes CLAUDE.md the sync's copy of one, and `check`
   * runs the command, staging everything first unless told not to.
   */
  function overrideCheckout() {
    const base = mkdtempSync(join(tmpdir(), "agent-contract-override-"));
    const put = (path, text) => {
      mkdirSync(dirname(join(base, path)), { recursive: true });
      writeFileSync(join(base, path), text);
    };
    const copy = (source, text) => put("CLAUDE.md", header(source, text) + text);
    const check = ({ stage = true } = {}) => {
      if (stage) execFileSync("git", ["add", "-A"], { cwd: base });
      return spawnSync(process.execPath, [CHECK, "--root", base], { encoding: "utf8" });
    };
    const rules = "| `a` | when a applies |\n\n`.claude/rules/integration-tests.md` is read by path.\n\n";
    put("AGENTS.md", `${rules}${WHOLE_FILE_SECTION}`);
    copy("AGENTS.md", `${rules}${WHOLE_FILE_SECTION}`);
    put(".claude/rules/integration-tests.md", '---\npaths:\n  - "**/*.integration.test.ts"\n---\n\nA rule.\n');
    put(".github/review-prompt.md", "Review.\n");
    put("CONTRIBUTING.md", "Contributing.\n");
    put("package.json", "{}\n");
    put(".agents/skills/a/SKILL.md", "---\nname: a\ndescription: when a applies\n---\n");
    syncSkillCopy(base);
    execFileSync("git", ["init", "-q"], { cwd: base });
    return { base, put, copy, check, rules };
  }

  /*
   * With a root override, the AGENTS.md harness reads it and never the
   * AGENTS.md beside it, and the root CLAUDE.md copies it, so the sections both
   * tools load are the override's. An override without the section fails the
   * check although AGENTS.md still has it; the control puts it back.
   */
  it("holds the root override, not the AGENTS.md beside it, to the required sections", () => {
    const { base, put, copy, check, rules } = overrideCheckout();
    try {
      put("AGENTS.override.md", rules);
      copy("AGENTS.override.md", rules);
      const lost = check();
      expect(lost.status).toBe(1);
      expect(lost.stderr).toContain('AGENTS.override.md: no longer has the section "A whole-file write is a delete plus a create"');

      put("AGENTS.override.md", `${rules}${WHOLE_FILE_SECTION}`);
      copy("AGENTS.override.md", `${rules}${WHOLE_FILE_SECTION}`);
      const kept = check();
      expect(kept.stderr).toBe("");
      expect(kept.status).toBe(0);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("checks the paths the root override names, since agents read it and not the AGENTS.md beside it", () => {
    const { base, put, copy, check, rules } = overrideCheckout();
    try {
      const override = `${rules}Runs \`.github/workflows/gone.yml\`.\n\n${WHOLE_FILE_SECTION}`;
      put("AGENTS.override.md", override);
      copy("AGENTS.override.md", override);
      const run = check();
      expect(run.status).toBe(1);
      expect(run.stderr).toContain("AGENTS.override.md: path '.github/workflows/gone.yml' does not resolve");
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  /*
   * The sync copies an override git does not track yet, so the check reads
   * the same files: judged from tracked files alone, it would check the
   * AGENTS.md beside the override and call the copy of the override drift.
   */
  it("checks an override the sync would copy before it is staged", () => {
    const { base, put, copy, check, rules } = overrideCheckout();
    try {
      execFileSync("git", ["add", "-A"], { cwd: base });
      put("AGENTS.override.md", rules);
      copy("AGENTS.override.md", rules);
      const run = check({ stage: false });
      expect(run.stderr).toContain('AGENTS.override.md: no longer has the section "A whole-file write is a delete plus a create"');
      expect(run.stderr).not.toContain("CLAUDE.md:");
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  /*
   * The contributor guide goes through the same reading as the agent guidance.
   * The control is the same checkout once the guide cites what exists: a path
   * that is there, and the script run through the workspace that declares it.
   */
  it("reports a path or a script the contributor guide cites that does not resolve", () => {
    const { base, put, check } = overrideCheckout();
    try {
      put("pnpm-workspace.yaml", 'packages:\n  - "e2e"\n');
      put("e2e/package.json", '{ "name": "@scope/e2e", "scripts": { "test:e2e": "playwright test" } }\n');
      put("CONTRIBUTING.md", "See `.github/workflows/gone.yml`, then run `pnpm test:e2e`.\n");
      const stale = check();
      expect(stale.status).toBe(1);
      expect(stale.stderr).toContain("CONTRIBUTING.md: path '.github/workflows/gone.yml' does not resolve");
      expect(stale.stderr).toContain("CONTRIBUTING.md: script 'pnpm test:e2e' does not resolve");

      put(".github/workflows/gone.yml", "on: push\n");
      put("CONTRIBUTING.md", "See `.github/workflows/gone.yml`, then run `pnpm --filter @scope/e2e test:e2e`.\n");
      const current = check();
      expect(current.stderr).toBe("");
      expect(current.status).toBe(0);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe("reading the workspaces pnpm declares", () => {
  /** A checkout with an app under `apps/*` and a workspace at the fixed directory `e2e`. */
  const inCheckout = (workspaceFile, body) => {
    const base = mkdtempSync(join(tmpdir(), "agent-contract-workspaces-"));
    const put = (path, text) => {
      mkdirSync(dirname(join(base, path)), { recursive: true });
      writeFileSync(join(base, path), text);
    };
    try {
      put("pnpm-workspace.yaml", workspaceFile);
      put("apps/web/package.json", '{ "name": "web-app", "scripts": { "dev": "next dev" } }\n');
      put("e2e/package.json", '{ "name": "@scope/e2e", "scripts": { "test:e2e": "playwright test" } }\n');
      return body(base);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  };

  it("reads a fixed directory and every directory under a pattern, by name and by directory", () => {
    inCheckout('packages:\n  - "apps/*"\n  - "e2e"\n', base => {
      const scripts = workspaceScripts(base);
      expect(scripts.get("@scope/e2e")).toEqual(new Set(["test:e2e"]));
      expect(scripts.get("e2e")).toEqual(new Set(["test:e2e"]));
      expect(scripts.get("web-app")).toEqual(new Set(["dev"]));
      expect(scripts.get("web")).toEqual(new Set(["dev"]));
    });
  });

  it("refuses a pattern it cannot read, rather than reading it as matching nothing", () => {
    inCheckout('packages:\n  - "packages/**"\n', base => {
      expect(() => workspaceScripts(base)).toThrow('cannot read the workspace pattern "packages/**"');
    });
  });

  // The real list declares `e2e`, which a list kept by hand here once missed.
  it("finds the e2e workspace this repository declares", () => {
    expect(workspaceScripts().get("@nextlyhq/e2e")).toContain("test:e2e");
  });
});

describe("reporting the skills themselves", () => {
  /*
   * The copy and the frontmatter are the check's own findings, not stale
   * references, so they are asserted through the function the check reports
   * from: a copy out of step names the fix, and a broken skill names itself.
   */
  it("reports a Claude Code copy out of step, naming the fix, and a skill no harness would load", () => {
    const base = mkdtempSync(join(tmpdir(), "agent-contract-skills-"));
    try {
      mkdirSync(join(base, ".agents/skills/a"), { recursive: true });
      writeFileSync(join(base, ".agents/skills/a/SKILL.md"), "---\ndescription: nameless\n---\n");
      expect(skillFindings(base)).toEqual([
        { file: ".claude/skills/a/SKILL.md", kind: "skills copy", claim: "is missing from the Claude Code copy", fix: "run pnpm skills:sync" },
        { file: ".agents/skills/a/SKILL.md", kind: "skill", claim: "has no name in its frontmatter" },
      ]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  // A sync copies what a link points at and leaves the link, so a finding on
  // the skills' own side names real files there as its fix, not the sync.
  it.runIf(process.platform !== "win32")("names real files as the fix for a link on the skills' own side", () => {
    const base = mkdtempSync(join(tmpdir(), "agent-contract-skills-"));
    try {
      mkdirSync(join(base, "elsewhere"), { recursive: true });
      writeFileSync(join(base, "elsewhere/SKILL.md"), "---\nname: a\ndescription: linked in\n---\n");
      mkdirSync(join(base, ".agents/skills/a"), { recursive: true });
      symlinkSync(join(base, "elsewhere/SKILL.md"), join(base, ".agents/skills/a/SKILL.md"));
      syncSkillCopy(base);
      expect(skillFindings(base)).toEqual([
        { file: ".agents/skills/a/SKILL.md", kind: "skills copy", claim: "is a symbolic link — skills are real files", fix: "replace .agents/skills/a/SKILL.md with real files, then run pnpm skills:sync" },
      ]);
      rmSync(join(base, ".agents/skills"), { recursive: true });
      symlinkSync(join(base, "elsewhere"), join(base, ".agents/skills"));
      expect(skillFindings(base)[0]).toEqual({ file: ".agents/skills", kind: "skills copy", claim: "is a symbolic link — skills are real files", fix: "replace .agents/skills with real files, then run pnpm skills:sync" });
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("reports nothing for this repository's own skills", () => {
    expect(skillFindings()).toEqual([]);
  });
});

describe("reaching Claude Code", () => {
  /*
   * Claude Code reads the CLAUDE.md beside each file the AGENTS.md harness takes, a copy of
   * it, since an import does not reach a session started below the importing
   * file. The copies themselves are tested beside `agent-instructions.mjs`;
   * here, that the check reports them as its own findings.
   */
  it("reports a copy that is missing or out of step, naming the sync as the fix", () => {
    const base = mkdtempSync(join(tmpdir(), "agent-contract-claude-"));
    try {
      mkdirSync(join(base, "packages/p"), { recursive: true });
      writeFileSync(join(base, "AGENTS.md"), "root\n");
      writeFileSync(join(base, "CLAUDE.md"), `${header("AGENTS.md", "root, before\n")}root, before\n`);
      writeFileSync(join(base, "packages/p/AGENTS.md"), "p\n");
      expect(instructionCopyFindings(base, ["AGENTS.md", "CLAUDE.md", "packages/p/AGENTS.md"])).toEqual([
        { file: "CLAUDE.md", kind: "instructions", claim: "differs from AGENTS.md", fix: "run pnpm instructions:sync" },
        { file: "packages/p/CLAUDE.md", kind: "instructions", claim: "is missing, so Claude Code never reads packages/p/AGENTS.md", fix: "run pnpm instructions:sync" },
      ]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("refuses a rule every session would load, and one loaded by path that AGENTS.md does not name", () => {
    const base = mkdtempSync(join(tmpdir(), "agent-contract-rules-"));
    const put = (path, text) => {
      mkdirSync(dirname(join(base, path)), { recursive: true });
      writeFileSync(join(base, path), text);
    };
    try {
      put(".claude/rules/always.md", "Always.\n");
      put(".claude/rules/named.md", '---\npaths: ["**/*.y"]\n---\n\nNamed.\n');
      put(".claude/rules/unnamed.md", '---\npaths:\n  - "**/*.x"\n---\n\nUnnamed.\n');
      const agents = `\`.claude/rules/named.md\` reaches Codex as the \`y\` skill.\n\n${WHOLE_FILE_SECTION}`;
      expect(ruleFindings(base, agents)).toEqual([
        { file: ".claude/rules/always.md", kind: "instructions", claim: "has no paths, so Claude Code loads it in every session and Codex never does", fix: "move it into AGENTS.md, which both load" },
        { file: ".claude/rules/unnamed.md", kind: "instructions", claim: "is not named in AGENTS.md, so Codex is never told where it applies", fix: "name it in AGENTS.md with the skill that carries it to Codex" },
      ]);
      expect(ruleFindings(base, agents.replace("## A whole-file write", "## A whole-file edit")).at(-1)).toEqual({
        file: "AGENTS.md",
        kind: "instructions",
        claim: 'no longer has the section "A whole-file write is a delete plus a create", which both tools must load in every session',
        fix: "put it back",
      });
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  /*
   * A heading kept over a body that has lost the rule passes a check of
   * headings alone. The forms are looked for under the heading only, up to the
   * next section, so text elsewhere cannot stand in for them, and a `#` in a
   * code block is a comment that does not end the section.
   */
  it("holds the whole-file section to the forms it prescribes, not only to its heading", () => {
    const base = mkdtempSync(join(tmpdir(), "agent-contract-sections-"));
    const heading = "## A whole-file write is a delete plus a create";
    const claim = missing => `has the section "A whole-file write is a delete plus a create" without ${missing}, the forms it prescribes`;
    try {
      const emptied = `${heading}\n\nNothing here now.\n\n## Next\n\nUse \`set -o noclobber\` or \`{ flag: "wx" }\` elsewhere.\n`;
      expect(ruleFindings(base, emptied)).toEqual([{ file: "AGENTS.md", kind: "instructions", claim: claim('`set -o noclobber` or `{ flag: "wx" }`'), fix: "put them back" }]);
      expect(ruleFindings(base, `${heading}\n\nOnly \`set -o noclobber\`.\n`).map(finding => finding.claim)).toEqual([claim('`{ flag: "wx" }`')]);
      const fenced = `${heading}\n\n\`\`\`sh\n# a comment, not a heading\nset -o noclobber\n\`\`\`\n\nOr \`{ flag: "wx" }\`.\n\n## Next\n`;
      expect(ruleFindings(base, fenced)).toEqual([]);
      // A fence closes only on its own character: the other fence shown inside it, and a heading there, stay code.
      const nested = `${heading}\n\n\`\`\`md\n~~~\n## Not a heading\n~~~\n\`\`\`\n\nUse \`set -o noclobber\` or \`{ flag: "wx" }\`.\n\n## Next\n`;
      expect(ruleFindings(base, nested)).toEqual([]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("takes the root override as the file both tools load, where there is one", () => {
    expect(rootInstructions(["AGENTS.md", "CLAUDE.md"])).toBe("AGENTS.md");
    expect(rootInstructions(["AGENTS.md", "AGENTS.override.md", "CLAUDE.md"])).toBe("AGENTS.override.md");
    // An override in a package is that package's, not the root's.
    expect(rootInstructions(["packages/p/AGENTS.override.md", "AGENTS.md"])).toBe("AGENTS.md");
  });

  it("finds this repository's rules reachable by both tools", () => {
    const repo = fileURLToPath(new URL("..", import.meta.url));
    expect(ruleFindings(repo, readFileSync(join(repo, "AGENTS.md"), "utf8"))).toEqual([]);
  });

  it("finds a copy of every instruction file in this repository where Claude Code reads it", () => {
    const repo = fileURLToPath(new URL("..", import.meta.url));
    const tracked = execFileSync("git", ["ls-files"], { cwd: repo, encoding: "utf8" }).split("\n").filter(Boolean);
    expect(instructionCopyFindings(repo, tracked)).toEqual([]);
  });
});

describe("not reporting a path git is told to ignore", () => {
  /*
   * `.claude/settings.local.json` is written per worktree and is absent from a
   * fresh clone by design, so AGENTS.md naming it is correct prose rather than
   * a stale reference. The exemption has to stay narrow, though: a tracked
   * path that does not exist is still a finding.
   */
  it("names an ignored path as ignored", () => {
    expect(gitIgnored(["node_modules/anything.ts"])).toContain("node_modules/anything.ts");
  });

  it("does not exempt a path git would track", () => {
    expect(gitIgnored(["packages/nextly/src/ghost.ts"]).size).toBe(0);
  });

  it("asks nothing when there is nothing to ask about", () => {
    expect(gitIgnored([])).toEqual(new Set());
  });
});

describe("reading a tilde-fenced block", () => {
  /*
   * 🔴 The reader tracked a boolean "are we inside a fence" and matched only
   * backticks, so a `~~~` block was invisible: every command and path inside
   * one went unchecked, and a stale reference hidden there passed CI.
   */
  it("reads a tilde-fenced block", () => {
    expect(codeSpans("before\n~~~sh\npnpm lint\n~~~\nafter")).toEqual(["pnpm lint"]);
  });

  it("does not let one fence character close the other's block", () => {
    // The backticks are CONTENT here, because a tilde block opened it.
    expect(codeSpans("~~~\n```\npnpm lint\n~~~")).toEqual(["```", "pnpm lint"]);
  });

  it("requires a closing fence at least as long as the opening one", () => {
    expect(codeSpans("~~~~\n~~~\npnpm lint\n~~~~")).toEqual(["~~~", "pnpm lint"]);
  });

  /*
   * 🔴 A fence carrying an info string is CONTENT, not a close. A nested
   * ```typescript inside a backtick block ended it, so every line after was
   * read as prose and the rest of the document went unchecked — while still
   * reporting clean.
   */
  it("does not let a fence with an info string close the block", () => {
    expect(codeSpans("```\n```typescript\npnpm lint\n```")).toEqual([
      "```typescript",
      "pnpm lint",
    ]);
  });

  it("closes on a bare marker with only trailing whitespace", () => {
    expect(codeSpans("```\npnpm lint\n```   ")).toEqual(["pnpm lint"]);
  });
});

describe("the population the check actually reads", () => {
  /*
   * 🔴 An anchor is how this module refuses a set that cannot have found
   * anything. `.github/review-prompt.md` is executable guidance for the CI
   * review agent — it names `.github/scripts/review-bot-gh.sh` with five
   * subcommands, two skills and a workflow file — and it was outside the
   * population entirely, so renaming any of those targets left the check
   * green. Asserting membership by name is what separates "checked and clean"
   * from "never read it".
   */
  it("collects the CI review prompt", () => {
    expect(instructionFiles()).toContain(REVIEW_PROMPT);
  });

  it("holds the review prompt as an anchor, so its deletion refuses", () => {
    expect(ANCHORS).toContain(REVIEW_PROMPT);
    expect(missingAnchors(["AGENTS.md", ...REQUIRED_RULES, ".agents/skills/y/SKILL.md", CONTRIBUTING]))
      .toEqual([REVIEW_PROMPT]);
  });

  // The contributor guide is read for the same reason, and held the same way.
  it("collects the contributor guide, and holds it as an anchor", () => {
    expect(instructionFiles()).toContain(CONTRIBUTING);
    expect(missingAnchors(["AGENTS.md", ...REQUIRED_RULES, ".agents/skills/y/SKILL.md", REVIEW_PROMPT]))
      .toEqual([CONTRIBUTING]);
  });

  it("recognises the extensionless dotfiles the instructions name", () => {
    // `.nvmrc` is the measured one: AGENTS.md cites it twice.
    expect(EXTENSIONLESS_FILES.has(".nvmrc")).toBe(true);
  });
});

describe("deciding whether a bare filename is a claim", () => {
  // Measured over the instruction files as they stand: accepting every bare
  // name reported 20 valid references, and this rule reports none of them
  // while still catching all three probe deletions.
  const basenames = new Set(["ci.yml", "FieldRenderer.tsx", "context7.json", ".nvmrc"]);

  it("stays silent on a name some file in the repository carries", () => {
    expect(claimsBareFile("ci.yml", basenames)).toBe(false);
    expect(claimsBareFile("FieldRenderer.tsx", basenames)).toBe(false);
  });

  it("reports a name no file carries", () => {
    expect(claimsBareFile("context7-gone.json", basenames)).toBe(true);
  });

  it("ignores a bare suffix, which names no file at all", () => {
    expect(claimsBareFile(".test.mjs", basenames)).toBe(false);
    expect(claimsBareFile(".md", basenames)).toBe(false);
  });

  /*
   * This is only ever reached once the caller's existence checks have already
   * failed, so for an allowlisted dotfile there is nothing left to ask: it
   * names repository configuration at one place and it was not there. A
   * same-named file elsewhere does not make the citation live — that fallback
   * is what let a RELOCATED `.nvmrc` read as fine.
   */
  it("reports an allowlisted dotfile that did not resolve, wherever its name occurs", () => {
    expect(claimsBareFile(".nvmrc", basenames)).toBe(true);
  });

  /*
   * 🔴 The rule this replaced asked whether the name was a TRACKED ROOT FILE,
   * which reads as the same question and is not. That set is read from the
   * repository as it stands, so a deleted `.nvmrc` is absent from it and the
   * reference was dropped as a suffix pattern — silence arriving exactly when
   * the citation went stale.
   */
  it("reports an extensionless dotfile once no file carries the name", () => {
    expect(claimsBareFile(".nvmrc", new Set(["ci.yml"]))).toBe(true);
  });
});

describe("finding citations of agent guidance anywhere in the repository", () => {
  /*
   * 🔴 Moving a rule into a skill left four citations of the old path behind,
   * all in .ts source comments. The cleanup searched only Markdown and .mjs and
   * then reported none — a population that excluded every file carrying the
   * problem.
   */
  it("finds a citation in ordinary source text", () => {
    expect([...guidanceReferences("see `.claude/rules/gone.md` for the rule")]).toEqual([
      ".claude/rules/gone.md",
    ]);
  });

  it("finds a skill directory citation", () => {
    expect([...guidanceReferences("the `.claude/skills/derived-checks/SKILL.md` skill")]).toEqual([
      ".claude/skills/derived-checks/SKILL.md",
    ]);
  });

  /*
   * The skills now live under `.agents`, so a citation of one there must be
   * checked too, or moving a skill would leave its citations pointing at
   * nothing while this stayed green.
   */
  it("finds a citation under the shared skills directory as well", () => {
    expect([...guidanceReferences("the `.agents/skills/derived-checks/SKILL.md` skill")]).toEqual([
      ".agents/skills/derived-checks/SKILL.md",
    ]);
  });

  it("reads nothing out of prose that merely says claude", () => {
    expect([...guidanceReferences("claude rules are loaded at launch")]).toEqual([]);
  });

  it("drops trailing punctuation that belongs to the sentence", () => {
    expect([...guidanceReferences("see `.claude/rules/a.md`.")]).toEqual([".claude/rules/a.md"]);
  });
});

describe("keeping every subcommand of one launcher", () => {
  /*
   * 🔴 The entry was keyed on filter and script alone, so the last invocation
   * won and the rest vanished. AGENTS.md names six `pnpm worktree`
   * subcommands and the checker reported ONE of them — deleting five changed
   * nothing it said. The script stays one entry, so a missing script is still
   * one finding rather than six; the subcommands accumulate.
   */
  it("accumulates the subcommands of a repeated launcher", () => {
    const entries = pnpmScriptsIn(
      "`pnpm worktree new` then `pnpm worktree list` then `pnpm worktree remove`"
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].subcommands).toEqual(["new", "list", "remove"]);
  });

  it("does not repeat a subcommand named twice", () => {
    expect(pnpmScriptsIn("`pnpm worktree list` and again `pnpm worktree list`")[0].subcommands)
      .toEqual(["list"]);
  });
});

describe("telling a workspace filter from a placeholder", () => {
  /*
   * 🔴 An unknown filter was skipped as a placeholder, which is right for
   * `<pkg>` and wrong for `playground`: renaming a real workspace left every
   * command filtered to it green.
   */
  it.each(["playground", "nextly", "@nextlyhq/ui", "plugin-form-builder"])(
    "treats %s as a concrete workspace",
    filter => {
      expect(namesAWorkspace(filter)).toBe(true);
    }
  );

  it.each(["<pkg>", "<workspace>", "*", "{a,b}"])("treats %s as a placeholder", filter => {
    expect(namesAWorkspace(filter)).toBe(false);
  });
});

describe("reading a file named as a command operand", () => {
  /*
   * 🔴 A span holding whitespace was discarded whole, so a file named as an
   * operand was never looked at. Measured against the repository: deleting
   * `scripts/measure-facts.mjs` left the check reporting OK, because AGENTS.md
   * names it only inside `node scripts/measure-facts.mjs`.
   */
  it("reads the operand of a command span", () => {
    expect([...pathsIn("run `node scripts/measure-facts.mjs` first")]).toEqual([
      "scripts/measure-facts.mjs",
    ]);
  });

  it("reads a flag's argument", () => {
    expect([...pathsIn("`docker compose -f docker-compose.test.yml up -d`")]).toEqual([
      "docker-compose.test.yml",
    ]);
  });

  it("still drops the words of a command that name no file", () => {
    // Only the operand survives; `node`, `-f`, `up` and `-d` are not paths.
    expect([...pathsIn("`node --experimental-vm-modules scripts/x.mjs --out dir`")]).toEqual([
      "scripts/x.mjs",
    ]);
  });

  it("still ignores a glob operand", () => {
    expect([...pathsIn("`eslint src/**/*.ts --fix`")]).toEqual([]);
  });
});

describe("analysing a real instruction file on disk", () => {
  /*
   * 🔴 The `claimsFilePath` tests above pass `nestedGuide: true` straight in,
   * which reconstructs the classification the caller performs. Deleting the
   * derivation at the call site would leave them green while a deleted
   * package-relative target is silently ignored again. These give
   * `unresolvedIn` a file PATH and let it decide, which is the production
   * decision.
   */
  const withRepo = body => {
    const base = mkdtempSync(join(tmpdir(), "nextly-contract-"));
    try {
      mkdirSync(join(base, "packages", "thing", "src"), { recursive: true });
      mkdirSync(join(base, ".claude", "skills", "x"), { recursive: true });
      writeFileSync(join(base, "package.json"), "{}");
      return body(base);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  };

  const facts = { topLevel: new Set(["packages", "scripts", ".claude"]), basenames: new Set() };

  // A package's override is read as its AGENTS.md is, since the harness takes it in that file's place.
  const guides = ["packages/thing/AGENTS.md", "packages/thing/AGENTS.override.md"];

  it("reports a nested guide's relative path once the target is gone", () => {
    withRepo(base => {
      // The file is NOT created, which is the deletion being modelled.
      for (const file of guides) {
        const found = unresolvedIn({ base, file, text: "The entry point is `src/config.ts`.", ...facts });
        expect(found, file).toEqual(["src/config.ts"]);
      }
    });
  });

  it("stays silent while that target exists", () => {
    withRepo(base => {
      writeFileSync(join(base, "packages", "thing", "src", "config.ts"), "");
      for (const file of guides) {
        const found = unresolvedIn({ base, file, text: "The entry point is `src/config.ts`.", ...facts });
        expect(found, file).toEqual([]);
      }
    });
  });

  it("treats the same citation in a skill as a fragment, not a claim", () => {
    withRepo(base => {
      const found = unresolvedIn({
        base,
        file: ".agents/skills/x/SKILL.md",
        text: "The entry point is `src/config.ts`.",
        ...facts,
      });
      expect(found).toEqual([]);
    });
  });
});

describe("dotfiles named with a directory in front of them", () => {
  it("reads an allowlisted dotfile under a package", () => {
    // 🔴 The allowlist was compared against the whole path, so a nested
    // dotfile was discarded before any check ran.
    expect([...pathsIn("see `packages/nextly/.gitignore`")]).toEqual([
      "packages/nextly/.gitignore",
    ]);
  });

  /*
   * 🔴 A bare allowlisted dotfile used to fall through to the repository-wide
   * basenames, so MOVING the root `.nvmrc` into a subdirectory left the
   * citation reading as live — the moved file still carries the name.
   * Deletion was reported and relocation was not, and relocation is the
   * likelier accident.
   */
  it("reports a relocated dotfile, not just a deleted one", () => {
    expect(claimsBareFile(".nvmrc", new Set([".nvmrc", "ci.yml"]))).toBe(true);
  });

  it("still treats a bare suffix as naming nothing", () => {
    expect(claimsBareFile(".md", new Set(["ci.yml"]))).toBe(false);
  });
});
