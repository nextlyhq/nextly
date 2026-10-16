import path from "path";

import fs from "fs-extra";

import type { GeneratedFiles } from "./generated-files";

/**
 * Writes `text` to `relative` (a project-relative path, written with `/`)
 * only where nothing is, and records which it was.
 *
 * The file is created exclusively (`wx`), so a file the app already has, a
 * link included, is never replaced, whatever appeared since any earlier
 * check. One that is there is reported as skipped, with why and, when given,
 * what to add to it by hand.
 */
export async function writeNew(
  cwd: string,
  relative: string,
  text: string,
  files: GeneratedFiles,
  ifThere: { why: string; toAdd?: string }
): Promise<void> {
  const file = path.join(cwd, ...relative.split("/"));
  await fs.ensureDir(path.dirname(file));
  try {
    await fs.writeFile(file, text, { encoding: "utf-8", flag: "wx" });
    files.written.push(relative);
  } catch (error) {
    if ((error as { code?: string }).code !== "EEXIST") throw error;
    files.skipped.push({ path: relative, ...ifThere });
  }
}

/** A step's report before it has done anything. */
export const nothingYet = (): GeneratedFiles => ({
  written: [],
  changed: [],
  skipped: [],
});
