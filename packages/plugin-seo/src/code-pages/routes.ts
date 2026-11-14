/**
 * The pages a site's routes render from their own code, read from what
 * `next build` wrote: every page route with no variable part (`/pricing`),
 * and every address a route with one declared through
 * `generateStaticParams` (`/integrations/wordpress`). Nothing is guessed: a
 * route with a variable part that declared no address has none listed.
 *
 * Read from Next.js's own manifests, as files, so the plugin needs no
 * `next` of its own. In development they hold only the routes compiled so
 * far, so the full list is that of a production build.
 *
 * @module code-pages/routes
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { FRAMEWORK_CRAWL_EXCLUSIONS } from "@nextlyhq/plugin-sdk";

import { isRecord } from "../plain-values";

import { isNextBuild } from "./building";
import { declaredAddresses } from "./static-params";

/** A page a route renders from its own code. */
export interface CodeRoute {
  /** The address, from the site's root. */
  path: string;
  /** A route with no variable part, or an address one with a variable part declared. */
  source: "built" | "dynamic";
  /** The route's file in the app, such as `app/pricing/page.tsx`. */
  route: string;
  /**
   * Declared through `seoStaticParams` while `next build` runs, before the
   * page has rendered: its route calls `seoMetadata`, which it may not have
   * recorded yet.
   */
  declared?: true;
}

/** An address the build prerendered, and the route that rendered it. */
export interface Prerendered {
  path: string;
  /** The route, as Next.js names it: `/integrations/[name]`. */
  srcRoute: string | null;
  /**
   * Whether the build's render of it answered not found (status 404), as a
   * page whose `generateStaticParams` names an address it then finds empty
   * does: no page is served there, so it is no page of the site.
   */
  notFound?: boolean;
  /** Declared through `seoStaticParams` while the build runs (`CodeRoute`). */
  declared?: true;
}

/** Where the app's routes are, and where `next build` wrote. */
export interface CodeRoutesOptions {
  /** The app's directory, where its `app` (or `src/app`) folder is. */
  appDir?: string;
  /**
   * Next.js's build directory, `.next` unless the app sets `distDir`:
   * relative to `appDir`, or absolute.
   */
  buildDir?: string;
}

/**
 * Whether `path` is one of the framework's own addresses, kept out of search
 * by the list every Nextly robots.txt reads: the admin and the API.
 */
function frameworkAddress(path: string): boolean {
  return FRAMEWORK_CRAWL_EXCLUSIONS.some(rule => {
    if (rule.endsWith("/")) return path.startsWith(rule);
    if (rule.endsWith("$") || rule.endsWith("?")) {
      return path === rule.slice(0, -1);
    }
    return path === rule;
  });
}

/**
 * The address a page route serves, from its path in the app: route groups
 * dropped. Nothing for a route that is not a page, a framework one (such as
 * `/_not-found`), a parallel or intercepting route, or one under the admin
 * or the API.
 */
export function addressOfAppPath(appPath: string): string | undefined {
  const segments = appPath.split("/").filter(segment => segment !== "");
  if (segments.at(-1) !== "page") return undefined;
  const parts: string[] = [];
  for (const segment of segments.slice(0, -1)) {
    // An intercepting route draws another route's address in place.
    if (/^\(\.{1,3}\)/.test(segment)) return undefined;
    if (segment.startsWith("@") || segment.startsWith("_")) return undefined;
    if (segment.startsWith("(") && segment.endsWith(")")) continue;
    parts.push(segment);
  }
  const path = `/${parts.join("/")}`;
  return frameworkAddress(path) ? undefined : path;
}

/** Whether a route's address has a variable part. */
const isDynamic = (path: string) => path.includes("[");

/**
 * The page `prerendered` names for a route with a variable part, `dynamic`
 * keyed by the name Next.js gives each; none for an address no such route
 * made, one with a variable part left, or one of the framework's own.
 */
function dynamicRouteOf(
  { path, srcRoute, declared }: Prerendered,
  dynamic: ReadonlyMap<string, string>,
  fileOf: (appPath: string) => string
): CodeRoute | undefined {
  const appPath = srcRoute === null ? undefined : dynamic.get(srcRoute);
  if (appPath === undefined || isDynamic(path) || frameworkAddress(path)) {
    return undefined;
  }
  return {
    path,
    source: "dynamic",
    route: fileOf(appPath),
    ...(declared === true ? { declared } : {}),
  };
}

/**
 * The pages the routes at `appPaths` render from their own code: each one
 * with no variable part, and each address `prerendered` names for one that
 * has, but never an address the build answered not found. Sorted by
 * address; an address listed twice is listed once.
 */
