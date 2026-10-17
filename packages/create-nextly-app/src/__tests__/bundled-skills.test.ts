/**
 * What the build bundles into this CLI: the repository's user skills, as the
 * repository's own skill check reads them, and nothing else.
 */
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

// The check the build itself calls, from the repository's scripts.
import { userSkillSeparation } from "../../../../scripts/agent-skills.mjs";
import {
  copyBundledSkills,
  skillsToBundle,
  skillsVersion,
  skillsVersionIn,
  skillVersionOf,
} from "../lib/bundled-skills";

const repository = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../.."
);

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "nextly-bundled-skills-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A repository holding `files`, with the list the check reads given to it. */
async function repositoryWith(files: Record<string, string>) {
  for (const [relative, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, relative)), { recursive: true });
    await writeFile(path.join(dir, relative), text);
  }
  return userSkillSeparation(dir, Object.keys(files));
}

const contributor = `---\nname: helper\ndescription: For contributors.\nmetadata:\n  internal: true\n---\nContributor text.\n`;
const user = (name: string, extra = "") =>
  `---\nname: ${name}\ndescription: For people building with Nextly.${extra}\n---\nUser text for ${name}.\n`;
const readme = (...names: string[]) =>
  `| skill | use |\n| --- | --- |\n${names.map(name => `| \`${name}\` | x |`).join("\n")}\n`;

describe("skillsToBundle", () => {
  it("bundles this repository's four user skills, by name", () => {
    expect(skillsToBundle(userSkillSeparation(repository))).toEqual([
      "nextly-authentication",
      "nextly-collections",
      "nextly-deploy",
      "nextly-install",
    ]);
  });

  it("refuses a user skill marked internal rather than dropping or shipping it", async () => {
    const separation = await repositoryWith({
      ".agents/skills/helper/SKILL.md": contributor,
      "skills/README.md": readme("shown", "hidden"),
      "skills/shown/SKILL.md": user("shown"),
      "skills/hidden/SKILL.md": user("hidden", "\nmetadata:\n  internal: true"),
    });

    expect(() => skillsToBundle(separation)).toThrow(
      /skills\/hidden\/SKILL\.md is marked internal/
    );
  });

  it("is not stopped by a contributor skill's own problem", async () => {
    const separation = await repositoryWith({
      ".agents/skills/helper/SKILL.md": contributor,
      ".agents/skills/unflagged/SKILL.md": user("unflagged"),
      "skills/README.md": readme("shown"),
      "skills/shown/SKILL.md": user("shown"),
    });

    expect(separation.problems.map(found => found.path)).toContain(
      ".agents/skills/unflagged/SKILL.md"
    );
    expect(skillsToBundle(separation)).toEqual(["shown"]);
  });
});

describe("copyBundledSkills", () => {
  it("copies each named skill folder whole and drops a stale one", async () => {
    const source = path.join(dir, "skills");
    await mkdir(path.join(source, "one/references"), { recursive: true });
    await writeFile(path.join(source, "one/SKILL.md"), "one");
    await writeFile(path.join(source, "one/references/a.md"), "a");
    await writeFile(path.join(source, "README.md"), "not a skill");
    const dest = path.join(dir, "bundle");
    await mkdir(path.join(dest, "removed"), { recursive: true });
    await writeFile(path.join(dest, "removed/SKILL.md"), "old");

    copyBundledSkills(source, ["one"], dest);

    expect((await readdir(dest)).sort()).toEqual(["one"]);
    expect(await readFile(path.join(dest, "one/SKILL.md"), "utf8")).toBe("one");
    expect(await readFile(path.join(dest, "one/references/a.md"), "utf8")).toBe(
      "a"
    );
  });

  it("refuses a name with no SKILL.md before removing the old bundle", async () => {
    const source = path.join(dir, "skills");
    await mkdir(path.join(source, "empty"), { recursive: true });
    const dest = path.join(dir, "bundle");
    await mkdir(path.join(dest, "kept"), { recursive: true });

    expect(() => copyBundledSkills(source, ["empty"], dest)).toThrow(
      /has no SKILL\.md/
    );
    expect(await readdir(dest)).toEqual(["kept"]);
  });
});

const declaring = (version: string) =>
  `---\nname: x\ndescription: y\nmetadata:\n  nextly-version: ${version}\n---\nText.\n`;

describe("the release a skill was checked against", () => {
  it("is read from metadata.nextly-version, and only as one exact version", () => {
    expect(skillVersionOf(declaring("0.0.2-alpha.66"))).toBe("0.0.2-alpha.66");
    expect(skillVersionOf(declaring("^0.0.2"))).toBeNull();
    expect(skillVersionOf("---\nname: x\n---\nText.\n")).toBeNull();
    expect(skillVersionOf("No frontmatter at all.\n")).toBeNull();
  });

  it("is one release for the whole set, or the set is refused", () => {
    expect(
      skillsVersion([
        { name: "a", text: declaring("1.0.0") },
        { name: "b", text: declaring("1.0.0") },
      ])
    ).toBe("1.0.0");
    expect(() =>
      skillsVersion([
        { name: "a", text: declaring("1.0.0") },
        { name: "b", text: declaring("1.0.1") },
      ])
    ).toThrow(/different nextly releases.*a 1\.0\.0, b 1\.0\.1/);
    expect(() =>
      skillsVersion([
        { name: "a", text: declaring("1.0.0") },
        { name: "b", text: "---\nname: b\n---\n" },
      ])
    ).toThrow(/b declares no metadata\.nextly-version/);
  });

  // The build asks this of the repository's own skills, so they must agree.
  it("is declared by every skill this repository bundles", () => {
    const names = skillsToBundle(userSkillSeparation(repository));
    expect(skillsVersionIn(path.join(repository, "skills"), names)).toMatch(
      /^\d+\.\d+\.\d+/
    );
  });
});
