import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "fs";
import path from "path";

import { parse } from "yaml";

import { EXACT_VERSION } from "./exact-version";

/**
 * What the repository's skill check reports about `skills/`, as
 * `userSkillSeparation` in scripts/agent-skills.mjs returns it. The build
 * asks that check rather than deciding for itself which skills are for
 * people building with Nextly, so there is one definition of a user skill.
 */
export interface SkillSeparation {
  /** The folder names of the skills in `skills/`. */
  user: string[];
  problems: { path: string; problem: string }[];
}

/** The folder of user skills, as the repository's skill check names it. */
const USER_SKILLS_HOME = "skills";

/**
 * The skills to bundle into this CLI: every skill in `skills/`, once the
 * check finds nothing wrong there. A problem there (a skill marked internal,
 * a frontmatter that cannot be read, a README that disagrees) stops the
 * build instead of being bundled or silently dropped, since either would put
 * into new projects something other than what `npx skills add` installs.
 * Problems with contributor skills elsewhere are the contract check's to
 * report, and do not change what ships.
 */
export function skillsToBundle(separation: SkillSeparation): string[] {
  const here = separation.problems.filter(
    found =>
      found.path === USER_SKILLS_HOME ||
      found.path.startsWith(`${USER_SKILLS_HOME}/`)
  );
  if (here.length > 0) {
    throw new Error(
      `The skills in ${USER_SKILLS_HOME}/ cannot be bundled:\n${here
        .map(found => `  ${found.path} ${found.problem}`)
        .join("\n")}`
    );
  }
  if (separation.user.length === 0) {
    throw new Error(`${USER_SKILLS_HOME}/ holds no skills to bundle.`);
  }
  return [...separation.user].sort();
}

/**
 * Replaces `dest` with a copy of each named skill folder from `source`. The
 * old copy goes first, so a skill removed from the repository does not stay
 * in the bundle.
 */
export function copyBundledSkills(
  source: string,
  names: string[],
  dest: string
): void {
  for (const name of names) {
    if (!existsSync(path.join(source, name, "SKILL.md"))) {
      throw new Error(`${path.join(source, name)} has no SKILL.md to bundle.`);
    }
  }
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  for (const name of names) {
    cpSync(path.join(source, name), path.join(dest, name), {
      recursive: true,
    });
  }
}

/**
 * The frontmatter field a skill names the `nextly` release it ships with in.
 * The release's version step stamps it (scripts/release/skills-version.mjs), so
 * the skills a CLI bundles always name that CLI's own release; a skill's
 * "Checked against" line in its body records its last hand check.
 */
export const SKILL_VERSION_FIELD = "nextly-version";

/**
 * The `nextly` release one SKILL.md says it ships with: its
 * frontmatter's `metadata.nextly-version`, when that is one exact version.
 * Null when it is missing, not exact, or the frontmatter cannot be read.
 */
export function skillVersionOf(text: string): string | null {
  const found = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (found === null) return null;
  let fields: unknown;
  try {
    fields = parse(found[1]);
  } catch {
    return null;
  }
  const metadata = (fields as { metadata?: unknown } | null)?.metadata;
  const version =
    typeof metadata === "object" && metadata !== null
      ? (metadata as Record<string, unknown>)[SKILL_VERSION_FIELD]
      : undefined;
  return typeof version === "string" && EXACT_VERSION.test(version)
    ? version
    : null;
}

/**
 * The one release a set of skills ships with, from each SKILL.md's
 * own declaration. It refuses a skill that declares none and skills that
 * disagree: the release decides which projects get them, so a guess would
 * hand some project instructions for APIs it does not have.
 */
export function skillsVersion(
  skills: { name: string; text: string }[]
): string {
  const versions = skills.map(skill => ({
    name: skill.name,
    version: skillVersionOf(skill.text),
  }));
  const missing = versions.filter(entry => entry.version === null);
  if (missing.length > 0) {
    throw new Error(
      `${missing.map(entry => entry.name).join(", ")} declare${missing.length === 1 ? "s" : ""} no metadata.${SKILL_VERSION_FIELD}: the exact nextly release the skill was checked against.`
    );
  }
  const distinct = [...new Set(versions.map(entry => entry.version))];
  if (distinct.length !== 1) {
    throw new Error(
      `The skills were checked against different nextly releases (${versions.map(entry => `${entry.name} ${entry.version}`).join(", ")}); re-check them against one.`
    );
  }
  return distinct[0] as string;
}

/** The release of the skills named in `source`, read from their SKILL.md files. */
export function skillsVersionIn(source: string, names: string[]): string {
  return skillsVersion(
    names.map(name => ({
      name,
      text: readFileSync(path.join(source, name, "SKILL.md"), "utf8"),
    }))
  );
}
