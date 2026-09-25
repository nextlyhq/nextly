/**
 * What keeps the Claude Code copy of the skills a copy, and every skill
 * loadable by both harnesses. Each case builds a small repository in a
 * temporary directory, so the property is judged on files, not on mocks.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CLAUDE_COPY, SKILLS_HOME, skillCopyDrift, skillFrontmatterProblems, syncSkillCopy } from "./agent-skills.mjs";

const POSIX = process.platform !== "win32";
const SCRIPT = fileURLToPath(new URL("./agent-skills.mjs", import.meta.url));
let base;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "agent-skills-"));
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

function skill(dir, name, text = `---\nname: ${name}\ndescription: when ${name} applies\n---\n\nThe procedure.\n`) {
  mkdirSync(join(base, dir, name), { recursive: true });
  writeFileSync(join(base, dir, name, "SKILL.md"), text);
}

describe("the Claude Code copy of the skills", () => {
  it("is identical after a sync, byte for byte, with anything else removed", () => {
    skill(SKILLS_HOME, "a");
    skill(SKILLS_HOME, "b");
    skill(CLAUDE_COPY, "stale");

    expect(syncSkillCopy(base)).toEqual({ leftover: null });

    expect(skillCopyDrift(base)).toEqual([]);
    expect(readFileSync(join(base, CLAUDE_COPY, "a/SKILL.md"))).toEqual(readFileSync(join(base, SKILLS_HOME, "a/SKILL.md")));
    // Neither the staged copy nor the old one it replaced is left beside it.
    expect(readdirSync(join(base, ".claude"))).toEqual(["skills"]);
  });

  it("names a skill missing from the copy", () => {
    skill(SKILLS_HOME, "a");
    skill(SKILLS_HOME, "b");
    skill(CLAUDE_COPY, "a");
    expect(skillCopyDrift(base)).toEqual([{ path: `${CLAUDE_COPY}/b/SKILL.md`, problem: "is missing from the Claude Code copy" }]);
  });

  it("names a copied file that differs from the skill", () => {
    skill(SKILLS_HOME, "a");
    skill(CLAUDE_COPY, "a", "---\nname: a\ndescription: edited in the copy by hand\n---\n");
    expect(skillCopyDrift(base)).toEqual([{ path: `${CLAUDE_COPY}/a/SKILL.md`, problem: `differs from ${SKILLS_HOME}` }]);
  });

  it("names a file in the copy that the skills do not have", () => {
    skill(SKILLS_HOME, "a");
    skill(CLAUDE_COPY, "a");
    skill(CLAUDE_COPY, "only-in-the-copy");
    expect(skillCopyDrift(base)).toEqual([{ path: `${CLAUDE_COPY}/only-in-the-copy/SKILL.md`, problem: `is not in ${SKILLS_HOME}` }]);
  });

  /*
   * A link would pass every comparison above on the machine that made it, and
   * leave a Windows checkout, where links arrive as text files, with no skills.
   */
  it.runIf(POSIX)("refuses a copy that is a symbolic link, whole or file by file", () => {
    skill(SKILLS_HOME, "a");
    mkdirSync(join(base, ".claude"), { recursive: true });
    symlinkSync(join(base, SKILLS_HOME), join(base, CLAUDE_COPY));
    expect(skillCopyDrift(base)).toEqual([{ path: CLAUDE_COPY, problem: "is a symbolic link — it must be a real copy" }]);

    rmSync(join(base, CLAUDE_COPY));
    mkdirSync(join(base, CLAUDE_COPY, "a"), { recursive: true });
    symlinkSync(join(base, SKILLS_HOME, "a/SKILL.md"), join(base, CLAUDE_COPY, "a/SKILL.md"));
    expect(skillCopyDrift(base)).toEqual([{ path: `${CLAUDE_COPY}/a/SKILL.md`, problem: "is a symbolic link — it must be a real copy" }]);
  });

  it.runIf(POSIX)("refuses a skill that is a symbolic link, which a checkout without links turns into text", () => {
    skill(SKILLS_HOME, "a");
    mkdirSync(join(base, "elsewhere"), { recursive: true });
    writeFileSync(join(base, "elsewhere/SKILL.md"), "---\nname: b\ndescription: linked in\n---\n");
    mkdirSync(join(base, SKILLS_HOME, "b"), { recursive: true });
    symlinkSync(join(base, "elsewhere/SKILL.md"), join(base, SKILLS_HOME, "b/SKILL.md"));
    // The copy follows the link, so the two agree byte for byte; the link is still refused.
    syncSkillCopy(base);
    expect(skillCopyDrift(base)).toEqual([{ path: `${SKILLS_HOME}/b/SKILL.md`, problem: "is a symbolic link — skills are real files" }]);
  });

  it.runIf(POSIX)("refuses skills whose own directory is a symbolic link, even to identical files", () => {
    // The inverse layout: the copy real, and the skills a link to it. Followed,
    // the two trees are the same files and would compare clean.
    skill(CLAUDE_COPY, "a");
    mkdirSync(join(base, ".agents"), { recursive: true });
    symlinkSync(join(base, CLAUDE_COPY), join(base, SKILLS_HOME));
    expect(skillCopyDrift(base)).toEqual([{ path: SKILLS_HOME, problem: "is a symbolic link — skills are real files" }]);
  });

  it("keeps the copy as it was when a sync fails part-way, leaving nothing behind", () => {
    skill(CLAUDE_COPY, "a");
    // Nothing to copy from, so the sync fails after it has started.
    expect(() => syncSkillCopy(base)).toThrow();
    expect(readFileSync(join(base, CLAUDE_COPY, "a/SKILL.md"), "utf8")).toContain("name: a");
    expect(readdirSync(join(base, ".claude"))).toEqual(["skills"]);
  });

  it("keeps the old copy exactly as it was when the new one cannot be put in place, leaving nothing behind", () => {
    skill(SKILLS_HOME, "a", "---\nname: a\ndescription: the new text\n---\n");
    skill(CLAUDE_COPY, "a", "---\nname: a\ndescription: the old text\n---\n");
    // The swap itself is refused: the new copy cannot be moved in, while every other move goes through.
    const rename = (from, to) => {
      if (to === join(base, CLAUDE_COPY) && !from.endsWith("-old")) throw new Error("the swap was refused");
      renameSync(from, to);
    };
    expect(() => syncSkillCopy(base, { rename })).toThrow("the swap was refused");
    expect(readFileSync(join(base, CLAUDE_COPY, "a/SKILL.md"), "utf8")).toContain("the old text");
    expect(readdirSync(join(base, ".claude"))).toEqual(["skills"]);
  });

  /*
   * Once the new copy is in place the sync has done its work. Failing to
   * remove the old copy afterwards is reported beside that success, not
   * thrown as if the swap had failed.
   */
  it("reports the copy replaced, naming the old copy it set aside, when only removing that fails", () => {
    skill(SKILLS_HOME, "a", "---\nname: a\ndescription: the new text\n---\n");
    skill(CLAUDE_COPY, "a", "---\nname: a\ndescription: the old text\n---\n");
    // Only the removal of the old copy is refused; every other removal goes through.
    const remove = (path, options) => {
      if (path.endsWith("-old")) throw new Error("the removal was refused");
      rmSync(path, options);
    };
    const { leftover } = syncSkillCopy(base, { remove });
    expect(readFileSync(join(base, CLAUDE_COPY, "a/SKILL.md"), "utf8")).toContain("the new text");
    expect(leftover?.error.message).toBe("the removal was refused");
    expect(readFileSync(join(leftover.path, "a/SKILL.md"), "utf8")).toContain("the old text");
    expect(readdirSync(join(base, ".claude")).sort()).toEqual([basename(leftover.path), "skills"].sort());
  });

  /*
   * Git records whether a file is executable, and a script a skill runs needs
   * it; a copy that differs there only is still out of step.
   */
  it.runIf(POSIX)("names a copied file that differs from its skill only in whether it is executable", () => {
    skill(SKILLS_HOME, "a");
    skill(CLAUDE_COPY, "a");
    writeFileSync(join(base, SKILLS_HOME, "a/run.sh"), "#!/bin/sh\n");
    writeFileSync(join(base, CLAUDE_COPY, "a/run.sh"), "#!/bin/sh\n");
    chmodSync(join(base, SKILLS_HOME, "a/run.sh"), 0o755);
    chmodSync(join(base, CLAUDE_COPY, "a/run.sh"), 0o644);
    expect(skillCopyDrift(base)).toEqual([{ path: `${CLAUDE_COPY}/a/run.sh`, problem: `differs from ${SKILLS_HOME} in whether it is executable` }]);
  });

  it.runIf(POSIX)("keeps an executable skill file executable in the copy it syncs", () => {
    skill(SKILLS_HOME, "a");
    writeFileSync(join(base, SKILLS_HOME, "a/run.sh"), "#!/bin/sh\n");
    chmodSync(join(base, SKILLS_HOME, "a/run.sh"), 0o755);
    syncSkillCopy(base);
    expect(skillCopyDrift(base)).toEqual([]);
  });

  it("refuses a copy that is a file, as a link becomes on a checkout without links", () => {
    skill(SKILLS_HOME, "a");
    mkdirSync(join(base, ".claude"), { recursive: true });
    writeFileSync(join(base, CLAUDE_COPY), "../.agents/skills");
    expect(skillCopyDrift(base)).toEqual([{ path: CLAUDE_COPY, problem: "is not a directory — it must be a real copy" }]);
  });
});

