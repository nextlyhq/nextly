import { cpSync, existsSync, mkdirSync, rmSync } from "fs";
import path from "path";

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
