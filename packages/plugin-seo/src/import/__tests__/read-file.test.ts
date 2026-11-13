/**
 * The export readers run in the browser, which reads a file before only
 * what it holds is sent: so every module they load, followed import by
 * import from `read-file`, loads nothing from the server, and each is read
 * here rather than listed, so a new import is followed too.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const HERE = path.resolve(import.meta.dirname, "..");

/**
 * The modules `text` loads at run time: an import (type-only ones aside), a
 * bare `import "x"`, and a re-export `export … from "x"`.
 */
function runtimeImports(text: string): string[] {
  return [
    ...text.matchAll(
      /^(?:import|export)\s+(?!type\s)(?:[^;]*?\sfrom\s+)?["']([^"']+)["'];/gms
    ),
  ].map(match => match[1] ?? "");
}

/** Every module `entry` loads, followed through relative imports. */
function loaded(entry: string): Map<string, string[]> {
  const seen = new Map<string, string[]>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    const imports = runtimeImports(readFileSync(file, "utf8"));
    seen.set(file, imports);
    for (const spec of imports.filter(each => each.startsWith("."))) {
      visit(path.resolve(path.dirname(file), `${spec}.ts`));
    }
  };
  visit(entry);
  return seen;
}

describe("the scan of what a module loads", () => {
  it("sees every form a module can load another by, and skips type-only ones", () => {
    expect(
      runtimeImports(
        [
          'import "server-only";',
          'import { a } from "./a";',
          'export { b } from "./b";',
          'export * from "./c";',
          'import type { D } from "./d";',
          'export type { E } from "./e";',
        ].join("\n")
      )
    ).toEqual(["server-only", "./a", "./b", "./c"]);
  });
});

describe("the export readers", () => {
  it("load nothing from the server, so the browser can run them", () => {
    const modules = loaded(path.join(HERE, "read-file.ts"));
    // The readers themselves are among them.
    expect([...modules.keys()].map(file => path.basename(file))).toEqual(
      expect.arrayContaining(["csv.ts", "payload.ts", "wordpress.ts"])
    );
    for (const [file, imports] of modules) {
      const outside = imports.filter(spec => !spec.startsWith("."));
      expect({ file: path.basename(file), outside }).toEqual({
        file: path.basename(file),
        outside: [],
      });
    }
  });
});