describe("what makes a skill loadable by both harnesses", () => {
  it("accepts a name matching its folder, and a description", () => {
    skill(SKILLS_HOME, "a");
    expect(skillFrontmatterProblems(base)).toEqual([]);
  });

  /*
   * A line that looks like `key: value` is not a loadable field: `description: [`
   * is not YAML, and a folded `>-` with nothing under it is an empty string.
   * Both pass a line matcher; a harness parsing YAML loads neither.
   */
  it("names a skill whose frontmatter only looks like YAML, and one whose folded description is empty", () => {
    skill(SKILLS_HOME, "broken", "---\nname: broken\ndescription: [\n---\n");
    skill(SKILLS_HOME, "empty", "---\nname: empty\ndescription: >-\n---\n");
    skill(SKILLS_HOME, "folded", "---\nname: folded\ndescription: >-\n  Use when a folded description\n  spans two lines.\n---\n");
    const problems = skillFrontmatterProblems(base);
    expect(problems.map(found => found.skill)).toEqual(["broken", "empty"]);
    expect(problems[0].problem).toMatch(/^has frontmatter that is not YAML: /);
    expect(problems[1].problem).toBe("has no description in its frontmatter");
  });

  it("reads quoted values as YAML does, and holds names and descriptions to the format's limits", () => {
    // Decoded, `"quoted"` is the folder's name and `""` is no description at all.
    skill(SKILLS_HOME, "quoted", '---\nname: "quoted"\ndescription: ""\n---\n');
    skill(SKILLS_HOME, "Bad_Name", "---\nname: Bad_Name\ndescription: some\n---\n");
    skill(SKILLS_HOME, "a".repeat(65), `---\nname: ${"a".repeat(65)}\ndescription: some\n---\n`);
    skill(SKILLS_HOME, "a".repeat(64), `---\nname: ${"a".repeat(64)}\ndescription: some\n---\n`);
    skill(SKILLS_HOME, "long", `---\nname: long\ndescription: ${"x".repeat(1025)}\n---\n`);
    skill(SKILLS_HOME, "just-fits", `---\nname: just-fits\ndescription: ${"x".repeat(1024)}\n---\n`);
    expect(skillFrontmatterProblems(base)).toEqual([
      { skill: "Bad_Name", problem: "has a name that is not 1 to 64 lowercase letters, digits and single hyphens" },
      { skill: "a".repeat(65), problem: "has a name that is not 1 to 64 lowercase letters, digits and single hyphens" },
      { skill: "long", problem: "has a description of 1025 characters, over the 1024 a skill may have" },
      { skill: "quoted", problem: "has no description in its frontmatter" },
    ]);
  });

  it("names a skill folder with no SKILL.md, which no harness loads", () => {
    skill(SKILLS_HOME, "a");
    mkdirSync(join(base, SKILLS_HOME, "readme-only"), { recursive: true });
    writeFileSync(join(base, SKILLS_HOME, "readme-only/README.md"), "Not a skill file.\n");
    expect(skillFrontmatterProblems(base)).toEqual([{ skill: "readme-only", problem: "has no SKILL.md, so no harness loads it" }]);
  });

  it("names a skill without a name, one named for another folder, and one without a description", () => {
    skill(SKILLS_HOME, "nameless", "---\ndescription: some\n---\n");
    skill(SKILLS_HOME, "mismatched", "---\nname: something-else\ndescription: some\n---\n");
    skill(SKILLS_HOME, "undescribed", "---\nname: undescribed\n---\n");
    expect(skillFrontmatterProblems(base)).toEqual([
      { skill: "mismatched", problem: 'is named "something-else", not after its folder' },
      { skill: "nameless", problem: "has no name in its frontmatter" },
      { skill: "undescribed", problem: "has no description in its frontmatter" },
    ]);
  });
});

describe("the command", () => {
  /*
   * Started through a link, node gives the module its real path while the
   * command line keeps the link's. A guard comparing the two skips the command
   * and exits 0 as if the sync had run.
   */
  it.runIf(POSIX)("runs when started through a symbolic link", () => {
    const link = join(base, "agent-skills.mjs");
    symlinkSync(SCRIPT, link);
    const run = spawnSync(process.execPath, [link], { encoding: "utf8" });
    expect(run.status).toBe(64);
    expect(run.stderr).toContain("usage: node scripts/agent-skills.mjs sync");
  });
});
