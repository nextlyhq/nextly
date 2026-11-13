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
import { existsSync, readFileSync } from "node:fs";
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
  for (const { path, srcRoute, declared } of prerendered) {
    const appPath = srcRoute === null ? undefined : dynamic.get(srcRoute);
    if (appPath === undefined || isDynamic(path) || found.has(path)) continue;
    if (frameworkAddress(path)) continue;
    found.set(path, {
      path,
      source: "dynamic",
      route: fileOf(appPath),
      ...(declared === true ? { declared } : {}),
    });
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
 * Every address the build prerendered, with the route that rendered it.
 * Until `next build` writes its prerender manifest, which it does once every
 * page is rendered, those the build declared through `seoStaticParams`; the
 * manifest wins once it exists.
 */
function prerenderedIn(dir: string): Prerendered[] {
  const file = join(dir, "prerender-manifest.json");
  if (!existsSync(file)) return isNextBuild() ? declaredAddresses(dir) : [];
  const manifest = readJson(file);
  const routes = isRecord(manifest) ? manifest.routes : undefined;
  if (!isRecord(routes)) return [];
  return Object.entries(routes).map(([path, route]) => ({
    path,
    srcRoute:
      isRecord(route) && typeof route.srcRoute === "string"
        ? route.srcRoute
        : null,
    ...(isRecord(route) && route.initialStatus === 404
      ? { notFound: true }
      : {}),
  }));
}

/** The extensions a page file may have. */
const PAGE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mdx", ".md"];

/**
 * The page's file as the app has it, such as `src/app/pricing/page.tsx`,
 * where its source is there to look at; else `app` and its path.
 */
function sourceFileOf(appDir: string, appPath: string): string {
  for (const root of ["app", "src/app"]) {
    for (const extension of PAGE_EXTENSIONS) {
      const file = `${root}${appPath}${extension}`;
      if (existsSync(join(appDir, file))) return file;
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
