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
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
 * @returns {{ path: string, problem: string }[]}
 */
export function skillCopyDrift(base = root) {
  const home = join(base, SKILLS_HOME);
  const copy = join(base, CLAUDE_COPY);
  const unusable = copyRootProblem(entryAt(copy));
  if (unusable) return [{ path: CLAUDE_COPY, problem: unusable }];
  const source = filesUnder(home);
  const copied = new Map(filesUnder(copy).map(file => [file.path, file]));
  const known = new Set(source.map(file => file.path));
  return [
    ...source.map(file => fileDrift(file, copied.get(file.path), home, copy)).filter(Boolean),
    ...[...copied.keys()].filter(path => !known.has(path)).map(path => ({ path: `${CLAUDE_COPY}/${path}`, problem: `is not in ${SKILLS_HOME}` })),
  ];
}

/** Why the copy's root cannot hold a copy at all, or null when it can. */
function copyRootProblem(stat) {
  if (stat?.isSymbolicLink()) return "is a symbolic link — it must be a real copy";
  // A link checked out with links off is a small text file, not a directory.
  if (stat && !stat.isDirectory()) return "is not a directory — it must be a real copy";
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

/** Rewrites the Claude Code copy from the skills: every file copied, anything else removed. */
export function syncSkillCopy(base = root) {
  const copy = join(base, CLAUDE_COPY);
  rmSync(copy, { recursive: true, force: true });
  mkdirSync(copy, { recursive: true });
  cpSync(join(base, SKILLS_HOME), copy, { recursive: true, dereference: true });
}

/**
 * Skills a harness would fail to load: a `SKILL.md` without the `name` and
 * `description` that every harness reads from its frontmatter, or
 * whose `name` is not its folder's.
 *
 * @returns {{ skill: string, problem: string }[]}
 */
export function skillFrontmatterProblems(base = root) {
  const home = join(base, SKILLS_HOME);
  if (!existsSync(home)) return [];
  return readdirSync(home)
    .sort()
    .filter(skill => existsSync(join(home, skill, "SKILL.md")))
    .flatMap(skill => loadProblems(skill, frontmatter(readFileSync(join(home, skill, "SKILL.md"), "utf8"))));
}

/** The `key: value` fields of a Markdown file's leading frontmatter block. */
function frontmatter(text) {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
  return new Map(
    block
      .split(/\r?\n/)
      .map(line => /^([a-z]+):\s*(.*)$/.exec(line))
      .filter(Boolean)
      .map(match => [match[1], match[2].trim()])
  );
}

/** What in a skill's frontmatter would stop a harness loading it. */
function loadProblems(skill, fields) {
  const name = fields.get("name");
  const problems = [];
  if (!name) problems.push({ skill, problem: "has no name in its frontmatter" });
  else if (name !== skill) problems.push({ skill, problem: `is named "${name}", not after its folder` });
  if (!fields.get("description")) problems.push({ skill, problem: "has no description in its frontmatter" });
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "sync") {
    syncSkillCopy();
    console.log(`agent-skills: ${CLAUDE_COPY} rewritten from ${SKILLS_HOME}`);
  } else {
    console.error("usage: node scripts/agent-skills.mjs sync");
    process.exit(64);
  }
}
