import { existsSync } from "fs";
import { lstat, mkdir, readdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import type { GeneratedFiles } from "./generated-files";

/**
 * Where a project's skills go, one real copy in each. Codex reads only
 * `.agents/skills/` and Claude Code only `.claude/skills/`; Cursor and Copilot
 * read both. Copies rather than a link between them, because Git for Windows
 * checks a symbolic link out as a text file holding its target.
 */
export const AGENT_SKILL_HOMES = [".agents/skills", ".claude/skills"] as const;

/** One skill as this CLI ships it: its folder name and every file in it. */
export interface BundledSkill {
  name: string;
  /** Paths relative to the skill's folder, with their bytes. */
  files: { path: string; content: Buffer }[];
}

/**
 * The skills folder this CLI was built with. The build copies the user
 * skills of the release into it, so a project gets the text written for the
 * packages it installs, never whatever the repository's main branch says now.
 */
export function resolveSkillsPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // From dist/ in the published package, then from src/generators/ in a
  // checkout that has been built.
  for (const candidate of [
    path.resolve(here, "../skills"),
    path.resolve(here, "../../skills"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    "This copy of create-nextly-app has no skills for coding agents. Run it again with --no-skills to continue without them."
  );
}

/**
 * Reads every bundled skill into memory. It runs before anything is installed
 * or written, so a broken bundle stops the run while the project is still
 * untouched and a retry starts clean. It refuses rather than skips: a folder
 * without a SKILL.md, or a bundle with no skills, means the build went wrong.
 */
export async function readBundledSkills(
  dir: string = resolveSkillsPath()
): Promise<BundledSkill[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      throw new Error(
        `The skills for coding agents could not be read from ${dir} (${error.code ?? error.message}). Run it again with --no-skills to continue without them.`
      );
    }
  );
  const skills: BundledSkill[] = [];
  for (const entry of entries.filter(found => found.isDirectory())) {
    const files = await filesIn(path.join(dir, entry.name));
    if (!files.some(file => file.path === "SKILL.md")) {
      throw new Error(
        `The bundled skill folder ${entry.name} has no SKILL.md. Run it again with --no-skills to continue without skills.`
      );
    }
    skills.push({ name: entry.name, files });
  }
  if (skills.length === 0) {
    throw new Error(
      `${dir} holds no skills for coding agents. Run it again with --no-skills to continue without them.`
    );
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/** Every regular file under `dir`, relative to it, in a stable order. */
async function filesIn(
  dir: string,
  prefix = ""
): Promise<BundledSkill["files"]> {
  const files: BundledSkill["files"] = [];
  const entries = await readdir(path.join(dir, prefix), {
    withFileTypes: true,
  });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await filesIn(dir, relative)));
    else if (entry.isFile())
      files.push({
        path: relative,
        content: await readFile(path.join(dir, relative)),
      });
  }
  return files;
}

/**
 * The command that brings a project's skills up to `version`, for both
 * homes at once. It replaces the folders it installs, edits included, and
 * `--copy` makes it write real files into `.claude/skills/` as this CLI does,
 * where it would otherwise link them to `.agents/skills/`. The quotes keep a
 * shell from reading `#` as the start of a comment.
 */
export function updateSkillsCommand(version: string): string {
  return `npx skills add 'nextlyhq/nextly#v${version}' --skill '*' --agent claude-code codex cursor --copy -y`;
}

/**
 * Copies the skills into the project, in both homes. A skill folder the
 * project already has is left exactly as it is, since it may hold the
 * developer's own changes, and the report says how to replace it on purpose.
 * Nothing is written through a symbolic link, which could put the files
 * outside the project.
 */
export async function writeAgentSkills(
  projectRoot: string,
  skills: BundledSkill[],
  version: string
): Promise<GeneratedFiles> {
  const report: GeneratedFiles = { written: [], changed: [], skipped: [] };
  for (const home of AGENT_SKILL_HOMES) {
    for (const skill of skills) {
      const folder = `${home}/${skill.name}`;
      const blocked = await whyNotWritable(projectRoot, folder);
      if (blocked) {
        report.skipped.push({
          path: folder,
          why: `${blocked}. To replace it with this release's version, run: ${updateSkillsCommand(version)}`,
        });
        continue;
      }
      const target = path.join(projectRoot, folder);
      await mkdir(path.dirname(target), { recursive: true });
      // Not recursive, so a folder created since the check above is an error
      // here rather than a folder written into.
      await mkdir(target);
      for (const file of skill.files) {
        const filePath = path.join(target, file.path);
        await mkdir(path.dirname(filePath), { recursive: true });
        await writeFile(filePath, file.content, { flag: "wx" });
      }
      report.written.push(folder);
    }
  }
  return report;
}

/**
 * Why `folder` may not be written, or null when it may: it exists already,
 * a folder on the way to it is a symbolic link, or one is a file. Each part
 * is read with lstat, so a link is seen as a link rather than followed.
 */
async function whyNotWritable(
  projectRoot: string,
  folder: string
): Promise<string | null> {
  const parts = folder.split("/");
  for (let depth = 1; depth <= parts.length; depth++) {
    const sofar = parts.slice(0, depth).join("/");
    const entry = await lstat(path.join(projectRoot, sofar)).catch(
      (error: NodeJS.ErrnoException) => error
    );
    if (entry instanceof Error) {
      if (entry.code === "ENOENT") return null;
      // Unknown is not absent: what is there could not be seen.
      return `${sofar} cannot be read (${entry.code ?? entry.message}), so it was left as it is`;
    }
    if (entry.isSymbolicLink())
      return `${sofar} is a symbolic link, so nothing was written through it`;
    if (!entry.isDirectory())
      return `${sofar} is a file, not a folder, so it was left as it is`;
    if (depth === parts.length)
      return "the project already has a skill of this name, so it was left as it is";
  }
  return null;
}

/**
 * One line naming the skills written, in place of a line per folder: on a
 * new project every skill is written to both homes, and eight lines saying
 * so would bury the rest of the report.
 */
export function describeWrittenSkills(report: GeneratedFiles): string | null {
  if (report.written.length === 0) return null;
  const names = [
    ...new Set(report.written.map(folder => path.posix.basename(folder))),
  ];
  const homes = AGENT_SKILL_HOMES.filter(home =>
    report.written.some(folder => folder.startsWith(`${home}/`))
  );
  return `Added skills for coding agents to ${homes.join(" and ")}: ${names.join(", ")}`;
}
