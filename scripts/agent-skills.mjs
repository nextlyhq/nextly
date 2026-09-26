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
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
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
  const problem = copyProblem(twin, () => difference(join(home, file.path), join(copy, file.path)));
  return problem && { path: `${CLAUDE_COPY}/${file.path}`, problem };
}

/** What is wrong with one copied file, or null when it matches its skill; the file is read only when there is a real one to compare. */
function copyProblem(twin, differs) {
  if (!twin) return "is missing from the Claude Code copy";
  if (twin.link) return "is a symbolic link — it must be a real copy";
  return differs();
}

const POSIX = process.platform !== "win32";

/**
 * How a copied file differs from its skill, or null when it does not: in its
 * bytes, or on POSIX in whether it is executable, which git records with the
 * file and a script a skill runs depends on.
 */
function difference(source, copied) {
  if (!readFileSync(source).equals(readFileSync(copied))) return `differs from ${SKILLS_HOME}`;
  return POSIX && executable(source) !== executable(copied) ? `differs from ${SKILLS_HOME} in whether it is executable` : null;
}

/** Whether a file is executable as git records it: by its owner's execute bit. */
function executable(path) {
  return (statSync(path).mode & 0o100) !== 0;
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
 * How a sync names what it puts beside the copy Claude Code reads: its staging
 * copy, `.skills-sync-<process ID>-<random>`, and the old copy it sets aside,
 * which is the staging name plus `-old`. The process ID tells a copy another
 * sync is still using from one a sync left behind.
 */
const STAGING_PREFIX = ".skills-sync-";

/** The process that made a copy, read from its name, or null for a name that carries none. */
function maker(name) {
  const found = /^\.skills-sync-(\d+)-/.exec(name);
  const pid = found ? Number(found[1]) : 0;
  return pid > 0 ? pid : null;
}

/**
 * Whether a process is running. Signal 0 checks without signalling; EPERM
 * means the process exists but belongs to another user.
 */
function running(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/** Whether a copy belongs to another sync that is still running, and so is in use rather than left behind. */
function inUseByAnother(name) {
  const pid = maker(name);
  return pid !== null && pid !== process.pid && running(pid);
}

/**
 * What syncs left beside the copy Claude Code reads: a staging copy or an old
 * copy set aside, which nothing but a sync makes, less any another sync is
 * still using. `.claude/` is git-ignored, so neither git nor the contract check
 * would show one.
 */
function leftoverCopies(base = root) {
  const home = dirname(join(base, CLAUDE_COPY));
  if (!existsSync(home)) return [];
  return readdirSync(home)
    .filter(name => name.startsWith(STAGING_PREFIX) && !inUseByAnother(name))
    .sort()
    .map(name => join(home, name));
}

/**
 * Rewrites the Claude Code copy from the skills: every file copied, with its
 * mode, and anything else removed. The new copy is built beside the old one
 * and swapped in, so a sync that fails part-way — the skills missing or
 * unreadable, or the swap itself refused — leaves the copy Claude Code reads
 * as it was, and nothing beside it.
 *
 * Once the new copy is in place the sync has done its work, and failing to
 * remove the old copy it set aside does not undo that. So that failure is
 * returned as `leftover`, naming what is left and why, for the caller to
 * report, rather than thrown as if the swap had failed.
 *
 * `rename` and `remove` are the moves the swap makes, replaceable so a test
 * can refuse either.
 *
 * @returns {{ leftover: null | { path: string, error: Error } }}
 */
export function syncSkillCopy(base = root, { rename = renameSync, remove = rmSync } = {}) {
  const copy = join(base, CLAUDE_COPY);
  mkdirSync(dirname(copy), { recursive: true });
  const staging = mkdtempSync(join(dirname(copy), `${STAGING_PREFIX}${process.pid}-`));
  try {
    cpSync(join(base, SKILLS_HOME), staging, { recursive: true, dereference: true });
    return { leftover: swapIn(staging, copy, { rename, remove }) };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/**
 * Puts the new copy where the old one is. The old one is moved aside first
 * and removed only once the new one is in place; if the new one cannot be
 * moved in, the old one is moved back. Returns the old copy when it could not
 * be removed, and null otherwise.
 */
function swapIn(staging, copy, { rename, remove }) {
  if (!entryAt(copy)) {
    rename(staging, copy);
    return null;
  }
  const aside = `${staging}-old`;
  rename(copy, aside);
  try {
    rename(staging, copy);
  } catch (error) {
    rename(aside, copy);
    throw error;
  }
  return removed(aside, remove);
}

/** Removes the old copy once the new one is in place: null when it is gone, or what is left and why. */
function removed(aside, remove) {
  try {
    remove(aside, { recursive: true, force: true });
    return null;
  } catch (error) {
    return { path: aside, error };
  }
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

/**
 * The sync as a command, and its exit status. The new copy is kept either
 * way, since it is right; but every copy a sync left beside it — the old copy
 * this run could not remove, or one an earlier run left — is named for
 * deletion and fails the command, so no caller takes the sync as clean while
 * old copies pile up beside the one Claude Code reads. A retry succeeds only
 * once they are gone.
 */
export function syncCommand(base = root, moves = {}, { log = console.log, error = console.error } = {}) {
  const { leftover } = syncSkillCopy(base, moves);
  log(`agent-skills: ${CLAUDE_COPY} rewritten from ${SKILLS_HOME}`);
  const problems = leftoverProblems(base, leftover);
  for (const problem of problems) error(`agent-skills: ${problem}`);
  return problems.length > 0 ? 1 : 0;
}

/**
 * What to say about each copy a sync left beside the one Claude Code reads:
 * the old copy this run could not remove, with why, or one another run left.
 * Both come from the one listing of what is there.
 */
function leftoverProblems(base, leftover) {
  return leftoverCopies(base).map(path =>
    path === leftover?.path
      ? `the old copy set aside at ${relative(base, path)} could not be removed (${leftover.error.message}); delete it, then sync again`
      : `${relative(base, path)} was left by another sync; delete it, then sync again`
  );
}

if (isCliEntry(import.meta.url)) {
  if (process.argv[2] === "sync") {
    process.exitCode = syncCommand();
  } else {
    console.error("usage: node scripts/agent-skills.mjs sync");
    process.exit(64);
  }
}
