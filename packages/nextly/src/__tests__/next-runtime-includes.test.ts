/**
 * The Next.js files every route ships for Nextly's runtime requires.
 *
 * Nextly loads `next/navigation`, `next/cache`, `next/headers` and
 * `next/server` through a require no build trace follows, and Next's require
 * hook sends `next/navigation` on to the pages router's vendored contexts. A
 * host that deploys each function with only its traced files (Vercel) then
 * failed the first request that needed one: every unknown address answered
 * 500, because `notFound()` could not load
 * `next/dist/server/route-modules/pages/vendored/contexts/app-router-context`.
 *
 * Judged against the installed Next.js: each pattern matches a file, so a
 * release that renames one fails here; each glob matches a file through the
 * glob Next.js itself runs, from the project directory; and every file the
 * production require graph was seen to load that its traces left out is
 * covered.
 */
import { createRequire } from "node:module";
import { join, matchesGlob, relative, sep } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { nextlyTracingIncludes as exported, withNextly } from "../next";
import {
  NEXT_RUNTIME_PATTERNS,
  nextRuntimeIncludes,
  nextlyTracingIncludes,
  runtimePackageDirs,
  type RuntimePackage,
} from "../next-runtime-includes";

/**
 * The files `next/navigation` and `next/cache` loaded at request time on a
 * Next.js 16.4 production server that the route's own build trace did not
 * hold, taken from its require graph; then what `next/headers` and
 * `next/server` load beyond those. Each is named by its package.
 */
const UNTRACED_CLOSURE = [
  "client-only/index.js",
  "next/cache.js",
  "next/dist/build/output/log.js",
  "next/dist/client/components/app-router-headers.js",
  "next/dist/compiled/next-server/pages-turbo.runtime.prod.js",
  "next/dist/lib/batcher.js",
  "next/dist/server/base-http/helpers.js",
  "next/dist/server/lib/clone-response.js",
  "next/dist/server/lib/dedupe-fetch.js",
  "next/dist/server/lib/encode-header-safe.js",
  "next/dist/server/lib/patch-fetch-symbol.js",
  "next/dist/server/lib/patch-fetch.js",
  "next/dist/server/lib/trace/request-insights-identity.js",
  "next/dist/server/lib/trace/request-insights.js",
  "next/dist/server/lib/trace/span-store.js",
  "next/dist/server/pipe-readable.js",
  "next/dist/server/render-result.js",
  "next/dist/server/request-meta.js",
  "next/dist/server/request/cache-stages.js",
  "next/dist/server/request/io.js",
  "next/dist/server/response-cache/index.js",
  "next/dist/server/response-cache/utils.js",
  "next/dist/server/route-modules/pages/module.compiled.js",
  "next/dist/server/route-modules/pages/vendored/contexts/app-router-context.js",
  "next/dist/server/route-modules/pages/vendored/contexts/hooks-client-context.js",
  "next/dist/server/route-modules/pages/vendored/contexts/server-inserted-html.js",
  "next/dist/server/stream-utils/encoded-tags.js",
  "next/dist/server/stream-utils/node-web-streams-helper.js",
  "next/dist/server/stream-utils/uint8array-helpers.js",
  "next/dist/server/use-cache/cache-life-profile.js",
  "next/dist/server/use-cache/cache-life.js",
  "next/dist/server/use-cache/cache-tag.js",
  "next/dist/server/web/error.js",
  "next/dist/server/web/next-url.js",
  "next/dist/server/web/spec-extension/adapters/next-request.js",
  "next/dist/server/web/spec-extension/request.js",
  "next/dist/server/web/spec-extension/revalidate.js",
  "next/dist/server/web/spec-extension/unstable-cache.js",
  "next/dist/server/web/spec-extension/unstable-no-store.js",
  "next/dist/server/web/utils.js",
  "next/dist/shared/lib/errors/constants.js",
  "next/dist/shared/lib/get-hostname.js",
  "next/dist/shared/lib/hash.js",
  "next/dist/shared/lib/i18n/detect-domain-locale.js",
  "next/dist/shared/lib/request-insights.js",
  "next/dist/shared/lib/router/utils/add-locale.js",
  "next/dist/shared/lib/router/utils/add-path-prefix.js",
  "next/dist/shared/lib/router/utils/add-path-suffix.js",
  "next/dist/shared/lib/router/utils/cache-busting-search-param.js",
  "next/dist/shared/lib/router/utils/format-next-pathname-info.js",
  "next/dist/shared/lib/router/utils/get-next-pathname-info.js",
  "next/dist/shared/lib/router/utils/parse-path.js",
  "next/dist/shared/lib/router/utils/path-has-prefix.js",
  "next/dist/shared/lib/router/utils/remove-path-prefix.js",
  "next/dist/shared/lib/router/utils/remove-trailing-slash.js",
  "react-dom/cjs/react-dom-server-legacy.browser.production.js",
  "react-dom/cjs/react-dom-server.edge.production.js",
  "react-dom/server.edge.js",
  "react/cjs/react-jsx-runtime.production.js",
  "react/jsx-runtime.js",
  "styled-jsx/dist/index/index.js",
  "styled-jsx/index.js",
  // next/headers and next/server, beyond the files above.
  "next/dist/compiled/ua-parser-js/ua-parser.js",
  "next/dist/server/after/after.js",
  "next/dist/server/after/index.js",
  "next/dist/server/create-deduped-by-callsite-server-error-logger.js",
  "next/dist/server/request/connection.js",
  "next/dist/server/request/cookies.js",
  "next/dist/server/request/draft-mode.js",
  "next/dist/server/request/headers.js",
  "next/dist/server/web/spec-extension/adapters/headers.js",
  "next/dist/server/web/spec-extension/adapters/reflect.js",
  "next/dist/server/web/spec-extension/adapters/request-cookies.js",
  "next/dist/server/web/spec-extension/image-response.js",
  "next/dist/server/web/spec-extension/response.js",
  "next/dist/server/web/spec-extension/url-pattern.js",
  "next/dist/server/web/spec-extension/user-agent.js",
  "next/headers.js",
  "next/server.js",
];

