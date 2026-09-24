/**
 * What keeps the Claude Code copy of the skills a copy, and every skill
 * loadable by both harnesses. Each case builds a small repository in a
 * temporary directory, so the property is judged on files, not on mocks.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CLAUDE_COPY, SKILLS_HOME, skillCopyDrift, skillFrontmatterProblems, syncSkillCopy } from "./agent-skills.mjs";

const POSIX = process.platform !== "win32";
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

    syncSkillCopy(base);

    expect(skillCopyDrift(base)).toEqual([]);
    expect(readFileSync(join(base, CLAUDE_COPY, "a/SKILL.md"))).toEqual(readFileSync(join(base, SKILLS_HOME, "a/SKILL.md")));
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
