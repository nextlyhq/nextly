/**
 * Where agent skills live, and the copy Claude Code reads.
 *
 * Skills live once, in `.agents/skills`, the directory other agent harnesses
 * read for a repository. Claude Code reads only `.claude/skills`, so that
 * directory is a generated copy, byte for byte, never edited by hand. A
 * symbolic link would be one line instead, but Git for Windows checks links
 * out as small text files by default, and a Claude Code session in such a
 * checkout would find no skills at all.
 *
 *   node scripts/agent-skills.mjs sync   # rewrite the copy from .agents/skills
 *
 * `scripts/check-agent-contract.mjs` holds the two identical (`skillCopyDrift`)
 * and every skill loadable by every harness (`skillFrontmatterProblems`).
 */
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { load } from "js-yaml";

import { isCliEntry } from "./cli-entry.mjs";

export const SKILLS_HOME = ".agents/skills";
export const CLAUDE_COPY = ".claude/skills";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Every file under a directory, as paths relative to it, in a stable order. A
 * symbolic link is reported as one rather than followed: whether it is a link
 * is the property being checked.
 */
export function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  const walk = sub => {
    for (const entry of readdirSync(join(dir, sub))) visit(sub ? `${sub}/${entry}` : entry);
  };
  // `lstat` does not follow a link, so a link to a directory is not one here.
  const visit = path => {
    const stat = lstatSync(join(dir, path));
    if (stat.isDirectory()) walk(path);
    else out.push({ path, link: stat.isSymbolicLink() });
  };
  walk("");
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * How the Claude Code copy differs from the skills: a file missing from the
 * copy, one that differs, one in the copy that the skills do not have, and any
 * symbolic link, which a checkout with links off turns into a text file.
 *
 * Either directory being a link, or not a directory at all, is reported on its
 * own: a link at the skills' own root would otherwise be followed, and two
 * identical trees behind it would compare clean.
 *
 * @returns {{ path: string, problem: string }[]}
 */
export function skillCopyDrift(base = root) {
  const home = join(base, SKILLS_HOME);
  const copy = join(base, CLAUDE_COPY);
  const unusable = [
    { path: SKILLS_HOME, problem: rootProblem(entryAt(home), "skills are real files") },
    { path: CLAUDE_COPY, problem: rootProblem(entryAt(copy), "it must be a real copy") },
  ].filter(found => found.problem);
  if (unusable.length > 0) return unusable;
  const source = filesUnder(home);
  const copied = new Map(filesUnder(copy).map(file => [file.path, file]));
  const known = new Set(source.map(file => file.path));
  return [
    ...source.map(file => fileDrift(file, copied.get(file.path), home, copy)).filter(Boolean),
    ...[...copied.keys()].filter(path => !known.has(path)).map(path => ({ path: `${CLAUDE_COPY}/${path}`, problem: `is not in ${SKILLS_HOME}` })),
  ];
}

/** Why a directory's root cannot hold what it should, or null when it can, or is absent. */
function rootProblem(stat, rule) {
  if (stat?.isSymbolicLink()) return `is a symbolic link — ${rule}`;
  // A link checked out with links off is a small text file, not a directory.
  if (stat && !stat.isDirectory()) return `is not a directory — ${rule}`;
  return null;
}

/** How one skill file's copy falls short of it, or null when it is exact. */
function fileDrift(file, twin, home, copy) {
  if (file.link) return { path: `${SKILLS_HOME}/${file.path}`, problem: "is a symbolic link — skills are real files" };
  const problem = copyProblem(twin, () => readFileSync(join(home, file.path)).equals(readFileSync(join(copy, file.path))));
  return problem && { path: `${CLAUDE_COPY}/${file.path}`, problem };
}

/** What is wrong with one copied file, or null when it matches its skill; the bytes are read only when there is a real file to compare. */
function copyProblem(twin, matches) {
  if (!twin) return "is missing from the Claude Code copy";
  if (twin.link) return "is a symbolic link — it must be a real copy";
  return matches() ? null : `differs from ${SKILLS_HOME}`;
}

/** What is at a path, without following a link; null when nothing is, a dangling link included. */
function entryAt(path) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

