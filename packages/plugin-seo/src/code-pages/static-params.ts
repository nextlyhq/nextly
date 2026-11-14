/**
 * The pages a dynamic route declares through `generateStaticParams`, as the
 * plugin reads them while `next build` runs.
 *
 * Next.js works the declared params out while it collects page data, keeps
 * them in the build's memory, and writes them to its prerender manifest only
 * after every page is rendered. A sitemap the site renders during the build
 * would otherwise list none of them. A route that wraps its
 * `generateStaticParams` in {@link seoStaticParams} records the addresses
 * its params make, during the build only, in a folder of the build
 * directory; the code routes are read from there until the manifest exists,
 * and from the manifest from then on.
 *
 * Every call writes a file of its own, under a name no other call takes, and
 * renames it into place once written, so build workers recording at once
 * neither overwrite nor half-read each other; the reader lists each address
 * once.
 *
 * @module code-pages/static-params
 */
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

import { isRecord } from "../plain-values";

import { isNextBuild } from "./building";
import type { Prerendered } from "./routes";
import { codeAddressOf } from "./store";

/** The folder of the build directory the declared addresses are kept in. */
const DECLARED_DIR = join("nextly-seo", "static-params");

/**
 * A route's params, as `generateStaticParams` answers them. A catch-all's
 * values may be a readonly array, as a site's params kept `as const` are.
 */
export type StaticParams = Record<
  string,
  string | readonly string[] | undefined
>;

/** Where the app is, and where `next build` writes. */
export interface SeoStaticParamsOptions {
  /** The app's directory: where `next build` runs, unless given. */
  appDir?: string;
  /**
   * Next.js's build directory, `.next` unless the app sets `distDir`:
   * relative to `appDir`, or absolute. The same as the plugin's
   * `nextBuildDir`.
   */
  buildDir?: string;
}

// Whether a failed write was warned of already: once says it for the build.
let failureWarned = false;

/** `value` as one address segment, encoded as a browser sends it. */
function segment(value: string): string {
  return encodeURIComponent(value);
}

/** The values of a `[...name]` part, or of an optional `[[...name]]` one. */
function catchAllWith(
  value: StaticParams[string],
  optional: boolean
): string[] | undefined {
  const values = typeof value === "string" ? [value] : (value ?? []);
  if (values.length === 0 && !optional) return undefined;
  return values.some(each => each === "") ? undefined : values.map(segment);
}

/**
 * What one part of a route's address is with `params`: the part itself, the
 * value of a `[name]`, or the values of a `[...name]` or `[[...name]]`; none
 * where a part that needs a value has none.
 */
function partWith(part: string, params: StaticParams): string[] | undefined {
  const catchAll = /^(\[)?\[\.\.\.([^\]]+)\]\]?$/.exec(part);
  if (catchAll !== null) {
    return catchAllWith(params[catchAll[2] ?? ""], catchAll[1] === "[");
  }
  const single = /^\[([^\]]+)\]$/.exec(part);
  if (single === null) return [part];
  const value = params[single[1] ?? ""];
  return typeof value === "string" && value !== ""
    ? [segment(value)]
    : undefined;
}

/**
 * The address `route` names with `params`, such as `/blog/seo` for
 * `/blog/[topic]` and `{ topic: "seo" }`; nothing where a part has no value,
 * or the address is not one a visitor can be served at.
 */
function addressOfParams(
  route: string,
  params: StaticParams
): string | undefined {
  const parts: string[] = [];
  for (const part of route.split("/").filter(each => each !== "")) {
    const filled = partWith(part, params);
    if (filled === undefined) return undefined;
    parts.push(...filled);
  }
  return codeAddressOf(`/${parts.join("/")}`);
}

/** The build directory, as the code routes are read from it. */
function buildDirOf(options: SeoStaticParamsOptions): string {
  return resolve(options.appDir ?? process.cwd(), options.buildDir ?? ".next");
}

