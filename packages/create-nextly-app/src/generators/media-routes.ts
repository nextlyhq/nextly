import path from "path";

import fs from "fs-extra";

import type { ProjectInfo } from "../types";
import { resolveTemplatePath } from "../utils/template";

import type { GeneratedFiles } from "./generated-files";

/**
 * The routes an existing app receives, as the base template's app directory
 * holds them. They are read from the template rather than kept as strings
 * here, so an app Nextly is added to gets the same files a new project does:
 *
 * - the admin's media route, `admin/api/media/...`, where the admin uploads,
 *   lists and deletes media, every request checked against the signed-in
 *   caller's media permissions (`requireAuth: true` in the template);
 * - the public media route, `api/media/...`, which serves reads only;
 * - the health check.
 *
 * `segment` is the folder that owns each route's URLs. Next.js serves a
 * `route.js` as readily as a `route.ts`, and an optional catch-all answers
 * its parent URL too, so a handler anywhere in that folder could compete with
 * the one written here: a handler in the folder, not the one file name,
 * decides whether the app already has the route. A folder holding no
 * handler (empty, or only a placeholder) competes with nothing.
 *
 * `role` says what Nextly's route does there, for a media route the app
 * already has something in place of; the report then carries the route to
 * add by hand.
 */
const ROUTES = [
  {
    path: "admin/api/media/[[...path]]/route.ts",
    segment: "admin/api/media",
    importsConfig: true,
    role: (file: string) =>
      `The admin's media library needs Nextly's route at ${file}, where it uploads, edits and deletes media for signed-in users with media permissions`,
  },
  {
    path: "api/media/[[...path]]/route.ts",
    segment: "api/media",
    importsConfig: true,
    role: (file: string) =>
      `Nextly's public media route at ${file} serves media files to visitors, read-only`,
  },
  {
    path: "api/health/route.ts",
    segment: "api/health",
    importsConfig: false,
    role: null,
  },
] as const;

/**
 * The import that brings in the Nextly config: the template spells it through
 * the `@nextly-config` alias or a path relative to its own layout, neither of
 * which an existing app is guaranteed to resolve.
 */
const CONFIG_IMPORT =
  /(import\s+\w+\s+from\s+")([^"]*(?:@nextly-config|nextly\.config))(";)/;

const LEFT_AS_IT_IS = "already holds routes; left as it is";

/** A file Next.js answers requests through: a route or a page, in any of its source extensions. */
const HANDLER_FILE = /^(route|page)\.[cm]?[jt]sx?$/;

/**
 * Write the media and health routes into an existing app, from the template
 * in `templatesDir` (the CLI's bundled templates by default).
 *
 * A route whose folder the project already has is never written: the folder
 * is reported as skipped, exactly as it was, and for a media route the report
 * says what Nextly's route does there and carries it to add by hand. Every
 * route is read and prepared before any is written, so a template whose route
 * no longer imports the config is refused with nothing written.
 */
export async function generateMediaRoutes(
  cwd: string,
  projectInfo: ProjectInfo,
  templatesDir: string = resolveTemplatePath()
): Promise<GeneratedFiles> {
  const prepared = await Promise.all(
    ROUTES.map(route => prepareRoute(cwd, projectInfo, templatesDir, route))
  );
  const result: GeneratedFiles = { written: [], changed: [], skipped: [] };
  for (const route of prepared) {
    await writeIfFolderAbsent(cwd, route, result);
  }
  return result;
}

/** A route ready to write: its file, the folder that owns its URLs, its text, and what it does. */
interface PreparedRoute {
  target: string;
  segment: string;
  text: string;
  role: ((file: string) => string) | null;
}

/** One route's destination in the project and its text, with the config import made relative. */
async function prepareRoute(
  cwd: string,
  projectInfo: ProjectInfo,
  templatesDir: string,
  route: (typeof ROUTES)[number]
): Promise<PreparedRoute> {
  const source = path.join(templatesDir, "base", "src", "app", route.path);
  const text = await fs.readFile(source, "utf-8");
  const target = path.join(cwd, projectInfo.appDir, route.path);
  return {
    target,
    segment: path.join(cwd, projectInfo.appDir, route.segment),
    text: route.importsConfig
      ? withRelativeConfigImport(text, cwd, target, route.path)
      : text,
    role: route.role,
  };
}

/**
 * The route's text with its config import pointing at the project's
 * `nextly.config` by a path relative to where the route is written, so it
 * resolves with or without a `src/` folder and with no import alias at all.
 */
function withRelativeConfigImport(
  text: string,
  cwd: string,
  target: string,
  routePath: string
): string {
  if (!CONFIG_IMPORT.test(text)) {
    throw new Error(
      `The template's ${routePath} does not import the Nextly config, so no route that finds it can be written.`
    );
  }
  const specifier = toPosix(
    path.relative(path.dirname(target), path.join(cwd, "nextly.config"))
  );
  return text.replace(
    CONFIG_IMPORT,
    (_match, head: string, _old: string, tail: string) =>
      `${head}${specifier}${tail}`
  );
}

/**
 * Write a route only where its folder does not exist yet; otherwise report
 * the folder as skipped. The write itself refuses an existing file too
 * (`wx`), so one that appears between the check and the write is not
 * replaced either.
 */
async function writeIfFolderAbsent(
  cwd: string,
  { target, segment, text, role }: PreparedRoute,
  result: GeneratedFiles
): Promise<void> {
  if (await holdsHandler(segment)) {
    result.skipped.push(skipped(cwd, segment, target, text, role));
    return;
  }
  await fs.ensureDir(path.dirname(target));
  await fs.writeFile(target, text, { encoding: "utf-8", flag: "wx" });
  result.written.push(toPosix(path.relative(cwd, target)));
}

/** Whether a folder, or any folder inside it, holds a file Next.js answers requests through. */
async function holdsHandler(folder: string): Promise<boolean> {
  if (!(await fs.pathExists(folder))) return false;
  const entries = await fs.readdir(folder, { withFileTypes: true });
  for (const entry of entries) {
    // A linked route file is still a route Next.js serves.
    if (
      (entry.isFile() || entry.isSymbolicLink()) &&
      HANDLER_FILE.test(entry.name)
    )
      return true;
    if (
      entry.isDirectory() &&
      (await holdsHandler(path.join(folder, entry.name)))
    )
      return true;
  }
  return false;
}

/** The report for a folder left alone: for a media route, what Nextly's route does and the text to add. */
function skipped(
  cwd: string,
  segment: string,
  target: string,
  text: string,
  role: PreparedRoute["role"]
): GeneratedFiles["skipped"][number] {
  const folder = toPosix(path.relative(cwd, segment));
  if (role === null) return { path: folder, why: LEFT_AS_IT_IS };
  const file = toPosix(path.relative(cwd, target));
  return {
    path: folder,
    why: `${LEFT_AS_IT_IS}. ${role(file)}: put the content below there, replacing or merging what handles those requests now`,
    toAdd: text,
  };
}

/** A path in `/` form, as an import specifier and the report both spell it. */
function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}
