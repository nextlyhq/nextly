import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { checkCommand, releaseVersion, skillsVersionMismatches, stampSkills } from "./skills-version.mjs";

let base;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "skills-version-"));
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

/** A user skill as `skills/` holds one: its release in the frontmatter, and a line of prose naming a release too. */
function skillText(name, version) {
  const field = version === null ? "" : `metadata:\n  nextly-version: ${version}\n`;
  return `---\nname: ${name}\ndescription: when ${name} applies\n${field}---\n\n# ${name}\n\nChecked against \`nextly\` 0.0.2-alpha.67 with Next.js 16.4.\n`;
}

/** A git repository with user skills listed in skills/README.md, and create-nextly-app at `cliVersion`. */
function repository(skills, cliVersion = "0.0.2-alpha.69") {
  execFileSync("git", ["init", "-q"], { cwd: base });
  mkdirSync(join(base, "skills"), { recursive: true });
  const rows = Object.keys(skills).map(name => `| \`${name}\` | what it covers |`).join("\n");
  writeFileSync(join(base, "skills/README.md"), `# Skills\n\n| Skill | What it covers |\n| --- | --- |\n${rows}\n`);
  for (const [name, version] of Object.entries(skills)) {
    mkdirSync(join(base, "skills", name), { recursive: true });
    writeFileSync(join(base, "skills", name, "SKILL.md"), skillText(name, version));
  }
  // A contributor skill: never stamped, since it does not ship to projects.
  mkdirSync(join(base, ".agents/skills/contrib"), { recursive: true });
  writeFileSync(join(base, ".agents/skills/contrib/SKILL.md"), `---\nname: contrib\ndescription: when contributing\nmetadata:\n  internal: true\n---\n\nThe contributor procedure.\n`);
  mkdirSync(join(base, "packages/create-nextly-app"), { recursive: true });
  writeFileSync(join(base, "packages/create-nextly-app/package.json"), JSON.stringify({ name: "create-nextly-app", version: cliVersion }));
}

const read = name => readFileSync(join(base, "skills", name, "SKILL.md"), "utf8");

describe("the release the bundled skills are stamped with", () => {
  it("is create-nextly-app's version, the package that bundles them", () => {
    repository({ "nextly-install": "0.0.2-alpha.67" });
    expect(releaseVersion(base)).toBe("0.0.2-alpha.69");
  });

  it("is written into every user skill, and nothing else in the file changes", () => {
    repository({ "nextly-install": "0.0.2-alpha.67", "nextly-deploy": "0.0.2-alpha.67" });

    expect(stampSkills(base)).toEqual(["skills/nextly-deploy/SKILL.md", "skills/nextly-install/SKILL.md"]);

    expect(read("nextly-install")).toBe(skillText("nextly-install", "0.0.2-alpha.69"));
    expect(read("nextly-deploy")).toBe(skillText("nextly-deploy", "0.0.2-alpha.69"));
    expect(readFileSync(join(base, ".agents/skills/contrib/SKILL.md"), "utf8")).not.toContain("nextly-version");
  });

  it("changes nothing on a second run", () => {
    repository({ "nextly-install": "0.0.2-alpha.67" });
    stampSkills(base);

    expect(stampSkills(base)).toEqual([]);
  });

  it("refuses a skill that names no release, rather than leave it out of new projects in silence", () => {
    repository({ "nextly-install": "0.0.2-alpha.67", "nextly-new": null });

    expect(() => stampSkills(base)).toThrow(/skills\/nextly-new\/SKILL\.md.*nextly-version/);
    // Every file is checked before any is written.
    expect(read("nextly-install")).toBe(skillText("nextly-install", "0.0.2-alpha.67"));
  });
});

describe("the guard on a release's skills", () => {
  it("names each skill stamped with another release than create-nextly-app's", () => {
    repository({ "nextly-install": "0.0.2-alpha.69", "nextly-deploy": "0.0.2-alpha.67" });

    expect(skillsVersionMismatches(base)).toEqual([{ path: "skills/nextly-deploy/SKILL.md", version: "0.0.2-alpha.67" }]);
  });

  it("names a skill that names no release", () => {
    repository({ "nextly-install": null });

    expect(skillsVersionMismatches(base)).toEqual([{ path: "skills/nextly-install/SKILL.md", version: null }]);
  });

  it("fails the check on a mismatch, saying which skill and both releases", () => {
    repository({ "nextly-install": "0.0.2-alpha.67" });
    const errors = [];

    expect(checkCommand(base, { log: () => {}, error: message => errors.push(message) })).toBe(1);
    expect(errors.join("\n")).toContain("skills/nextly-install/SKILL.md");
    expect(errors.join("\n")).toContain("0.0.2-alpha.67");
    expect(errors.join("\n")).toContain("0.0.2-alpha.69");
  });

  it("passes the check once the skills are stamped", () => {
    repository({ "nextly-install": "0.0.2-alpha.67" });
    stampSkills(base);

    expect(checkCommand(base, { log: () => {}, error: () => {} })).toBe(0);
  });
});

describe("the version step", () => {
  it("stamps the skills, then checks them, before the lockfile is refreshed", () => {
    // The Version PR is the version step's output: without these two steps in
    // it, a release ships skills stamped with the one before, and nothing fails.
    const script = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).scripts["release:version"];
    const steps = script.split("&&").map(step => step.trim());

    const at = step => steps.indexOf(step);
    expect(at("changeset version")).toBe(0);
    expect(at("node scripts/release/skills-version.mjs stamp")).toBe(1);
    expect(at("node scripts/release/skills-version.mjs check")).toBe(2);
    expect(at("pnpm install --no-frozen-lockfile")).toBeGreaterThan(2);
  });
});
