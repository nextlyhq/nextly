/**
 * The skills a new or existing app is given for coding agents: read from the
 * CLI's own bundle, written as real files into both homes agents read, and
 * never over a skill folder the project already has.
 */
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
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
  bundledSkillsVersionOrNull,
  projectNextlyVersion,
  readBundledSkills,
  skillsVersionMismatch,
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
    files: [{ path: "SKILL.md", content: Buffer.from(text), mode: 0o644 }],
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

describe("bundledSkillsVersionOrNull", () => {
  const declaring = (version: string): string =>
    `---\nname: x\nmetadata:\n  nextly-version: ${version}\n---\n`;

  it("is the one release every bundled skill declares", async () => {
    const root = await bundle({
      "a-skill/SKILL.md": declaring("0.0.2-alpha.70"),
      "b-skill/SKILL.md": declaring("0.0.2-alpha.70"),
    });
    expect(bundledSkillsVersionOrNull(root)).toBe("0.0.2-alpha.70");
  });

  // The guide then offers no restore, rather than one tied to a guess.
  it("is null for skills that disagree, and for a missing bundle", async () => {
    const root = await bundle({
      "a-skill/SKILL.md": declaring("0.0.2-alpha.70"),
      "b-skill/SKILL.md": declaring("0.0.2-alpha.71"),
    });
    expect(bundledSkillsVersionOrNull(root)).toBeNull();
    expect(bundledSkillsVersionOrNull(path.join(dir, "absent"))).toBeNull();
  });
});

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

  // A skill may ship a helper script its instructions run directly, so the
  // executable bit travels with the bytes.
  // Windows has no Unix permission bits to keep: it reports 0o666 whatever
  // was set, so these two run only where the bits exist.
  it.skipIf(process.platform === "win32")(
    "keeps each file's mode, an executable script's included",
    async () => {
      const root = await bundle({
        "a-skill/SKILL.md": "a",
        "a-skill/scripts/run.sh": "#!/bin/sh\n",
      });
      await chmod(path.join(root, "a-skill/scripts/run.sh"), 0o755);
      const project = path.join(dir, "app");
      await mkdir(project);

      await writeAgentSkills(project, await readBundledSkills(root), "1.2.3");

      for (const home of AGENT_SKILL_HOMES) {
        const mode = (
          await stat(path.join(project, home, "a-skill/scripts/run.sh"))
        ).mode;
        expect(mode & 0o777).toBe(0o755);
      }
    }
  );

  // A restrictive umask filters the mode a file is created with, so the
  // bits are applied again after the write.
  it.skipIf(process.platform === "win32")(
    "keeps an executable script executable under a umask that strips it",
    async () => {
      const root = await bundle({
        "a-skill/SKILL.md": "a",
        "a-skill/scripts/run.sh": "#!/bin/sh\n",
      });
      await chmod(path.join(root, "a-skill/scripts/run.sh"), 0o755);
      const skills = await readBundledSkills(root);
      const project = path.join(dir, "app");
      await mkdir(project);

      // Strips group and other execute; owner execute stays, so folders
      // remain usable, as any working umask leaves them.
      const before = process.umask(0o011);
      try {
        await writeAgentSkills(project, skills, "1.2.3");
      } finally {
        process.umask(before);
      }

      const mode = (
        await stat(path.join(project, ".agents/skills/a-skill/scripts/run.sh"))
      ).mode;
      expect(mode & 0o777).toBe(0o755);
    }
  );

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
          { path: "SKILL.md", content: Buffer.from("deploy"), mode: 0o644 },
          {
            path: "references/vercel.md",
            content: Buffer.from("vercel"),
            mode: 0o644,
          },
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

// The command is printed by this CLI and written in two places people read;
// all three must be the one the CLI prints, or an edit to it reaches only one.
describe("the update command, wherever it is written", () => {
  // The guide's version is the scaffold's release, filled in at copy time; the
  // docs page leaves it for the reader to fill.
  it.each([
    ["templates/base/AGENTS.md.template", "{{skillsTag}}"],
    ["docs/guides/coding-agents.mdx", "<version>"],
  ])("%s gives the command the CLI prints", async (file, version) => {
    const text = await readFile(path.join(repository, file), "utf8");

    expect(text).toContain(updateSkillsCommand(version));
  });
});

describe("projectNextlyVersion", () => {
  const app = () => path.join(dir, "app");
  const write = async (file: string, value: unknown) => {
    await mkdir(path.dirname(path.join(app(), file)), { recursive: true });
    await writeFile(path.join(app(), file), JSON.stringify(value));
  };

  it("reads the installed package first", async () => {
    await write("package.json", { dependencies: { nextly: "1.0.0" } });
    await write("node_modules/nextly/package.json", { version: "1.2.3" });

    expect(await projectNextlyVersion(app())).toBe("1.2.3");
  });

  it("reads an exact version the project declares, before an install", async () => {
    await write("package.json", {
      devDependencies: { nextly: "0.0.2-alpha.9" },
    });

    expect(await projectNextlyVersion(app())).toBe("0.0.2-alpha.9");
  });

  it("reads a package a workspace hoisted to a folder above", async () => {
    await write("package.json", { dependencies: { nextly: "^1.2.3" } });
    await mkdir(path.join(dir, "node_modules/nextly"), { recursive: true });
    await writeFile(
      path.join(dir, "node_modules/nextly/package.json"),
      JSON.stringify({ version: "1.2.3" })
    );

    expect(await projectNextlyVersion(app())).toBe("1.2.3");
  });

  it("names no release for a range, a dist-tag, or nothing at all", async () => {
    expect(await projectNextlyVersion(app())).toBeNull();
    await write("package.json", { dependencies: { nextly: "^1.2.3" } });
    expect(await projectNextlyVersion(app())).toBeNull();
    await write("package.json", { dependencies: { nextly: "latest" } });
    expect(await projectNextlyVersion(app())).toBeNull();
  });
});

describe("skillsVersionMismatch", () => {
  it("allows the skills only on their own release", () => {
    expect(skillsVersionMismatch("1.2.3", "1.2.3")).toBeNull();
    expect(skillsVersionMismatch("1.2.2", "1.2.3")).toMatch(
      /nextly 1\.2\.2.*written for 1\.2\.3.*nextlyhq\.com\/docs\/guides\/coding-agents/
    );
    expect(skillsVersionMismatch(null, "1.2.3")).toMatch(/could not be told/);
  });
});

describe("a skill that cannot be written whole", () => {
  it("leaves no folder behind for a retry to mistake for the developer's", async () => {
    const project = path.join(dir, "app");
    await mkdir(project);
    // `notes` is written as a file, so `notes/more.md` cannot be.
    const broken = {
      name: "nextly-install",
      files: [
        { path: "SKILL.md", content: Buffer.from("install"), mode: 0o644 },
        { path: "notes", content: Buffer.from("a file"), mode: 0o644 },
        { path: "notes/more.md", content: Buffer.from("more"), mode: 0o644 },
      ],
    };

    await expect(
      writeAgentSkills(project, [broken], "1.2.3")
    ).rejects.toThrow();

    expect(await readdir(path.join(project, ".agents/skills"))).toEqual([]);
  });
});
