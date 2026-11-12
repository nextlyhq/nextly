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

/** The relative modules `file` loads at run time (type-only imports aside). */
function runtimeImports(file: string): string[] {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(/^import (?!type )[^;]*?from "([^"]+)";/gms)].map(
    match => match[1] ?? ""
  );
}

/** Every module `entry` loads, followed through relative imports. */
function loaded(entry: string): Map<string, string[]> {
  const seen = new Map<string, string[]>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    const imports = runtimeImports(file);
    seen.set(file, imports);
    for (const spec of imports.filter(each => each.startsWith("."))) {
      visit(path.resolve(path.dirname(file), `${spec}.ts`));
    }
  };
  visit(entry);
  return seen;
}

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
