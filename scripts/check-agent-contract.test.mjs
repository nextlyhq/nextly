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
  EXTENSIONLESS_FILES,
  REVIEW_PROMPT,
  REQUIRED_RULES,
  claimsBareFile,
  claimsFilePath,
  guidanceReferences,
  instructionFiles,
  claimsRepoRoot,
  codeSpans,
  missingAnchors,
  namesAWorkspace,
  pathsIn,
  gitIgnored,
  pnpmScriptsIn,
  routedSkills,
  routerDisagreements,
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
  const COMPLETE = ["AGENTS.md", ...REQUIRED_RULES, ".claude/skills/y/SKILL.md", REVIEW_PROMPT];

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
   * one of the two rules AGENTS.md promises are always loaded left the other
   * keeping the directory non-empty and the check green. Their exact presence
   * is the property, not membership of the directory.
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
      { name: "ghost", side: "routed but absent from .claude/skills" },
    ]);
  });

  it("names a skill the router forgot", () => {
    expect(routerDisagreements(new Set(), new Set(["orphan"]))).toEqual([
      { name: "orphan", side: "present in .claude/skills but not routed by AGENTS.md" },
    ]);
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
    expect(missingAnchors(["AGENTS.md", ...REQUIRED_RULES, ".claude/skills/y/SKILL.md"]))
      .toEqual([REVIEW_PROMPT]);
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

  it("stays silent on an extensionless dotfile that exists", () => {
    expect(claimsBareFile(".nvmrc", basenames)).toBe(false);
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
