/**
 * File system utilities - wrappers around fs-extra for convenience
 */
import path from "path";

import fs from "fs-extra";

export async function ensureDir(path: string): Promise<void> {
  return fs.ensureDir(path);
}

/**
 * Return true when `dir` exists and contains at least one entry other than
 * `.git`. `.git` is intentionally ignored so scaffolding into a freshly
 * `git init`-ed directory still counts as empty — mirrors create-vite.
 *
 * Hidden files (other than `.git`) DO count as non-empty so we don't
 * silently overlay onto a directory the user forgot was populated.
 */
export async function isDirectoryNotEmpty(dir: string): Promise<boolean> {
  if (!(await fs.pathExists(dir))) return false;
  const entries = await fs.readdir(dir);
  return entries.some(entry => entry !== ".git");
}

/**
 * Remove every entry inside `dir` except `.git`. Matches create-vite's
 * `emptyDir` so a user who already ran `git init` keeps their history
 * when they pick "Remove existing files and continue".
 *
 * The directory itself is left in place; no-ops if it doesn't exist.
 */
export async function emptyDirectory(dir: string): Promise<void> {
  if (!(await fs.pathExists(dir))) return;
  for (const entry of await fs.readdir(dir)) {
    if (entry === ".git") continue;
    await fs.remove(path.join(dir, entry));
  }
}

export async function pathExists(path: string): Promise<boolean> {
  return fs.pathExists(path);
}

export async function readJson<T = unknown>(file: string): Promise<T> {
  return fs.readJson(file) as Promise<T>;
}

export async function writeFile(
  file: string,
  data: string,
  encoding?: BufferEncoding
): Promise<void> {
  return fs.writeFile(file, data, encoding);
}

export async function appendFile(
  file: string,
  data: string,
  encoding?: BufferEncoding
): Promise<void> {
  return fs.appendFile(file, data, encoding);
}

export async function readFile(
  file: string,
  encoding: BufferEncoding
): Promise<string> {
  return fs.readFile(file, encoding);
}