/** This package's directory: its `node_modules` links Next.js as an app's does. */
const ROOT = process.cwd();
const dirs = runtimePackageDirs(ROOT);
const PACKAGES = Object.keys(NEXT_RUNTIME_PATTERNS) as RuntimePackage[];
const posix = (path: string) => path.split(sep).join("/");

type GlobFn = (
  pattern: string,
  options: { cwd: string; nodir: boolean; dot: boolean },
  done: (error: Error | null, files: string[]) => void
) => void;

/** The glob Next.js runs over `outputFileTracingIncludes`, with its options. */
function nextGlob(pattern: string): Promise<string[]> {
  const require = createRequire(join(ROOT, "package.json"));
  const glob = require("next/dist/compiled/glob") as GlobFn;
  return new Promise((resolve, reject) => {
    glob(pattern, { cwd: ROOT, nodir: true, dot: true }, (error, files) =>
      error ? reject(error) : resolve(files)
    );
  });
}

afterEach(() => {
  // `withNextly()` queues a Cache Components warning for configs that leave
  // the options off; cleared so it reaches no other file's logger.
  const holder = globalThis as Record<symbol, { timer?: unknown } | undefined>;
  for (const key of [
    Symbol.for("nextly/cache-components-queued-warnings"),
    Symbol.for("nextly/cache-components-off-warned"),
  ]) {
    const held = holder[key];
    if (held && typeof held === "object" && "timer" in held) {
      clearTimeout(held.timer as ReturnType<typeof setTimeout>);
    }
    delete holder[key];
  }
});

describe("the Next.js runtime files Nextly's requires load", () => {
  it("finds every package where Next's own requires would", () => {
    expect(Object.keys(dirs).sort()).toEqual([...PACKAGES].sort());
  });

  it("names only patterns that match a file, so a renamed one fails here", async () => {
    const empty: string[] = [];
    for (const name of PACKAGES) {
      const real = dirs[name]?.real ?? "";
      for (const pattern of NEXT_RUNTIME_PATTERNS[name]) {
        const glob = posix(relative(ROOT, join(real, pattern)));
        if ((await nextGlob(glob)).length === 0)
          empty.push(`${name}/${pattern}`);
      }
    }
    expect(empty).toEqual([]);
  });

  it("covers every file the production require graph loaded untraced", () => {
    const uncovered = UNTRACED_CLOSURE.filter(file => {
      const name = PACKAGES.find(pkg => file.startsWith(`${pkg}/`));
      if (name === undefined) return true;
      const inside = file.slice(name.length + 1);
      return !NEXT_RUNTIME_PATTERNS[name].some(pattern =>
        matchesGlob(inside, pattern)
      );
    });
    expect(uncovered).toEqual([]);
    expect(UNTRACED_CLOSURE).toContain(
      "next/dist/server/route-modules/pages/vendored/contexts/app-router-context.js"
    );
  });

  it("gives each pattern under the project's link and under the real directory, each matching through Next's glob", async () => {
    const globs = nextRuntimeIncludes(ROOT);
    for (const name of PACKAGES) {
      const found = dirs[name];
      if (!found) continue;
      const pattern = NEXT_RUNTIME_PATTERNS[name][0] ?? "";
      expect(globs).toContain(
        `./${posix(relative(ROOT, join(found.linked, pattern)))}`
      );
      const real = posix(relative(ROOT, join(found.real, pattern)));
      expect(globs).toContain(real.startsWith("../") ? real : `./${real}`);
    }
    // The real directories, which are what a require from Nextly resolves to,
    // match from the project directory, where Next.js runs the globs.
    const failing: string[] = [];
    for (const glob of globs.filter(g => g.includes("/.pnpm/"))) {
      if ((await nextGlob(glob)).length === 0) failing.push(glob);
    }
    expect(failing).toEqual([]);
  });
});

describe("withNextly's includes", () => {
  type Includes = Record<string, string[]>;

  it("adds the runtime files to every route, after the app's own entries", () => {
    const config = withNextly({
      outputFileTracingIncludes: {
        "/**": ["./content/**/*"],
        "/api/report": ["./templates/report.hbs"],
      },
    } as Record<string, unknown>);
    const includes = config.outputFileTracingIncludes as Includes;
    const all = includes["/**"] ?? [];
    expect(all[0]).toBe("./content/**/*");
    expect(all).toEqual(expect.arrayContaining(nextRuntimeIncludes(ROOT)));
    expect(all).toContain(
      "./node_modules/next/dist/server/route-modules/pages/**/*.js"
    );
    expect(includes["/api/report"]).toEqual(["./templates/report.hbs"]);
  });

  it("hands the same list to a config not wrapped in it, from nextly/next", () => {
    expect(exported).toBe(nextlyTracingIncludes);
    const config = withNextly({} as Record<string, unknown>);
    expect((config.outputFileTracingIncludes as Includes)["/**"]).toEqual(
      nextlyTracingIncludes(ROOT)
    );
  });
});
