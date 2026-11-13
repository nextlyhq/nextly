/**
 * The Next.js files every route ships for Nextly's runtime requires.
 *
 * Nextly loads Next's server build of `next/navigation`, `next/cache`,
 * `next/headers` and `next/server` through `createRequire`, which a build
 * trace may not follow. A host that deploys each function with only its
 * traced files (Vercel) then failed the first request that needed one of
 * their files: every unknown address answered 500. The client
 * `next/navigation` nextly loaded before made it worse: on the server, Next's
 * require hook sends it on to the pages router's runtime, `react-dom`,
 * `styled-jsx` and `client-only`, reached through pnpm's links, which no
 * list of files recreates.
 *
 * Judged against the installed Next.js: the four entries, loaded as a
 * production server loads them (Next's require hook installed), reach no
 * file outside `next` but `react`, so the `next` package's own files are
 * enough; each pattern matches a file, through the glob Next.js itself runs,
 * so a release that renames one fails here; and every file the production
 * require graph was seen to load that its traces left out is covered.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { join, matchesGlob, relative, sep } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { nextlyTracingIncludes as exported, withNextly } from "../next";
import {
  NEXT_RUNTIME_PATTERNS,
  nextPackageDirs,
  nextRuntimeIncludes,
  nextlyTracingIncludes,
} from "../next-runtime-includes";
import { NEXT_NAVIGATION_SERVER_ENTRY } from "../runtime/next-api";

/**
 * The files of `next` that Nextly's four entries loaded at request time on a
 * Next.js 16.4 production server that the route's own build trace did not
 * hold, taken from its require graph, with what `next/headers` and
 * `next/server` load beyond the others. Each is named from the package's
 * directory.
 */
const UNTRACED_CLOSURE = [
  "cache.js",
  "dist/build/output/log.js",
  "dist/client/components/app-router-headers.js",
  "dist/compiled/ua-parser-js/ua-parser.js",
  "dist/lib/batcher.js",
  "dist/server/after/after.js",
  "dist/server/after/index.js",
  "dist/server/base-http/helpers.js",
  "dist/server/create-deduped-by-callsite-server-error-logger.js",
  "dist/server/lib/clone-response.js",
  "dist/server/lib/dedupe-fetch.js",
  "dist/server/lib/encode-header-safe.js",
  "dist/server/lib/patch-fetch-symbol.js",
  "dist/server/lib/patch-fetch.js",
  "dist/server/lib/trace/request-insights-identity.js",
  "dist/server/lib/trace/request-insights.js",
  "dist/server/lib/trace/span-store.js",
  "dist/server/pipe-readable.js",
  "dist/server/render-result.js",
  "dist/server/request-meta.js",
  "dist/server/request/cache-stages.js",
  "dist/server/request/connection.js",
  "dist/server/request/cookies.js",
  "dist/server/request/draft-mode.js",
  "dist/server/request/headers.js",
  "dist/server/request/io.js",
  "dist/server/response-cache/index.js",
  "dist/server/response-cache/utils.js",
  "dist/server/stream-utils/encoded-tags.js",
  "dist/server/stream-utils/node-web-streams-helper.js",
  "dist/server/stream-utils/uint8array-helpers.js",
  "dist/server/use-cache/cache-life-profile.js",
  "dist/server/use-cache/cache-life.js",
  "dist/server/use-cache/cache-tag.js",
  "dist/server/web/error.js",
  "dist/server/web/next-url.js",
  "dist/server/web/spec-extension/adapters/headers.js",
  "dist/server/web/spec-extension/adapters/next-request.js",
  "dist/server/web/spec-extension/adapters/reflect.js",
  "dist/server/web/spec-extension/adapters/request-cookies.js",
  "dist/server/web/spec-extension/image-response.js",
  "dist/server/web/spec-extension/request.js",
  "dist/server/web/spec-extension/response.js",
  "dist/server/web/spec-extension/revalidate.js",
  "dist/server/web/spec-extension/unstable-cache.js",
  "dist/server/web/spec-extension/unstable-no-store.js",
  "dist/server/web/spec-extension/url-pattern.js",
  "dist/server/web/spec-extension/user-agent.js",
  "dist/server/web/utils.js",
  "dist/shared/lib/errors/constants.js",
  "dist/shared/lib/get-hostname.js",
  "dist/shared/lib/hash.js",
  "dist/shared/lib/i18n/detect-domain-locale.js",
  "dist/shared/lib/request-insights.js",
  "dist/shared/lib/router/utils/add-locale.js",
  "dist/shared/lib/router/utils/add-path-prefix.js",
  "dist/shared/lib/router/utils/add-path-suffix.js",
  "dist/shared/lib/router/utils/cache-busting-search-param.js",
  "dist/shared/lib/router/utils/format-next-pathname-info.js",
  "dist/shared/lib/router/utils/get-next-pathname-info.js",
  "dist/shared/lib/router/utils/parse-path.js",
  "dist/shared/lib/router/utils/path-has-prefix.js",
  "dist/shared/lib/router/utils/remove-path-prefix.js",
  "dist/shared/lib/router/utils/remove-trailing-slash.js",
  "headers.js",
  "server.js",
];

