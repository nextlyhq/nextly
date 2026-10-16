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
 * `segment` is the URL path each route answers, as the folder that owns it.
 * Next.js serves a `route.js` as readily as a `route.ts`, and leaves route
 * groups `(name)` and slots `@name` out of the URL, so a handler in any folder
 * that maps to that path competes with the one written here; a folder holding
 * no handler (empty, or only a placeholder) competes with nothing. `nested`
 * says whether handlers deeper in the folder compete too: they do for an
 * optional catch-all, which answers every path under its own, and they do not
 * for the health check, which answers only `/api/health`.
 *
 * `role` says what Nextly's route does there, for a media route the app
 * already has something in place of; the report then carries the route to
 * add by hand.
 */
const ROUTES = [
  {
    path: "admin/api/media/[[...path]]/route.ts",
    segment: "admin/api/media",
    nested: true,
    importsConfig: true,
    role: (file: string) =>
      `The admin's media library needs Nextly's route at ${file}, where it uploads, edits and deletes media for signed-in users with media permissions`,
  },
  {
    path: "api/media/[[...path]]/route.ts",
    segment: "api/media",
    nested: true,
    importsConfig: true,
    role: (file: string) =>
      `Nextly's public media route at ${file} serves media files to visitors, read-only`,
  },
  {
    path: "api/health/route.ts",
    segment: "api/health",
    nested: false,
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

const THROUGH_A_LINK = "is a symbolic link; nothing was written through it";

/** A file Next.js answers requests through: a route or a page, in any of its source extensions. */
const HANDLER_FILE = /^(route|page)\.[cm]?[jt]sx?$/;

/**
 * Write the media and health routes into an existing app, from the template
 * in `templatesDir` (the CLI's bundled templates by default).
 *
 * A route whose URL the app already answers is never written: the folder
 * that answers it is reported as skipped, exactly as it was, and for a media
 * route the report says what Nextly's route does there and carries it to add
 * by hand. Nothing is written through a linked folder. Every route is read
 * and prepared before any is written, so a template whose route no longer
 * imports the config is refused with nothing written.
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
    await writeIfUnanswered(cwd, route, result);
  }
  return result;
}

/** A route ready to write: its file, the app folder, the URL it answers, its text, and what it does. */
interface PreparedRoute {
  target: string;
  appRoot: string;
  segment: string;
  nested: boolean;
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
    appRoot: path.join(cwd, projectInfo.appDir),
    segment: route.segment,
    nested: route.nested,
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
 * Write a route only where nothing answers its URL yet, and never through a
 * linked folder; otherwise report what was left alone. The write itself
 * refuses an existing file too (`wx`), so one that appears between the check
 * and the write is not replaced either.
 */
async function writeIfUnanswered(
  cwd: string,
  route: PreparedRoute,
  result: GeneratedFiles
): Promise<void> {
  const { target, appRoot, segment, nested, text, role } = route;
  const link = await linkedFolder(appRoot, target);
  if (link !== null) {
    result.skipped.push(skipped(cwd, link, target, text, role, THROUGH_A_LINK));
    return;
  }
  const answering = await answeringFolder(appRoot, segment, nested);
  if (answering !== null) {
    result.skipped.push(
      skipped(cwd, answering, target, text, role, LEFT_AS_IT_IS)
    );
    return;
  }
  await fs.ensureDir(path.dirname(target));
  await fs.writeFile(target, text, { encoding: "utf-8", flag: "wx" });
  result.written.push(toPosix(path.relative(cwd, target)));
}

/**
 * The first existing folder between the app folder and the route's own that
 * is a symbolic link, or null. Writing through one would put the route
 * wherever the link points, which may be outside the project.
 */
async function linkedFolder(
  appRoot: string,
  target: string
): Promise<string | null> {
  const parts = path.relative(appRoot, path.dirname(target)).split(path.sep);
  let folder = appRoot;
  for (const part of parts) {
    folder = path.join(folder, part);
    const stat = await fs.lstat(folder).catch(() => null);
    if (stat === null) return null;
    if (stat.isSymbolicLink()) return folder;
  }
  return null;
}

/** A folder name Next.js leaves out of the URL: a route group or a parallel-route slot. */
function outsideUrl(name: string): boolean {
  return /^\(.*\)$/.test(name) || name.startsWith("@");
}

/**
 * The first folder in the app that answers `segment` and holds a handler, or
 * null. Every folder whose path, without route groups and slots, is that URL
 * counts, so the walk descends only while the URL so far is a prefix of it.
 * Linked folders are not followed.
 */
async function answeringFolder(
  appRoot: string,
  segment: string,
  nested: boolean
): Promise<string | null> {
  const wanted = segment.split("/");
  const visit = async (
    folder: string,
    url: string[]
  ): Promise<string | null> => {
    if (url.length === wanted.length) {
      return (await holdsHandler(folder, nested)) ? folder : null;
    }
    for (const name of await subfolders(folder)) {
      const next = outsideUrl(name) ? url : [...url, name];
      if (next.some((part, i) => part !== wanted[i])) continue;
      const found = await visit(path.join(folder, name), next);
      if (found !== null) return found;
    }
    return null;
  };
  return visit(appRoot, []);
}

/** The folders directly inside one, by name, in a stable order; links are not folders here. */
async function subfolders(folder: string): Promise<string[]> {
  const entries = await fs
    .readdir(folder, { withFileTypes: true })
    .catch(() => []);
  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
}

/**
 * Whether a folder holds a file Next.js answers requests through; with
 * `nested`, in any folder inside it too. Linked folders are not followed.
 */
async function holdsHandler(folder: string, nested: boolean): Promise<boolean> {
  const entries = await fs
    .readdir(folder, { withFileTypes: true })
    .catch(() => []);
  // A linked route file is still a route Next.js serves.
  if (
    entries.some(
      entry =>
        (entry.isFile() || entry.isSymbolicLink()) &&
        HANDLER_FILE.test(entry.name)
    )
  ) {
    return true;
  }
  if (!nested) return false;
  for (const name of await subfolders(folder)) {
    if (await holdsHandler(path.join(folder, name), true)) return true;
  }
  return false;
}

/** The report for a folder left alone: for a media route, what Nextly's route does and the text to add. */
function skipped(
  cwd: string,
  left: string,
  target: string,
  text: string,
  role: PreparedRoute["role"],
  reason: string
): GeneratedFiles["skipped"][number] {
  const folder = toPosix(path.relative(cwd, left));
  if (role === null) return { path: folder, why: reason };
  const file = toPosix(path.relative(cwd, target));
  return {
    path: folder,
    why: `${reason}. ${role(file)}: put the content below there, replacing or merging what handles those requests now`,
    toAdd: text,
  };
}

/** A path in `/` form, as an import specifier and the report both spell it. */
function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}