/**
 * Rewrites the Claude Code copy from the skills: every file copied, anything
 * else removed. The new copy is built beside the old one and swapped in, so a
 * sync that fails part-way — the skills missing or unreadable — leaves the
 * copy Claude Code reads as it was.
 */
export function syncSkillCopy(base = root) {
  const copy = join(base, CLAUDE_COPY);
  mkdirSync(dirname(copy), { recursive: true });
  const staging = mkdtempSync(join(dirname(copy), ".skills-sync-"));
  try {
    cpSync(join(base, SKILLS_HOME), staging, { recursive: true, dereference: true });
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  rmSync(copy, { recursive: true, force: true });
  renameSync(staging, copy);
}

/**
 * Skills a harness would fail to load: a skill folder with no `SKILL.md`, and
 * a `SKILL.md` whose frontmatter does not parse as YAML, or lacks the `name`
 * and `description` every harness reads from it, or names another folder.
 *
 * @returns {{ skill: string, problem: string }[]}
 */
export function skillFrontmatterProblems(base = root) {
  const home = join(base, SKILLS_HOME);
  if (!existsSync(home)) return [];
  const folders = readdirSync(home, { withFileTypes: true }).filter(entry => entry.isDirectory());
  return folders
    .map(entry => entry.name)
    .sort()
    .flatMap(skill => skillProblems(home, skill));
}

/** What would stop a harness loading one skill folder. */
function skillProblems(home, skill) {
  const file = join(home, skill, "SKILL.md");
  if (!existsSync(file)) return [{ skill, problem: "has no SKILL.md, so no harness loads it" }];
  const { fields, problem } = frontmatter(readFileSync(file, "utf8"));
  return problem ? [{ skill, problem }] : loadProblems(skill, fields);
}

/**
 * A Markdown file's leading frontmatter, parsed as YAML, as the harnesses
 * parse it — or why it cannot be. A line that merely looks like `key: value`
 * is not evidence: `description: [` is not YAML, and a folded `>-` with no
 * text under it is an empty string.
 */
function frontmatter(text) {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!block) return { problem: "has no frontmatter" };
  const { value, problem } = parsedYaml(block[1]);
  if (problem) return { problem };
  return isMapping(value) ? { fields: value } : { problem: "has frontmatter that is not a mapping" };
}

/** A YAML text's value, or why it does not parse. */
function parsedYaml(text) {
  try {
    return { value: load(text) };
  } catch (error) {
    return { problem: `has frontmatter that is not YAML: ${error.reason ?? error.message}` };
  }
}

function isMapping(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** A field's text, or "" for anything that is not a string: a number or a list is no name. */
function textOf(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The limits the skill format sets, which the harnesses' own skill validators
 * apply: a name of 1 to 64 lowercase letters, digits and single hyphens, and
 * a description of at most 1024 characters.
 */
const NAME_FORMAT = /^(?=.{1,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_DESCRIPTION = 1024;

/** What in a skill's parsed frontmatter would stop a harness loading it. */
function loadProblems(skill, fields) {
  return [nameProblem(textOf(fields.name), skill), descriptionProblem(textOf(fields.description))]
    .filter(Boolean)
    .map(problem => ({ skill, problem }));
}

function nameProblem(name, skill) {
  if (!name) return "has no name in its frontmatter";
  if (name !== skill) return `is named "${name}", not after its folder`;
  return NAME_FORMAT.test(name) ? null : "has a name that is not 1 to 64 lowercase letters, digits and single hyphens";
}

function descriptionProblem(description) {
  if (!description) return "has no description in its frontmatter";
  return description.length > MAX_DESCRIPTION ? `has a description of ${description.length} characters, over the ${MAX_DESCRIPTION} a skill may have` : null;
}

if (isCliEntry(import.meta.url)) {
  if (process.argv[2] === "sync") {
    syncSkillCopy();
    console.log(`agent-skills: ${CLAUDE_COPY} rewritten from ${SKILLS_HOME}`);
  } else {
    console.error("usage: node scripts/agent-skills.mjs sync");
    process.exit(64);
  }
}