/** This package's directory: its `node_modules` links Next.js as an app's does. */
const ROOT = process.cwd();
const dirs = nextPackageDirs(ROOT);
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

/**
 * Every file the four entries load, in a process of its own with Next's
 * require hook installed and a production Turbopack server's environment,
 * as each package directory's path to the file (`next/dist/...`).
 */
function loadedByEntries(): string[] {
  const script = `
    const { createRequire } = require("node:module");
    const req = createRequire(process.cwd() + "/package.json");
    req("next/dist/server/require-hook");
    const before = new Set(Object.keys(require.cache));
    for (const entry of process.argv.slice(1)) req(entry);
    const files = Object.keys(require.cache).filter(file => !before.has(file));
    process.stdout.write(JSON.stringify(files));
  `;
  const run = spawnSync(
    process.execPath,
    [
      "-e",
      script,
      NEXT_NAVIGATION_SERVER_ENTRY,
      "next/cache",
      "next/headers",
      "next/server",
    ],
    {
      cwd: ROOT,
      env: { ...process.env, NODE_ENV: "production", TURBOPACK: "1" },
      encoding: "utf8",
    }
  );
  if (run.status !== 0) throw new Error(run.stderr);
  return (JSON.parse(run.stdout) as string[]).map(file =>
    posix(file).replace(/^.*\/node_modules\//, "")
  );
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
  it("reach no package but next and react, and none of the pages router's runtime", () => {
    const loaded = loadedByEntries();
    // The control: the entries were loaded at all.
    expect(loaded).toContain("next/cache.js");
    expect(loaded).toContain(
      "next/dist/client/components/navigation.react-server.js"
    );
    expect(
      loaded.filter(
        file => !file.startsWith("next/") && !file.startsWith("react/")
      )
    ).toEqual([]);
    expect(
      loaded.filter(file =>
        /route-modules\/pages|next-server\/pages|shared-runtime|navigation\.js$/.test(
          file
        )
      )
    ).toEqual([]);
  });

  it("names only patterns that match a file, so a renamed one fails here", async () => {
    expect(dirs).not.toBeNull();
    const empty: string[] = [];
    for (const pattern of NEXT_RUNTIME_PATTERNS) {
      const glob = posix(relative(ROOT, join(dirs?.real ?? "", pattern)));
      if ((await nextGlob(glob)).length === 0) empty.push(pattern);
    }
    expect(empty).toEqual([]);
  });

  it("covers every file the production require graph loaded untraced", () => {
    const uncovered = UNTRACED_CLOSURE.filter(
      file => !NEXT_RUNTIME_PATTERNS.some(pattern => matchesGlob(file, pattern))
    );
    expect(uncovered).toEqual([]);
  });

  it("gives each pattern under the project's link and under the real directory, each matching through Next's glob", async () => {
    const globs = nextRuntimeIncludes(ROOT);
    const linked = posix(relative(ROOT, dirs?.linked ?? ""));
    const real = posix(relative(ROOT, dirs?.real ?? ""));
    for (const pattern of NEXT_RUNTIME_PATTERNS) {
      expect(globs).toContain(`./${linked}/${pattern}`);
      expect(globs).toContain(
        real.startsWith("../") ? `${real}/${pattern}` : `./${real}/${pattern}`
      );
    }
    // The real directory, which is what a require from Nextly resolves to,
    // matches from the project directory, where Next.js runs the globs.
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
    expect(all).toContain("./node_modules/next/cache.js");
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
