import { existsSync, readdirSync } from "fs";
import {
  chmod,
  lstat,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import { skillsVersion, skillsVersionIn } from "../lib/bundled-skills";
import { EXACT_VERSION } from "../lib/exact-version";
import { installedVersion } from "../lib/nextly-release";

import type { GeneratedFiles } from "./generated-files";

/**
 * Where a project's skills go, one real copy in each. OpenAI's coding agent
 * reads only `.agents/skills/` and Claude Code only `.claude/skills/`; Cursor
 * and Copilot read both. Copies rather than a link between them, because Git for Windows
 * checks a symbolic link out as a text file holding its target.
 */
export const AGENT_SKILL_HOMES = [".agents/skills", ".claude/skills"] as const;

/** One skill as this CLI ships it: its folder name and every file in it. */
export interface BundledSkill {
  name: string;
  /** Paths relative to the skill's folder, with their bytes. */
  /**
   * Paths relative to the skill's folder, with their bytes and permission
   * bits: a helper script a skill runs directly must stay executable.
   */
  files: { path: string; content: Buffer; mode: number }[];
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
        mode: (await stat(path.join(dir, relative))).mode & 0o777,
      });
  }
  return files;
}

/**
 * The release the bundled skills ship with, from their own
 * frontmatter. Read with the bundle, before anything is written, so a bundle
 * that declares none, or disagrees with itself, stops the run untouched.
 */
export function bundledSkillsVersion(skills: BundledSkill[]): string {
  return skillsVersion(
    skills.map(skill => ({
      name: skill.name,
      text:
        skill.files
          .find(file => file.path === "SKILL.md")
          ?.content.toString("utf8") ?? "",
    }))
  );
}

/**
 * The release the bundled skills declare, for the agent guide: the skills at
 * this CLI's own tag are these same files, so this is the release that tag's
 * skills were written for. Null when this copy carries no readable bundle,
 * which leaves the guide nothing to offer a restore against; a scaffold run
 * with --no-skills from such a copy must still succeed.
 */
export function bundledSkillsVersionOrNull(dir?: string): string | null {
  try {
    const skillsDir = dir ?? resolveSkillsPath();
    const names = readdirSync(skillsDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);
    return skillsVersionIn(skillsDir, names);
  } catch {
    return null;
  }
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
 * The `nextly` version the project has: the installed package's, or, before
 * an install, an exact version its package.json names. Null when neither
 * says, since a range or a dist-tag names no one release.
 */
export async function projectNextlyVersion(
  projectRoot: string
): Promise<string | null> {
  // The nextly the project loads, found as the version guard finds it.
  const installed = await installedVersion(projectRoot, "nextly");
  if (installed !== undefined) return installed;
  const manifest = await readJson(path.join(projectRoot, "package.json"));
  for (const field of ["dependencies", "devDependencies"] as const) {
    const declared = (manifest?.[field] as Record<string, unknown> | undefined)
      ?.nextly;
    if (typeof declared === "string" && EXACT_VERSION.test(declared)) {
      return declared;
    }
  }
  return null;
}

/** A JSON file's object, or null when it is missing or not an object. */
async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = JSON.parse(await readFile(file, "utf8"));
    return typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Why the bundled skills may not be written into a project with `nextly` at
 * `projectVersion`, or null when they may. They ship with the release this
 * CLI belongs to, and a project on another release, or one
 * whose release cannot be told, could be handed instructions for APIs it does
 * not have. No install command is given: the right one depends on whether
 * that release publishes skills at all, which the docs page says.
 */
export function skillsVersionMismatch(
  projectVersion: string | null,
  skillsVersion: string
): string | null {
  if (projectVersion === skillsVersion) return null;
  const has =
    projectVersion === null
      ? "which Nextly release this project uses could not be told"
      : `this project has nextly ${projectVersion}`;
  return `No skills for coding agents were added: ${has}, and the skills this create-nextly-app carries were written for ${skillsVersion}. To add skills that match, see ${SKILLS_DOCS}`;
}

/** The docs page on the skills, which says how to add them for a release. */
const SKILLS_DOCS = "https://nextlyhq.com/docs/guides/coding-agents";

/**
 * Copies the skills into the project, in both homes. A skill folder the
 * project already has is left exactly as it is, since it may hold the
 * developer's own changes, and the report says how to replace it on purpose:
 * from `releaseTag`, the release whose tag publishes this bundle. Nothing is
 * written through a symbolic link, which could put the files outside the
 * project.
 */
export async function writeAgentSkills(
  projectRoot: string,
  skills: BundledSkill[],
  releaseTag: string
): Promise<GeneratedFiles> {
  const report: GeneratedFiles = { written: [], changed: [], skipped: [] };
  for (const home of AGENT_SKILL_HOMES) {
    for (const skill of skills) {
      const folder = `${home}/${skill.name}`;
      const blocked = await whyNotWritable(projectRoot, folder);
      if (blocked) {
        report.skipped.push({
          path: folder,
          why: `${blocked}. To replace it with this release's version, run: ${updateSkillsCommand(releaseTag)} (if that release's tag is not published yet, ${SKILLS_DOCS} says how to add skills for any release)`,
        });
        continue;
      }
      const target = path.join(projectRoot, folder);
      await mkdir(path.dirname(target), { recursive: true });
      // Not recursive, so a folder created since the check above is an error
      // here rather than a folder written into.
      await mkdir(target);
      try {
        for (const file of skill.files) {
          const filePath = path.join(target, file.path);
          await mkdir(path.dirname(filePath), { recursive: true });
          await writeFile(filePath, file.content, { flag: "wx" });
          // After the write, since a creation mode passes through the
          // process's umask and can lose an executable bit on the way.
          await chmod(filePath, file.mode);
        }
      } catch (error) {
        // The folder is this run's own, made just above. Left half-written,
        // a retry would take it for the developer's skill and keep it.
        await rm(target, { recursive: true, force: true });
        throw error;
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
