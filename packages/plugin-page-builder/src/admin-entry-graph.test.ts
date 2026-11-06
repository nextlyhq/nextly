/**
 * What the browser entries may reach: no call-time `import()` of the root of
 * `@nextlyhq/plugin-sdk`.
 *
 * That root re-exports `nextly`, whose boot reaches Node built-ins (`fs`,
 * `net`, `tls`, `module`). A static named import of it is tree-shaken to the
 * names used, but a call-time `import()` takes the whole namespace, and a
 * browser bundler resolves it as well: the admin page's production build then
 * fails on modules a browser cannot have. A server path that needs the root at
 * call time keeps it in a module no browser entry reaches.
 *
 * Walks the source graph from each browser entry through relative imports,
 * static and dynamic, so a module the entry reaches only through a shared
 * helper is still seen.
 *
 * @module admin-entry-graph.test
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

/** The browser entries the package publishes. */
const BROWSER_ENTRIES = [
  "admin/index.ts",
  "canvas/index.tsx",
  "blocks/index.ts",
];

/** The specifiers a source file loads at call time, with `import()`. */
function callTimeSpecifiers(source: string): string[] {
  return [...source.matchAll(/import\(\s*"([^"]+)"\s*\)/g)].map(
    match => match[1] as string
  );
}

/** Every specifier a source file names, in a static import, an export-from or an `import()`. */
function specifiers(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(
    /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s*"([^"]+)"/g
  )) {
    found.push(match[1] as string);
  }
  for (const match of source.matchAll(/^\s*import\s*"([^"]+)"/gm)) {
    found.push(match[1] as string);
  }
  for (const match of source.matchAll(/import\(\s*"([^"]+)"\s*\)/g)) {
    found.push(match[1] as string);
  }
  return found;
}

/** The source file a relative specifier names, or `undefined` outside the package. */
function resolveRelative(from: string, specifier: string): string | undefined {
  const base = resolve(dirname(from), specifier.replace(/\.js$/, ""));
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** Every module an entry reaches, with the external specifiers each loads at call time. */
function graphOf(entry: string): Map<string, string[]> {
  const seen = new Map<string, string[]>();
  const queue = [join(SRC_DIR, entry)];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    const source = readFileSync(file, "utf8");
    const named = specifiers(source);
    seen.set(
      file,
      callTimeSpecifiers(source).filter(specifier => !specifier.startsWith("."))
    );
    for (const specifier of named) {
      if (!specifier.startsWith(".")) continue;
      const next = resolveRelative(file, specifier);
      if (next !== undefined) queue.push(next);
    }
  }
  return seen;
}

/**
 * The roots whose namespace reaches Node built-ins: the SDK root re-exports
 * `nextly`, and `nextly/runtime` aggregates the request lifecycle.
 */
const SERVER_ROOTS = ["@nextlyhq/plugin-sdk", "nextly", "nextly/runtime"];

/** The reached modules that load a server root at call time, relative to `src`. */
function namingTheSdkRoot(entry: string): string[] {
  return [...graphOf(entry)]
    .filter(([, external]) =>
      external.some(specifier => SERVER_ROOTS.includes(specifier))
    )
    .map(([file]) => file.slice(SRC_DIR.length + 1))
    .sort();
}

describe("what the browser entries reach", () => {
  for (const entry of BROWSER_ENTRIES) {
    it(`reaches no call-time import of a server root from ${entry}`, () => {
      expect(namingTheSdkRoot(entry)).toEqual([]);
    });
  }

  it("CONTROL: the walk reaches the shared site-style modules from the admin entry", () => {
    // A walk that stopped at the entry would satisfy the assertions above for
    // ever; the admin reaches these only through other modules.
    const reached = [...graphOf("admin/index.ts").keys()].map(file =>
      file.slice(SRC_DIR.length + 1)
    );
    expect(reached).toContain("site-style.ts");
    expect(reached).toContain("site-style-storage.ts");
    expect(reached.length).toBeGreaterThan(50);
  });

  it("CONTROL: the walk sees a call-time import of the root", () => {
    // The package root's plugin reaches the root at call time on purpose; a
    // reader that could not see that form would pass a browser entry that does.
    expect(namingTheSdkRoot("index.ts")).toContain("plugin.ts");
  });
});
