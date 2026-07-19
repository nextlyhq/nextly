/**
 * The plugin-author API surface is a contract.
 *
 * `@nextlyhq/plugin-sdk` is documented as "the ONLY stable import surface for
 * plugin authors" — every third-party plugin (and the page builder) compiles
 * against these exports. Removing or renaming one silently breaks installed
 * plugins on a host upgrade. This snapshots the exported names of each public
 * subpath so any change fails CI and forces an intentional review (and, for a
 * real removal, a changeset/major-ish note). It reads the source rather than
 * importing it, so the check does not pull the admin client bundle into Node.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC = path.dirname(fileURLToPath(import.meta.url));

/**
 * Extract each export as `"<name> (value|type)"` from a module's source. Covers
 * the export forms this package uses: `export { … } from`, `export type { … }
 * from`, inline `export { type X }` (with `as` aliases), and `export
 * function/class/const/interface/enum/type X`.
 *
 * The kind is tracked, not just the name, so converting a runtime value export
 * to a type-only export (or back) changes the snapshot — that swap keeps the
 * name but can break a plugin at runtime, so it must not pass silently. Star
 * re-exports (`export *`) are NOT parsed here; the test below fails if one is
 * introduced, since it would add untracked names to the surface.
 */
function exportedNames(file: string): string[] {
  const source = readFileSync(path.join(SRC, file), "utf8");
  const kinds = new Map<string, "value" | "type">();

  // Named export/re-export blocks (possibly multi-line). `export type { … }`
  // makes the whole block type-only; an inline `type ` prefix marks one entry.
  for (const m of source.matchAll(/export\s+(type\s+)?\{([\s\S]*?)\}/g)) {
    const blockIsType = Boolean(m[1]);
    for (const raw of m[2].split(",")) {
      let entry = raw.trim();
      if (!entry) continue;
      let kind: "value" | "type" = blockIsType ? "type" : "value";
      if (/^type\s+/.test(entry)) {
        kind = "type";
        entry = entry.replace(/^type\s+/, "");
      }
      // `X as Y` exports the name after `as`.
      const asMatch = entry.match(/\bas\s+([A-Za-z0-9_$]+)$/);
      kinds.set(asMatch ? asMatch[1] : entry, kind);
    }
  }
  // Direct declaration exports. `interface`/`type` are type-only; the rest
  // (`function`/`class`/`const`/`let`/`var`/`enum`) are runtime values.
  for (const m of source.matchAll(
    /export\s+(?:async\s+)?(function|class|const|let|var|interface|enum|type)\s+([A-Za-z0-9_$]+)/g
  )) {
    kinds.set(m[2], m[1] === "interface" || m[1] === "type" ? "type" : "value");
  }
  return [...kinds.entries()].map(([name, kind]) => `${name} (${kind})`).sort();
}

describe("plugin-sdk public export surface", () => {
  it("`.` (index) surface is unchanged", () => {
    expect(exportedNames("index.ts")).toMatchSnapshot();
  });

  it("`./admin` surface is unchanged", () => {
    expect(exportedNames("admin.ts")).toMatchSnapshot();
  });

  it("`./client` surface is unchanged", () => {
    expect(exportedNames("client.ts")).toMatchSnapshot();
  });

  // The name/kind extractor cannot see through `export *` re-exports, so a star
  // export would add names to the public surface that the snapshots never
  // record. Fail loudly if one is introduced, so the guard stays complete.
  it.each(["index.ts", "admin.ts", "client.ts"])(
    "%s uses only named exports (no `export *`, which the guard cannot track)",
    file => {
      const source = readFileSync(path.join(SRC, file), "utf8");
      expect(source).not.toMatch(/export\s+\*/);
    }
  );
});
