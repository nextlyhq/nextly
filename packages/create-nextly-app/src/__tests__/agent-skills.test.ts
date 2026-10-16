/**
 * The skills a new or existing app is given for coding agents: read from the
 * CLI's own bundle, written as real files into both homes agents read, and
 * never over a skill folder the project already has.
 */
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AGENT_SKILL_HOMES,
  type BundledSkill,
  describeWrittenSkills,
  readBundledSkills,
  updateSkillsCommand,
  writeAgentSkills,
} from "../generators/agent-skills";

const repository = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../.."
);

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "nextly-agent-skills-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const skill = (name: string, text = `---\nname: ${name}\n---\n# ${name}\n`) =>
  ({
    name,
    files: [{ path: "SKILL.md", content: Buffer.from(text) }],
  }) satisfies BundledSkill;

/** Writes a bundle folder: each skill name mapped to its files. */
async function bundle(files: Record<string, string>): Promise<string> {
  const root = path.join(dir, "bundle");
  for (const [relative, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), text);
  }
  return root;
}

describe("readBundledSkills", () => {
  it("reads every skill folder with all its files, nested ones too", async () => {
    const root = await bundle({
      "b-skill/SKILL.md": "b",
      "a-skill/SKILL.md": "a",
      "a-skill/references/more.md": "more",
    });

    const skills = await readBundledSkills(root);

    expect(
      skills.map(found => ({
        name: found.name,
        files: found.files.map(file => [file.path, file.content.toString()]),
      }))
    ).toEqual([
      {
        name: "a-skill",
        files: [
          ["references/more.md", "more"],
          ["SKILL.md", "a"],
        ],
      },
      { name: "b-skill", files: [["SKILL.md", "b"]] },
    ]);
  });

  it("refuses a folder without a SKILL.md, naming it", async () => {
    const root = await bundle({
      "a-skill/SKILL.md": "a",
      "broken/notes.md": "x",
    });

    await expect(readBundledSkills(root)).rejects.toThrow(
      /broken has no SKILL\.md.*--no-skills/
    );
  });

  it("refuses an empty bundle and a missing one", async () => {
    const empty = path.join(dir, "empty");
    await mkdir(empty);

    await expect(readBundledSkills(empty)).rejects.toThrow(/holds no skills/);
    await expect(readBundledSkills(path.join(dir, "absent"))).rejects.toThrow(
      /could not be read.*ENOENT.*--no-skills/
    );
  });
});

describe("writeAgentSkills", () => {
  const project = () => path.join(dir, "app");

  beforeEach(async () => {
    await mkdir(project());
  });

  it("writes each skill as real files into both homes, byte for byte", async () => {
    const skills = [
      skill("nextly-install"),
      {
        name: "nextly-deploy",
        files: [
          { path: "SKILL.md", content: Buffer.from("deploy") },
          { path: "references/vercel.md", content: Buffer.from("vercel") },
        ],
      },
    ];

    const report = await writeAgentSkills(project(), skills, "1.2.3");

    for (const home of AGENT_SKILL_HOMES) {
      for (const found of skills) {
        for (const file of found.files) {
          const written = await readFile(
            path.join(project(), home, found.name, file.path)
          );
          expect(written.equals(file.content)).toBe(true);
        }
      }
    }
    expect(report).toEqual({
      written: [
        ".agents/skills/nextly-install",
        ".agents/skills/nextly-deploy",
        ".claude/skills/nextly-install",
        ".claude/skills/nextly-deploy",
      ],
      changed: [],
      skipped: [],
    });
  });

  it("keeps a skill folder the project already has, in either home, and says how to update it", async () => {
    const own = path.join(project(), ".claude/skills/nextly-install");
    await mkdir(own, { recursive: true });
    await writeFile(path.join(own, "SKILL.md"), "my own version");

    const report = await writeAgentSkills(
      project(),
      [skill("nextly-install"), skill("nextly-deploy")],
      "1.2.3"
    );

    expect(await readFile(path.join(own, "SKILL.md"), "utf8")).toBe(
      "my own version"
    );
    expect(await readdir(own)).toEqual(["SKILL.md"]);
    expect(report.written).toEqual([
      ".agents/skills/nextly-install",
      ".agents/skills/nextly-deploy",
      ".claude/skills/nextly-deploy",
    ]);
    expect(report.skipped).toEqual([
      {
        path: ".claude/skills/nextly-install",
        why: expect.stringMatching(
          /already has a skill of this name.*npx skills add 'nextlyhq\/nextly#v1\.2\.3'/
        ),
      },
    ]);
  });

  it("writes nothing through a linked folder", async () => {
    const elsewhere = path.join(dir, "elsewhere");
    await mkdir(elsewhere);
    await mkdir(path.join(project(), ".claude"));
    await symlink(elsewhere, path.join(project(), ".claude/skills"));

    const report = await writeAgentSkills(
      project(),
      [skill("nextly-install")],
      "1.2.3"
    );

    expect(await readdir(elsewhere)).toEqual([]);
    expect(report.written).toEqual([".agents/skills/nextly-install"]);
    expect(report.skipped).toEqual([
      {
        path: ".claude/skills/nextly-install",
        why: expect.stringMatching(/^\.claude\/skills is a symbolic link/),
      },
    ]);
  });

  it("leaves a file where a skills folder would go", async () => {
    await writeFile(path.join(project(), ".agents"), "not a folder");

    const report = await writeAgentSkills(
      project(),
      [skill("nextly-install")],
      "1.2.3"
    );

    expect(await readFile(path.join(project(), ".agents"), "utf8")).toBe(
      "not a folder"
    );
    expect(report.skipped).toEqual([
      {
        path: ".agents/skills/nextly-install",
        why: expect.stringMatching(/^\.agents is a file, not a folder/),
      },
    ]);
  });
});

describe("describeWrittenSkills", () => {
  it("names each skill once, with the homes it went to", () => {
    expect(
      describeWrittenSkills({
        written: [
          ".agents/skills/nextly-install",
          ".agents/skills/nextly-deploy",
          ".claude/skills/nextly-install",
        ],
        changed: [],
        skipped: [],
      })
    ).toBe(
      "Added skills for coding agents to .agents/skills and .claude/skills: nextly-install, nextly-deploy"
    );
    expect(
      describeWrittenSkills({ written: [], changed: [], skipped: [] })
    ).toBeNull();
  });
});

// The command is printed by this CLI and written in two places people read;
// all three must be the one the CLI prints, or an edit to it reaches only one.
describe("the update command, wherever it is written", () => {
  it.each([
    "templates/base/AGENTS.md.template",
    "docs/guides/coding-agents.mdx",
  ])("%s gives the command the CLI prints", async file => {
    const text = await readFile(path.join(repository, file), "utf8");

    expect(text).toContain(updateSkillsCommand("<version>"));
  });
});
