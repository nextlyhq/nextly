/**
 * The packages carry no code for Next.js or React releases nextly does not
 * support: no per-API feature detection, no branch on a Next.js or React
 * version, and no fallback for Next.js 14 or 15 or React 18. nextly imports the
 * supported releases' APIs directly, through `runtime/next-api.ts` where it must
 * load them lazily, and refuses any other release when it starts. Nor do they
 * call `unstable_noStore`, whose job under Cache Components is `connection()`'s.
 *
 * A scan over source, so each pattern carries its own positive control: a
 * pattern that matches nothing passes this check for ever.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = new URL("..", import.meta.url).pathname;

/** Each pattern, with code it must find and code of the supported releases it must not. */
export const OLD_FRAMEWORK_PATTERNS = [
  {
    name: "per-API feature detection of a Next.js export",
    // Any spelling of `typeof <export> === "function"`: through a member
    // (`mod.after`, `mod?.after`, `mod["after"]`), or as a bare name, which is
    // how a destructured export is tested. Bare names only for the exports
    // whose names are Next.js's own: `after`, `headers` and `cookies` are
    // ordinary variable names too (`plugins/entity-transforms.ts` tests a
    // local `after`). The limits, stated rather than implied: a
    // destructured `after`, `headers` or `cookies`, and an export held under
    // another name first (`const fn = mod.after; typeof fn`), are not seen.
    // The structural guard is that every Next.js API is reached through
    // `runtime/next-api.ts`.
    pattern:
      /typeof\s+(?:[\w$.?]+(?:\?\.|\.|\[\s*["'])(?:unstable_cache|revalidateTag|revalidatePath|unstable_noStore|notFound|after|unstable_after|unstable_rethrow|draftMode|cookies|headers)["']?\s*\]?|(?:unstable_cache|revalidateTag|revalidatePath|unstable_noStore|notFound|unstable_after|unstable_rethrow|draftMode))\s*[!=]==\s*["']function["']/,
    finds: [
      'typeof mod.unstable_cache === "function"',
      'typeof mod?.after === "function"',
      'typeof mod["after"] === "function"',
      "typeof mod['revalidateTag'] !== 'function'",
      'typeof unstable_rethrow === "function"',
    ],
    // A field of nextly's own that shares a Next.js export's name is not one,
    // and destructuring an export to call it is how it is used.
    passes: [
      'requireNextApi(mod, "next/cache", "unstable_cache")',
      'typeof stored.after !== "string"',
      'typeof row.headers === "object"',
      'const { draftMode } = await import("next/headers")',
      'typeof afterward === "function"',
      'typeof after === "function"',
    ],
  },
  {
    // A call or a load by name. Prose naming it in backticks is not one, so a
    // comment explaining what replaced it stays legal.
    name: "a call to unstable_noStore",
    pattern: /\bunstable_noStore\s*\(|["']unstable_noStore["']/,
    finds: [
      'requireNextApi(mod, "next/cache", "unstable_noStore")',
      "unstable_noStore();",
      "const noStore = mod['unstable_noStore'];",
    ],
    passes: [
      'requireNextApi(mod, "next/server", "connection")',
      "opts out with `unstable_noStore`, the model it replaces",
      "noStore: true",
    ],
  },
  {
    name: "Next.js 15.0's unstable_after",
    pattern: /\bunstable_after\b/,
    finds: "mod.unstable_after",
    passes: "mod.after",
  },
  {
    // Only the option Next.js 14 needed and nextly no longer writes. The
    // deprecated `experimental.serverComponentsExternalPackages` is not here:
    // supported releases still read it, and create-nextly-app must name it to
    // refuse a config that has it.
    name: "Next.js 14's instrumentation opt-in",
    pattern: /experimental[\s\S]{0,40}\binstrumentationHook\s*:/,
    finds: "experimental: { instrumentationHook: true }",
    passes: "export function instrumentationHook(configImport: string)",
  },
  {
    name: "a Next.js 14 or 15 branch or note",
    // A bare "Next 15" only capitalised: "the next 15" is ordinary prose.
    pattern: /\bNext\s*1[45]\b|\^14\s*\|\||\b(?:major|version)\s*<\s*1[56]\b/,
    finds: "draftMode() is sync on Next 14",
    passes: [
      "Next.js 16.4 passes route params as a Promise",
      "the next 15 rows",
    ],
  },
  {
    name: "Next.js 14 or 15 named in any case",
    pattern: /\bnext\.js\s*1[45]\b/i,
    finds: "works on next.js 15 as well",
    passes: "next.js 16.4 reads the top-level option",
  },
  {
    name: "React 18 named in any case",
    pattern: /\breact(?:[\s-]+dom)?\s*18\b/i,
    finds: "correct under react 18 too",
    passes: "react 19 counts a settled-node promise",
  },
  {
    name: "a read of the installed React version",
    pattern: /\bReact\.version\b|["']react(?:-dom)?\/package\.json["']/,
    finds: 'require("react/package.json")',
    passes: 'import { useSyncExternalStore } from "react"',
  },
];

/** The package source this holds: every non-test file under packages/<name>/src. */
function sourceFiles() {
  const files = [];
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "__tests__" || entry.name === "node_modules")
          continue;
        walk(path);
      } else if (
        /\.(?:ts|tsx|mts|js|mjs)$/.test(entry.name) &&
        !/\.test(?:-d)?\.[mc]?[jt]sx?$/.test(entry.name)
      ) {
        files.push(path);
      }
    }
  };
  for (const pkg of readdirSync(join(ROOT, "packages"), {
    withFileTypes: true,
  })) {
    if (!pkg.isDirectory()) continue;
    const src = join(ROOT, "packages", pkg.name, "src");
    try {
      readdirSync(src);
    } catch {
      continue;
    }
    walk(src);
  }
  return files;
}

describe("code for unsupported Next.js and React releases", () => {
  for (const { name, pattern, finds, passes } of OLD_FRAMEWORK_PATTERNS) {
    it(`the ${name} pattern finds its example and passes the supported form`, () => {
      for (const old of [finds].flat()) {
        expect(pattern.test(old), old).toBe(true);
      }
      for (const supported of [passes].flat()) {
        expect(pattern.test(supported), supported).toBe(false);
      }
    });
  }

  it("is in no package's source", () => {
    const files = sourceFiles();
    const read = new Set(files.map(file => relative(ROOT, file)));
    // The scan reached the packages it holds, including the lazy loader itself.
    expect(files.length).toBeGreaterThan(1000);
    expect(read.has("packages/nextly/src/runtime/next-api.ts")).toBe(true);
    expect(
      read.has("packages/create-nextly-app/src/generators/next-config.ts")
    ).toBe(true);
    const found = files.flatMap(file => {
      const text = readFileSync(file, "utf8");
      return OLD_FRAMEWORK_PATTERNS.filter(({ pattern }) =>
        pattern.test(text)
      ).map(({ name }) => `${relative(ROOT, file)}: ${name}`);
    });
    expect(found).toEqual([]);
  });
});
