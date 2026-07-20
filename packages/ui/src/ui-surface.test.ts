/**
 * The UI kit's export surface is a contract.
 *
 * `@nextlyhq/ui` is the presentational half of the plugin-author API: every
 * plugin's admin components compile against these exports, so removing or
 * renaming one breaks installed plugins on a host upgrade. This snapshots the
 * exported names of each published entry point so a change fails CI and forces
 * an intentional review against `STABILITY.md`.
 *
 * It reads the source rather than importing it: the root barrel is published
 * with `"use client"` and pulls in the whole component tree, which does not
 * belong in a Node test process.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC = path.dirname(fileURLToPath(import.meta.url));

/** The entry points named in the package's `exports` map. */
const ENTRY_POINTS = ["index.ts", "lib/utils.ts", "tailwind-preset.ts"];

/**
 * Extract each export as `"<name> (value|type)"` from a module's source. Covers
 * the export forms this package uses: `export { … } from`, `export type { … }
 * from`, inline `export { type X }` (with `as` aliases), and `export
 * function/class/const/interface/enum/type X`.
 *
 * The kind is tracked, not just the name, so converting a runtime value export
 * to a type-only export (or back) changes the snapshot — that swap keeps the
 * name but can break a consumer at runtime, so it must not pass silently.
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
  // A default export is part of the surface too, and is not named above.
  if (/export\s+default\s/.test(source)) kinds.set("default", "value");

  return [...kinds.entries()].map(([name, kind]) => `${name} (${kind})`).sort();
}

describe("ui public export surface", () => {
  it.each(ENTRY_POINTS)("%s surface is unchanged", file => {
    expect(exportedNames(file)).toMatchSnapshot();
  });

  // The name/kind extractor cannot see through `export *` re-exports, so a star
  // export would add names to the public surface that the snapshots never
  // record. Fail loudly if one is introduced, so the guard stays complete.
  it.each(ENTRY_POINTS)(
    "%s uses only named exports (no `export *`, which the guard cannot track)",
    file => {
      const source = readFileSync(path.join(SRC, file), "utf8");
      expect(source).not.toMatch(/export\s+\*/);
    }
  );

  // The ledger is what plugin authors read; a public export that vanished from
  // it, or one documented but never shipped, is a broken promise either way.
  it("documents every export named in STABILITY.md as @public", () => {
    const ledger = readFileSync(path.join(SRC, "..", "STABILITY.md"), "utf8");
    const stableSection = ledger.slice(
      ledger.indexOf("## Stable surface"),
      ledger.indexOf("## Experimental surface")
    );
    // Names in the table's `Exports` column, written as `` `Name` ``.
    const documented = [
      ...new Set(
        [...stableSection.matchAll(/`([A-Z][A-Za-z0-9]*)`/g)].map(m => m[1])
      ),
    ];
    const shipped = new Set(
      exportedNames("index.ts").map(entry => entry.replace(/ \(.*\)$/, ""))
    );

    const missing = documented.filter(name => !shipped.has(name));
    expect(
      missing,
      `STABILITY.md lists these as @public but the barrel does not export ` +
        `them: ${missing.join(", ")}`
    ).toEqual([]);
  });
});
