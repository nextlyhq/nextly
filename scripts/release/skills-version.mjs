// The skills people building with Nextly install (`skills/`) each name the
// nextly release they ship with, in their frontmatter's
// `metadata.nextly-version`. create-nextly-app bundles them and writes them
// into a new project only when that is exactly the project's release, so a
// stamp left behind by one release leaves every project of the next without
// skills, with nothing failing anywhere.
//
// So the stamp is not edited by hand. The version step stamps every user
// skill with the release being cut (`stamp`), and the guard (`check`) refuses
// a skill stamped with any other release: run straight after stamping, so the
// Version PR cannot be opened with a stale stamp, and again by the release's
// preflight, before anything is published.
//
// Exit codes for `check`: 0 = every skill names the release, 1 = one does not.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { frontmatter, USER_SKILLS_HOME, userSkillSeparation } from "../agent-skills.mjs";
import { isCliEntry } from "../cli-entry.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The frontmatter field a skill names its release in. */
const SKILL_VERSION_FIELD = "nextly-version";

/** The package that bundles the skills, whose version is the release they ship with. */
const BUNDLING_PACKAGE = "packages/create-nextly-app/package.json";

/** The release the skills ship with: the version of create-nextly-app, which bundles them. */
export function releaseVersion(base = root) {
  return JSON.parse(readFileSync(join(base, BUNDLING_PACKAGE), "utf8")).version;
}

/**
 * Each user skill's SKILL.md, with the release it names, or null when it names
 * none. The user skills are the repository's own definition of them
 * (`userSkillSeparation`), so a contributor skill is never stamped.
 */
function stampedVersions(base) {
  return userSkillSeparation(base).user.map(name => {
    const path = `${USER_SKILLS_HOME}/${name}/SKILL.md`;
    return { path, version: versionNamedIn(readFileSync(join(base, path), "utf8")) };
  });
}

/** The release a SKILL.md names in `metadata.nextly-version`, or null when it names none. */
function versionNamedIn(text) {
  const version = metadataOf(text)[SKILL_VERSION_FIELD];
  return typeof version === "string" ? version : null;
}

/** A SKILL.md's `metadata` mapping, or an empty one when it has none. */
function metadataOf(text) {
  const metadata = frontmatter(text).fields?.metadata;
  return metadata !== null && typeof metadata === "object" ? metadata : {};
}

/** The user skills that name another release than `version`, or none. */
export function skillsVersionMismatches(base = root, version = releaseVersion(base)) {
  return stampedVersions(base).filter(found => found.version !== version);
}

/** The `nextly-version:` line inside a SKILL.md's frontmatter, as the text before the value and the value. */
const STAMP_LINE = new RegExp(`^(\\s+${SKILL_VERSION_FIELD}:[ \\t]*)(\\S[^\\n]*?)[ \\t]*$`, "m");

/**
 * Stamps every user skill with `version`, changing nothing else in the file,
 * and returns the paths it rewrote. A skill with no stamp to rewrite is
 * refused before any file is written: adding one by guesswork would put the
 * field somewhere the frontmatter does not expect it.
 */
export function stampSkills(base = root, version = releaseVersion(base)) {
  const edits = stampedVersions(base).map(({ path }) => {
    const text = readFileSync(join(base, path), "utf8");
    const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    if (!block || !STAMP_LINE.test(block[1])) {
      throw new Error(`${path} has no metadata.${SKILL_VERSION_FIELD} to stamp: add the field, naming the release the skill was written for.`);
    }
    const stamped = block[1].replace(STAMP_LINE, `$1${version}`);
    return { path, text, next: text.replace(block[1], stamped) };
  });
  const changed = edits.filter(edit => edit.next !== edit.text);
  for (const edit of changed) writeFileSync(join(base, edit.path), edit.next);
  return changed.map(edit => edit.path);
}

/** Runs the guard: 0 when every user skill names the release, 1 when one does not. */
export function checkCommand(base = root, { log = console.log, error = console.error } = {}) {
  const version = releaseVersion(base);
  const mismatches = skillsVersionMismatches(base, version);
  if (mismatches.length === 0) {
    log(`skills-version: every skill names ${version}`);
    return 0;
  }
  for (const { path, version: named } of mismatches) {
    error(`skills-version: ${path} names ${named ?? `no metadata.${SKILL_VERSION_FIELD}`}, but this release is ${version}`);
  }
  error("skills-version: create-nextly-app writes these skills only into projects on the release they name; run `node scripts/release/skills-version.mjs stamp`");
  return 1;
}

if (isCliEntry(import.meta.url)) {
  const command = process.argv[2];
  if (command === "stamp") {
    const changed = stampSkills();
    console.log(`skills-version: stamped ${changed.length} skill(s) with ${releaseVersion()}${changed.length > 0 ? `: ${changed.join(", ")}` : ""}`);
  } else if (command === "check") {
    process.exitCode = checkCommand();
  } else {
    console.error("usage: node scripts/release/skills-version.mjs stamp|check");
    process.exit(64);
  }
}