/** Write `route`'s addresses into a file of their own, renamed into place once whole. */
function record(dir: string, route: string, paths: readonly string[]): void {
  const folder = join(dir, DECLARED_DIR);
  mkdirSync(folder, { recursive: true });
  const name = `${process.pid}-${randomUUID()}`;
  const partial = join(folder, `${name}.part`);
  writeFileSync(partial, JSON.stringify({ route, paths }));
  renameSync(partial, join(folder, `${name}.json`));
}

/**
 * Every address recorded in the build directory `dir`, each once, with the
 * route that declared it; none where nothing was recorded.
 */
export function declaredAddresses(dir: string): Prerendered[] {
  const folder = join(dir, DECLARED_DIR);
  let files: string[];
  try {
    files = readdirSync(folder).filter(file => file.endsWith(".json"));
  } catch {
    return [];
  }
  const found = new Map<string, Prerendered>();
  for (const file of files) {
    let read: unknown;
    try {
      read = JSON.parse(readFileSync(join(folder, file), "utf8")) as unknown;
    } catch {
      continue;
    }
    if (!isRecord(read) || typeof read.route !== "string") continue;
    if (!Array.isArray(read.paths)) continue;
    for (const path of read.paths) {
      if (typeof path !== "string" || found.has(path)) continue;
      found.set(path, { path, srcRoute: read.route, declared: true });
    }
  }
  return [...found.values()];
}

/**
 * `generate`, a dynamic route's `generateStaticParams`, wrapped so that
 * `next build` records the addresses its params make for the SEO plugin:
 * the sitemap and `llms.txt` made during the build then list them, as they
 * do once the build is done. `route` is the route's address with its
 * variable parts as Next.js names them, route groups left out:
 * `"/blog/[topic]"`, `"/docs/[...slug]"`.
 *
 * Wrap the `generateStaticParams` of a route that calls `seoMetadata` and
 * whose pages search engines may list: a page it declares is listed during
 * the build as one whose route does, before it has rendered and recorded
 * what its own metadata says. A route that hides its pages has nothing to
 * add to a sitemap, so leave it unwrapped. It returns the params `generate`
 * returns, in their order, as an array of its own: Next.js's own type check
 * of a route, which `next build` runs on a TypeScript site, takes a mutable
 * array, and a site may keep its params as a readonly one. It records
 * nothing outside the build. A write that fails warns once and changes
 * nothing the route gets.
 *
 * @example
 * ```ts
 * import { seoStaticParams } from "@nextlyhq/plugin-seo";
 *
 * export const generateStaticParams = seoStaticParams(
 *   "/blog/[topic]",
 *   async () => (await topics()).map(topic => ({ topic: topic.slug }))
 * );
 * ```
 *
 * @experimental Its name and shape may change before 1.0.
 */
export function seoStaticParams<
  P extends StaticParams,
  A extends readonly unknown[],
>(
  route: string,
  generate: (...args: A) => readonly P[] | Promise<readonly P[]>,
  options: SeoStaticParamsOptions = {}
): (...args: A) => Promise<P[]> {
  return async (...args: A) => {
    // A copy, typed mutable as Next.js's route check asks, whatever `generate`
    // returned.
    const params = [...(await generate(...args))];
    if (!isNextBuild()) return params;
    // A nested route is handed its parent's params, which its address needs.
    const first = args[0];
    const parent =
      isRecord(first) && isRecord(first.params)
        ? (first.params as StaticParams)
        : {};
    try {
      const paths = params.flatMap(each => {
        const path = addressOfParams(route, { ...parent, ...each });
        return path === undefined ? [] : [path];
      });
      record(buildDirOf(options), route, paths);
    } catch (error) {
      if (!failureWarned) {
        failureWarned = true;
        console.warn(
          `[nextly-seo] the pages ${route} declares could not be recorded for the sitemap made during the build: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    return params;
  };
}
