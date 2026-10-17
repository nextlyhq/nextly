import path from "path";

import fs from "fs-extra";

import type { GeneratedFiles } from "./generated-files";
import { linkedFolder, THROUGH_A_LINK } from "./media-routes";

/**
 * Writes `text` to `relative` (a project-relative path, written with `/`)
 * only where nothing is, and records which it was.
 *
 * The file is created exclusively (`wx`), so a file the app already has, a
 * link included, is never replaced, whatever appeared since any earlier
 * check. One that is there is reported as skipped, with why and, when given,
 * what to add to it by hand. `wx` guards only the file's own name, so a
 * folder on its path that is a symbolic link, which would take the write
 * wherever it points, is found first, as the media routes find it, and
 * nothing is written through it.
 */
export async function writeNew(
  cwd: string,
  relative: string,
  text: string,
  files: GeneratedFiles,
  ifThere: { why: string; toAdd?: string }
): Promise<void> {
  const file = path.join(cwd, ...relative.split("/"));
  const link = await linkedFolder(cwd, file);
  if (link !== null) {
    const folder = path.relative(cwd, link.folder).split(path.sep).join("/");
    files.skipped.push({
      path: relative,
      why: link.unreadable
        ? `${folder} cannot be read, so whether a folder in it is a symbolic link is unknown; nothing was written there`
        : `${folder} ${THROUGH_A_LINK}`,
      toAdd: ifThere.toAdd,
    });
    return;
  }
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
