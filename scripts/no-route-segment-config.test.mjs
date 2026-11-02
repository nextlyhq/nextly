/**
 * No shipped route file exports a route segment config: `runtime`, `dynamic`,
 * `revalidate`, `fetchCache` or `dynamicParams`. Next.js refuses every one of
 * them at compile time under Cache Components, and each has a replacement
 * there (Node.js is the only runtime; a page is static unless it reads the
 * request; a cached read carries its own lifetime).
 *
 * Held over the templates' route modules, the only files Next.js reads segment
 * config from, and over create-nextly-app's generators, whose source holds
 * the route files they write as strings. A scan over source, so
 * the pattern carries its own controls: one that matches nothing passes this
 * check for ever. Its limit, stated rather than implied: an export renamed on
 * the way out (`export { config as dynamic }`) is not seen.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = new URL("..", import.meta.url).pathname;

export const SEGMENT_CONFIG_EXPORT =
  /\bexport\s+(?:const|let|var)\s+(?:runtime|dynamic|revalidate|fetchCache|dynamicParams)\s*[=:]/;

const FINDS = [
  'export const runtime = "nodejs";',
  "export const dynamicParams = true;",
  'export const dynamic = "force-static";',
  "export const revalidate = 60;",
  'export let fetchCache = "force-cache";',
  'export const dynamic: string = "force-dynamic";',
];

const PASSES = [
  "export const metadata = { title: 'x' };",
  "export async function generateStaticParams() {}",
  "// `export const dynamic` is refused under Cache Components",
  "export const revalidateTag = tag;",
  "const dynamic = true;",
];

/**
 * A route module, by Next.js's own file conventions: a segment file or a
 * metadata route inside an `app` folder. Next.js reads segment config from
 * these alone; the same export in any other file is an ordinary export.
 */
const ROUTE_MODULE =
  /(?:^|\/)app\/(?:.*\/)?(?:page|layout|route|default|template|not-found|error|global-error|opengraph-image|twitter-image|icon|apple-icon|sitemap|robots|manifest)\.(?:ts|tsx|mts|js|jsx|mjs)$/;

/** Whether a path, relative to the repository, is a route module. */
export const isRouteModule = path => ROUTE_MODULE.test(path);

/**
 * The files among `files` (each `{ path, text }`) that export a segment
 * config: a template file only when it is a route module, a generator always.
 */
export function segmentConfigFinds(files) {
  return files
    .filter(({ path }) => !path.startsWith("templates/") || isRouteModule(path))
    .filter(({ text }) => SEGMENT_CONFIG_EXPORT.test(text))
    .map(({ path }) => path);
}

/** Every non-test source file under `dir`. */
function sourceFiles(dir) {
  const files = [];
  const walk = path => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "__tests__")
          continue;
        walk(child);
      } else if (
        /\.(?:ts|tsx|mts|js|jsx|mjs)$/.test(entry.name) &&
        !/\.test\.[mc]?[jt]sx?$/.test(entry.name)
      ) {
        files.push(child);
      }
    }
  };
  walk(dir);
  return files;
}

describe("route segment config in shipped route files", () => {
  it("the pattern finds every form it exists for and passes the rest", () => {
    for (const text of FINDS) {
      expect(SEGMENT_CONFIG_EXPORT.test(text), text).toBe(true);
    }
    for (const text of PASSES) {
      expect(SEGMENT_CONFIG_EXPORT.test(text), text).toBe(false);
    }
  });

  it("holds route modules to it, and leaves every other template file alone", () => {
    const revalidate = "export const revalidate = 60;";
    expect(
      segmentConfigFinds([
        { path: "templates/blog/src/lib/cache.ts", text: revalidate },
        {
          path: "templates/blog/src/app/(frontend)/page.tsx",
          text: revalidate,
        },
        {
          path: "templates/blog/src/app/opengraph-image.tsx",
          text: revalidate,
        },
        {
          path: "packages/create-nextly-app/src/generators/routes.ts",
          text: revalidate,
        },
      ])
    ).toEqual([
      "templates/blog/src/app/(frontend)/page.tsx",
      "templates/blog/src/app/opengraph-image.tsx",
      "packages/create-nextly-app/src/generators/routes.ts",
    ]);
    // A component or a helper inside `app` is not a route module either.
    expect(
      isRouteModule("templates/blog/src/app/(frontend)/components/Footer.tsx")
    ).toBe(false);
    expect(isRouteModule("templates/blog/src/lib/static-params.ts")).toBe(
      false
    );
  });

  it("is exported by no template route module and written by no generator", () => {
    const files = [
      ...sourceFiles(join(ROOT, "templates")),
      ...sourceFiles(join(ROOT, "packages/create-nextly-app/src/generators")),
    ];
    const read = new Set(files.map(file => relative(ROOT, file)));
    // The scan reached the route files it holds: a detail page, an Open Graph
    // route and a generator that writes route files.
    expect(
      read.has("templates/blog/src/app/(frontend)/blog/[slug]/page.tsx")
    ).toBe(true);
    expect(read.has("templates/blog/src/app/opengraph-image.tsx")).toBe(true);
    expect(
      read.has("packages/create-nextly-app/src/generators/routes.ts")
    ).toBe(true);
    const found = segmentConfigFinds(
      files.map(file => ({
        path: relative(ROOT, file),
        text: readFileSync(file, "utf8"),
      }))
    );
    expect(found).toEqual([]);
  });
});