export function codeRoutesOf(
  appPaths: readonly string[],
  prerendered: readonly Prerendered[],
  fileOf: (appPath: string) => string = appPath => `app${appPath}`
): CodeRoute[] {
  const found = new Map<string, CodeRoute>();
  // Each route with a variable part, by the name Next.js gives it.
  const dynamic = new Map<string, string>();
  for (const appPath of appPaths) {
    const path = addressOfAppPath(appPath);
    if (path === undefined) continue;
    if (isDynamic(path)) {
      dynamic.set(path, appPath);
    } else if (!found.has(path)) {
      found.set(path, { path, source: "built", route: fileOf(appPath) });
    }
  }
  for (const each of prerendered) {
    const route = dynamicRouteOf(each, dynamic, fileOf);
    if (route !== undefined && !found.has(route.path)) {
      found.set(route.path, route);
    }
  }
  // No page is served where the build's render answered not found.
  const notFound = new Set(
    prerendered.flatMap(each => (each.notFound === true ? [each.path] : []))
  );
  return [...found.values()]
    .filter(route => !notFound.has(route.path))
    .sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0
    );
}

/** A JSON file's contents, or nothing where it is missing or unreadable. */
function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Where the running app's manifests are: the production build's, or in
 * development the development server's, which Next.js keeps apart.
 */
function manifestDir(buildDir: string): string {
  const development = join(buildDir, "dev");
  return process.env.NODE_ENV !== "production" && existsSync(development)
    ? development
    : buildDir;
}

/** The app paths of every route the build has, as Next.js names them. */
function appPathsIn(dir: string): string[] {
  const manifest = readJson(join(dir, "server", "app-paths-manifest.json"));
  return isRecord(manifest) ? Object.keys(manifest) : [];
}

/**
 * The status the build's render of `path` answered, from the record Next.js
 * keeps beside the page's HTML (`server/app/<path>.meta`); nothing where
 * there is none. With Cache Components on, the prerender manifest carries
 * no `initialStatus`, and this record is where a page that called
 * `notFound()` while the build rendered it says so.
 */
function renderedStatusOf(dir: string, path: string): number | undefined {
  const name = path === "/" ? "index" : path.slice(1);
  const meta = readJson(
    join(/*turbopackIgnore: true*/ dir, "server", "app", `${name}.meta`)
  );
  return isRecord(meta) && typeof meta.status === "number"
    ? meta.status
    : undefined;
}

/** The status a manifest entry states, else the page's own record's. */
function statusOf(
  dir: string,
  path: string,
  route: unknown
): number | undefined {
  return isRecord(route) && typeof route.initialStatus === "number"
    ? route.initialStatus
    : renderedStatusOf(dir, path);
}

/**
 * The last manifest read, kept while the file is unchanged: a build's
 * manifest and records do not change while it is served, and reading a
 * record per page on every listing would grow with the site.
 */
let lastRead:
  | { file: string; changedAt: number; prerendered: Prerendered[] }
  | undefined;

/**
 * Every address the build prerendered, with the route that rendered it.
 * Until `next build` writes its prerender manifest, which it does once every
 * page is rendered, those the build declared through `seoStaticParams`; the
 * manifest wins once it exists.
 */
function prerenderedIn(dir: string): Prerendered[] {
  const file = join(dir, "prerender-manifest.json");
  if (!existsSync(file)) return isNextBuild() ? declaredAddresses(dir) : [];
  const changedAt = statSync(file).mtimeMs;
  if (lastRead?.file === file && lastRead.changedAt === changedAt) {
    return lastRead.prerendered;
  }
  const manifest = readJson(file);
  const routes = isRecord(manifest) ? manifest.routes : undefined;
  if (!isRecord(routes)) return [];
  const prerendered = Object.entries(routes).map(([path, route]) => ({
    path,
    srcRoute:
      isRecord(route) && typeof route.srcRoute === "string"
        ? route.srcRoute
        : null,
    ...(statusOf(dir, path, route) === 404 ? { notFound: true } : {}),
  }));
  lastRead = { file, changedAt, prerendered };
  return prerendered;
}

/** The extensions a page file may have. */
const PAGE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mdx", ".md"];

/**
 * The page's file as the app has it, such as `src/app/pricing/page.tsx`,
 * where its source is there to look at; else `app` and its path.
 *
 * Only whether the file exists is asked, to name it, and a deployed app may
 * well not ship its sources. So the path is marked for Turbopack to ignore:
 * built into a Next.js app, a path joined from the working directory and a
 * route's name otherwise reads as any file of the project, and the build
 * traces the whole project, its sources and `public` folder, into the server
 * output, which slows a deploy or takes it over a host's size limit.
 */
function sourceFileOf(appDir: string, appPath: string): string {
  for (const root of ["app", "src/app"]) {
    for (const extension of PAGE_EXTENSIONS) {
      const file = `${root}${appPath}${extension}`;
      // Both calls marked: Turbopack judges the join and the read apart.
      const path = join(/*turbopackIgnore: true*/ appDir, file);
      if (existsSync(/*turbopackIgnore: true*/ path)) return file;
    }
  }
  return `app${appPath}`;
}

/** The pages the running app's routes render from their own code. */
export function readCodeRoutes(options: CodeRoutesOptions = {}): CodeRoute[] {
  const appDir = options.appDir ?? process.cwd();
  const dir = manifestDir(resolve(appDir, options.buildDir ?? ".next"));
  return codeRoutesOf(appPathsIn(dir), prerenderedIn(dir), appPath =>
    sourceFileOf(appDir, appPath)
  );
}
