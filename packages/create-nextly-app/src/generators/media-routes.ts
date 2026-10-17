import path from "path";

import fs from "fs-extra";

import type { ProjectInfo } from "../types";
import { resolveTemplatePath } from "../utils/template";

import type { GeneratedFiles } from "./generated-files";
import { ADMIN_API_FOLDER } from "./routes";

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
 * `segment` is the URL each route answers. A handler already answering it
 * means the app has its own route there, which is left alone. Next.js leaves
 * route groups `(name)` and slots `@name` out of the URL wherever they sit,
 * and never routes a private folder `_name`, so the folders that answer a URL
 * are found by that rule rather than by name. `catchAll` marks the optional
 * catch-alls: they also clash with a dynamic child (`[id]`, `[...rest]`) that
 * holds a handler, but not with a concrete child such as `sign/`, which
 * Next.js sorts ahead of the catch-all.
 *
 * `role` says what Nextly's route does there, for a media route the app
 * already has something in place of; the report then carries the route to
 * add by hand.
 */
const ROUTES = [
  {
    path: "admin/api/media/[[...path]]/route.ts",
    segment: "admin/api/media",
    catchAll: true,
    importsConfig: true,
    role: (file: string) =>
      `The admin's media library needs Nextly's route at ${file}, where it uploads, edits and deletes media for signed-in users with media permissions`,
  },
  {
    path: "api/media/[[...path]]/route.ts",
    segment: "api/media",
    catchAll: true,
    importsConfig: true,
    role: (file: string) =>
      `Nextly's public media route at ${file} serves media files to visitors, read-only`,
  },
  {
    path: "api/health/route.ts",
    segment: "api/health",
    catchAll: false,
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

export const THROUGH_A_LINK =
  "is a symbolic link; nothing was written through it";

/**
 * A file Next.js answers requests through: a route or a page, in the source
 * extensions it routes by default (`pageExtensions`). An app that configures
 * other extensions is read as if it had not.
 */
const HANDLER_FILE = /^(route|page)\.(tsx|ts|jsx|js)$/;

/**
 * A route or page file in some other single extension. Next.js routes it only
 * when the app adds that extension to `pageExtensions`, which is not read
 * here (the app's config is never evaluated), so it cannot be ruled out.
 */
const MAYBE_HANDLER_FILE = /^(route|page)\.[^.]+$/;

const UNREADABLE =
  "cannot be read, so whether it already answers this URL is unknown; left as it is";

/**
 * A route handler file, without pages: what a dynamic segment answering an
 * API URL holds. A catch-all PAGE beside static API routes is how a site is
 * usually built, so pages reached through a dynamic segment are not counted.
 */
const ROUTE_FILE = /^route\.(tsx|ts|jsx|js)$/;

/** A route handler file in an extension the app may or may not route. */
const MAYBE_ROUTE_FILE = /^route\.[^.]+$/;

const THROUGH_A_DYNAMIC_SEGMENT =
  "already answers this URL through a dynamic segment, and a route written here would take those requests from it; left as it is";

/** Which files count as answering a URL in a folder, and the reason given when one does. */
interface HandlerKind {
  sure: RegExp;
  maybe: RegExp;
  reason: string;
}

/** A route or a page, at a folder that maps to the URL. */
const ANY_HANDLERS: HandlerKind = {
  sure: HANDLER_FILE,
  maybe: MAYBE_HANDLER_FILE,
  reason: LEFT_AS_IT_IS,
};

/** A route handler only, reached through a dynamic segment. */
const ROUTE_HANDLERS: HandlerKind = {
  sure: ROUTE_FILE,
  maybe: MAYBE_ROUTE_FILE,
  reason: THROUGH_A_DYNAMIC_SEGMENT,
};

/**
 * The Pages Router folders Next.js reads. An app may use both routers, but
 * Next.js refuses to build a page and an app route at one URL, so a page
 * there leaves the route unwritten. Both places are looked in, whichever the
 * app folder sits beside: a page in either is one Next.js might serve.
 */
const PAGES_DIRS = ["pages", "src/pages"];

const A_PAGE_ANSWERS =
  "is a Pages Router route at the same URL, and Next.js refuses to build two routes for one URL; left as it is";

const A_PAGE_MAY_ANSWER =
  "is a dynamic Pages Router route that may answer the same URL, and Next.js refuses to build two routes for one URL; left as it is";

/** Why a folder is left alone because one of its files might be a route. */
function unsure(file: string): string {
  return `holds ${file}, which Next.js routes only if the app configures that extension; left as it is`;
}

/** A folder that exists but could not be listed: what it holds is unknown. */
class UnreadableFolder extends Error {
  constructor(readonly folder: string) {
    super(`cannot read ${folder}`);
  }
}

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
  catchAll: boolean;
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
    catchAll: route.catchAll,
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
  const { target, appRoot, segment, catchAll, text, role } = route;
  const link = await linkedFolder(cwd, target);
  // A link, or a folder that cannot be read (so not known not to be a
  // link), leaves the route unwritten, whatever the checks below would find.
  if (link !== null) {
    result.skipped.push(
      skipped(
        cwd,
        link.folder,
        target,
        text,
        role,
        link.unreadable ? UNREADABLE : THROUGH_A_LINK
      )
    );
    return;
  }
  const answering =
    (await answeringFolder(appRoot, segment, catchAll)) ??
    (await answeringThroughDynamic(appRoot, segment)) ??
    (await answeringPage(cwd, segment));
  if (answering !== null) {
    result.skipped.push(
      skipped(cwd, answering.folder, target, text, role, answering.reason)
    );
    return;
  }
  await fs.ensureDir(path.dirname(target));
  await fs.writeFile(target, text, { encoding: "utf-8", flag: "wx" });
  result.written.push(toPosix(path.relative(cwd, target)));
}

/**
 * The first existing folder between the project and the route's own that is
 * a symbolic link, the app folder and `src/` included, or null. Writing
 * through one would put the route wherever the link points, which may be
 * outside the project.
 */
export async function linkedFolder(
  cwd: string,
  target: string
): Promise<{ folder: string; unreadable: boolean } | null> {
  // From the folder below the project's own: a project reached through a
  // link is the app's choice, and judging the root for a file directly in it
  // but not for the rest would skip one file while writing others.
  const parts = path
    .relative(cwd, path.dirname(target))
    .split(path.sep)
    .filter(part => part !== "");
  let folder = cwd;
  for (const part of parts) {
    const above = folder;
    folder = path.join(folder, part);
    try {
      if ((await fs.lstat(folder)).isSymbolicLink()) {
        return { folder, unreadable: false };
      }
    } catch (error) {
      // Only an absent folder ends the walk as safe. One that cannot be
      // looked at (the folder above cannot be searched) is not known not to
      // be a link, so it is reported, and nothing is written there.
      if ((error as { code?: string }).code === "ENOENT") return null;
      return { folder: above, unreadable: true };
    }
  }
  return null;
}

/** A folder name Next.js leaves out of the URL: a route group or a parallel-route slot. */
function outsideUrl(name: string): boolean {
  return /^\(.*\)$/.test(name) || name.startsWith("@");
}

/** A folder Next.js never routes, with everything inside it. */
function isPrivate(name: string): boolean {
  return name.startsWith("_");
}

/** A dynamic segment: `[id]`, `[...rest]` or `[[...rest]]`. */
function isDynamic(name: string): boolean {
  return name.startsWith("[");
}

/**
 * The first folder in the app that answers `segment`, or might, with why; or
 * null when nothing does. A handler directly in a folder that maps to the
 * URL answers it; for a catch-all, so does a handler anywhere under a dynamic
 * child of such a folder. Whatever cannot be judged for certain (a route file
 * in an extension the app might route, a folder that cannot be read) counts
 * as answering, so the route is never written beside it.
 */
async function answeringFolder(
  appRoot: string,
  segment: string,
  catchAll: boolean
): Promise<{ folder: string; reason: string } | null> {
  try {
    for (const folder of await foldersAt(appRoot, segment)) {
      const here = await handlerIn(folder);
      if (here !== null) return { folder, reason: here };
      if (!catchAll) continue;
      for (const child of (await subfolders(folder)).filter(isDynamic)) {
        const within = await handlerWithin(path.join(folder, child));
        if (within !== null) return { folder, reason: within };
      }
    }
    return null;
  } catch (error) {
    if (error instanceof UnreadableFolder) {
      return { folder: error.folder, reason: UNREADABLE };
    }
    throw error;
  }
}

/**
 * The first route handler that already answers `segment` through a dynamic
 * segment, with why; or null when none does. A catch-all folder on the way
 * (`[...rest]`, `[[...rest]]`) takes the rest of the URL, and a single dynamic
 * one (`[name]`) takes one part of it, so a route handler in either, at the
 * depth that reaches the URL, already serves it: a static route written there
 * would take those requests from it. Fails closed as the app check does.
 */
async function answeringThroughDynamic(
  appRoot: string,
  segment: string
): Promise<{ folder: string; reason: string } | null> {
  try {
    // Nextly's admin API catch-all is not the app's own handler for these
    // URLs: the install writes Nextly's there just before these routes, or,
    // where the app already had one, says to put Nextly's in its place.
    // Either way the admin media route is meant to sit beside it.
    const walk: DynamicWalk = {
      wanted: segment.split("/"),
      own: path.join(appRoot, ...ADMIN_API_FOLDER),
    };
    return await dynamicWalk(walk, appRoot, 0, false);
  } catch (error) {
    if (error instanceof UnreadableFolder) {
      return { folder: error.folder, reason: UNREADABLE };
    }
    throw error;
  }
}

/** What stays the same through one {@link answeringThroughDynamic} walk. */
interface DynamicWalk {
  /** The URL's parts. */
  wanted: string[];
  /** Nextly's own admin API catch-all, which is never counted. */
  own: string;
}

type Finding = { folder: string; reason: string };

/** One step of {@link answeringThroughDynamic}: `folder` stands for the URL's first `depth` parts. */
async function dynamicWalk(
  walk: DynamicWalk,
  folder: string,
  depth: number,
  viaDynamic: boolean
): Promise<Finding | null> {
  if (depth === walk.wanted.length && viaDynamic) {
    const here = await handlerIn(folder, ROUTE_HANDLERS);
    if (here !== null) return { folder, reason: here };
  }
  for (const name of await subfolders(folder)) {
    const found = await dynamicChild(
      walk,
      path.join(folder, name),
      depth,
      viaDynamic
    );
    if (found !== null) return found;
  }
  return null;
}

/** What one child folder of the walk contributes: a handler it answers through, or one deeper in it. */
async function dynamicChild(
  walk: DynamicWalk,
  child: string,
  depth: number,
  viaDynamic: boolean
): Promise<Finding | null> {
  const name = path.basename(child);
  if (child === walk.own) return null;
  if (outsideUrl(name)) return dynamicWalk(walk, child, depth, viaDynamic);
  if (isCatchAll(name)) return catchAllFinding(walk, child, depth);
  if (depth >= walk.wanted.length) return null;
  if (isDynamic(name)) return dynamicWalk(walk, child, depth + 1, true);
  return name === walk.wanted[depth]
    ? dynamicWalk(walk, child, depth + 1, viaDynamic)
    : null;
}

/**
 * A route handler anywhere in a catch-all folder that reaches the URL.
 * `[[...rest]]` matches no part at all, so it reaches the URL even when every
 * part is already matched; `[...rest]` needs at least one more.
 */
async function catchAllFinding(
  walk: DynamicWalk,
  child: string,
  depth: number
): Promise<Finding | null> {
  const reaches =
    depth < walk.wanted.length || path.basename(child).startsWith("[[");
  if (!reaches) return null;
  const within = await handlerWithin(child, ROUTE_HANDLERS);
  return within === null ? null : { folder: child, reason: within };
}

/** A catch-all segment: `[...rest]` or `[[...rest]]`. */
function isCatchAll(name: string): boolean {
  return name.startsWith("[...") || name.startsWith("[[...");
}

/**
 * The first Pages Router file or folder that answers `segment`, or might,
 * with why; or null when none does. It fails closed as the app check does: a
 * file named for the URL's last part in any extension, that part's folder
 * holding anything, a dynamic route anywhere on the way, a linked folder on
 * the way, or a folder that cannot be read all leave the route unwritten.
 */
async function answeringPage(
  cwd: string,
  segment: string
): Promise<PageFinding | null> {
  try {
    for (const dir of PAGES_DIRS) {
      const found = await pageAt(path.join(cwd, dir), segment.split("/"));
      if (found !== null) return found;
    }
    return null;
  } catch (error) {
    if (error instanceof UnreadableFolder) {
      return { folder: error.folder, reason: UNREADABLE };
    }
    throw error;
  }
}

/** A page that answers, or might, and why. */
type PageFinding = { folder: string; reason: string };

/** What in one Pages Router folder answers the URL made of `parts`, walking it part by part. */
async function pageAt(
  pagesRoot: string,
  parts: string[]
): Promise<PageFinding | null> {
  let folder = pagesRoot;
  for (const [index, part] of parts.entries()) {
    const entries = await entriesOf(folder);
    const dynamic = dynamicPage(folder, entries);
    if (dynamic !== null) return dynamic;
    if (index === parts.length - 1) return lastPartPage(folder, entries, part);
    const next = entries.find(entry => entry.name === part);
    if (next === undefined) return null;
    // A link is not followed, so what it leads to cannot be judged.
    if (!next.isDirectory()) {
      return {
        folder: path.join(folder, next.name),
        reason: A_PAGE_MAY_ANSWER,
      };
    }
    folder = path.join(folder, next.name);
  }
  return null;
}

/**
 * A dynamic page or folder in `folder`, which can match the URL's part at
 * this depth, and a catch-all the rest of the URL with it.
 */
function dynamicPage(folder: string, entries: fs.Dirent[]): PageFinding | null {
  const dynamic = entries.find(entry => isDynamic(entry.name));
  return dynamic === undefined
    ? null
    : { folder: path.join(folder, dynamic.name), reason: A_PAGE_MAY_ANSWER };
}

/**
 * The page for the URL's last part: `health.ts` in any extension, or a
 * `health/` that holds anything (its `index` page answers the URL, and what
 * else is there cannot be judged for certain).
 */
async function lastPartPage(
  folder: string,
  entries: fs.Dirent[],
  part: string
): Promise<PageFinding | null> {
  for (const entry of entries) {
    if (entry.name !== part && !entry.name.startsWith(`${part}.`)) continue;
    const at = path.join(folder, entry.name);
    if (!entry.isDirectory() || (await entriesOf(at)).length > 0) {
      return { folder: at, reason: A_PAGE_ANSWERS };
    }
  }
  return null;
}

/**
 * Every folder in the app whose URL is `segment`: its path with route groups
 * and slots taken out, in any position, the last included. The walk descends
 * only while the URL so far is a prefix of the one wanted, skips private
 * folders, and does not follow links.
 */
async function foldersAt(appRoot: string, segment: string): Promise<string[]> {
  const wanted = segment.split("/");
  const found: string[] = [];
  const visit = async (folder: string, url: string[]): Promise<void> => {
    const complete = url.length === wanted.length;
    if (complete) found.push(folder);
    for (const name of await subfolders(folder)) {
      if (outsideUrl(name)) {
        await visit(path.join(folder, name), url);
      } else if (!complete && name === wanted[url.length]) {
        await visit(path.join(folder, name), [...url, name]);
      }
    }
  };
  await visit(appRoot, []);
  return found;
}

/**
 * What a folder holds. A folder that does not exist holds nothing; one that
 * exists but cannot be listed is refused, since what it holds is unknown.
 */
async function entriesOf(folder: string): Promise<fs.Dirent[]> {
  try {
    return await fs.readdir(folder, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new UnreadableFolder(folder);
  }
}

/** The routable folders directly inside one, by name, in a stable order: not private, not links. */
async function subfolders(folder: string): Promise<string[]> {
  const entries = await entriesOf(folder);
  return entries
    .filter(entry => entry.isDirectory() && !isPrivate(entry.name))
    .map(entry => entry.name)
    .sort();
}

/**
 * Why a folder itself answers requests, or null when it does not: a handler
 * of `kind` Next.js routes by default, or a file of that kind it might route.
 */
async function handlerIn(
  folder: string,
  kind: HandlerKind = ANY_HANDLERS
): Promise<string | null> {
  // A linked route file is still a route Next.js serves.
  const files = (await entriesOf(folder))
    .filter(entry => entry.isFile() || entry.isSymbolicLink())
    .map(entry => entry.name)
    .sort();
  if (files.some(name => kind.sure.test(name))) return kind.reason;
  const maybe = files.find(name => kind.maybe.test(name));
  return maybe === undefined ? null : unsure(maybe);
}

/** Why a folder, or any routable folder inside it, holds a handler of `kind`, or null. */
async function handlerWithin(
  folder: string,
  kind: HandlerKind = ANY_HANDLERS
): Promise<string | null> {
  const here = await handlerIn(folder, kind);
  if (here !== null) return here;
  for (const name of await subfolders(folder)) {
    const deeper = await handlerWithin(path.join(folder, name), kind);
    if (deeper !== null) return deeper;
  }
  return null;
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
