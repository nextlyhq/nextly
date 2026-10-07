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
 * The source file behind every subpath `package.json` publishes, read from
 * the manifest rather than listed here: a hand-kept list is how a published
 * subpath went unguarded.
 */
const PUBLISHED_FILES: string[] = Object.keys(
  (
    JSON.parse(readFileSync(path.join(SRC, "..", "package.json"), "utf8")) as {
      exports: Record<string, unknown>;
    }
  ).exports
)
  .map(subpath => (subpath === "." ? "index.ts" : `${subpath.slice(2)}.ts`))
  .sort();

/** The files a snapshot test below covers. */
const SNAPSHOTTED = [
  "admin.ts",
  "blocks.ts",
  "client.ts",
  "db.ts",
  "index.ts",
  "routing.ts",
  "schema.ts",
  "testing.ts",
  "widgets.ts",
];

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

  it("`./routing` surface is unchanged", () => {
    expect(exportedNames("routing.ts")).toMatchSnapshot();
  });

  it("`./widgets` surface is unchanged", () => {
    expect(exportedNames("widgets.ts")).toMatchSnapshot();
  });

  it("`./db` surface is unchanged", () => {
    expect(exportedNames("db.ts")).toMatchSnapshot();
  });

  it("`./blocks` surface is unchanged", () => {
    expect(exportedNames("blocks.ts")).toMatchSnapshot();
  });

  it("`./testing` surface is unchanged", () => {
    expect(exportedNames("testing.ts")).toMatchSnapshot();
  });

  it("`./schema` surface is unchanged", () => {
    expect(exportedNames("schema.ts")).toMatchSnapshot();
  });

  it("snapshots every subpath the package publishes", () => {
    // A subpath added to `exports` without a snapshot here fails this, so
    // the surface it publishes is reviewed like every other one.
    expect(PUBLISHED_FILES).toEqual(SNAPSHOTTED);
  });

  it("takes the slug rule from the LEAF entry, not the route bundle", () => {
    // 🔴 The surface snapshot above cannot see this: both spellings export the
    // same name, so the SDK's public surface is identical either way. What
    // differs is what a consumer installs behind it. `nextly/runtime` is the
    // built route bundle, which has already inlined this function beside its
    // eager Direct API imports — measured through package resolution at 3,251
    // inputs and 21.3 MB, against 5 and 1.4 KB through the leaf entry. Every
    // plugin that draws a sitemap pays whichever one this line names.
    //
    // 🔴 Matched as a STATEMENT, not as text. This module's docblock discusses
    // `nextly/runtime` at length — it is the graph the entry exists to avoid —
    // so a plain substring check reports the prose and never reads the import.
    const source = readFileSync(path.join(SRC, "routing.ts"), "utf8");
    const reexports = [
      ...source.matchAll(/^export\s[^;]*?from\s+"([^"]+)"/gm),
    ].map(m => m[1]);
    expect(reexports).toContain("nextly/route-path");
    expect(reexports).not.toContain("nextly/runtime");
  });

  // The name/kind extractor cannot see through `export *` re-exports, so a star
  // export would add names to the public surface that the snapshots never
  // record. Fail loudly if one is introduced, so the guard stays complete.
  it.each(PUBLISHED_FILES)(
    "%s uses only named exports (no `export *`, which the guard cannot track)",
    file => {
      const source = readFileSync(path.join(SRC, file), "utf8");
      expect(source).not.toMatch(/export\s+\*/);
    }
  );
});
