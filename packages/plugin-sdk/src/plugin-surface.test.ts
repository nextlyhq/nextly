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
 * Extract the exported identifier names from a module's source. Covers the
 * export forms this package uses: `export { … } from`, `export type { … } from`
 * (with `as` aliases), and `export function/class/const/interface/enum/type X`.
 */
function exportedNames(file: string): string[] {
  const source = readFileSync(path.join(SRC, file), "utf8");
  const names = new Set<string>();

  // Named export/re-export blocks (possibly multi-line).
  for (const m of source.matchAll(/export\s+(?:type\s+)?\{([\s\S]*?)\}/g)) {
    for (const raw of m[1].split(",")) {
      const entry = raw.trim().replace(/^type\s+/, "");
      if (!entry) continue;
      // `X as Y` exports the name after `as`.
      const asMatch = entry.match(/\bas\s+([A-Za-z0-9_$]+)$/);
      names.add(asMatch ? asMatch[1] : entry);
    }
  }
  // Direct declaration exports.
  for (const m of source.matchAll(
    /export\s+(?:async\s+)?(?:function|class|const|let|var|interface|enum|type)\s+([A-Za-z0-9_$]+)/g
  )) {
    names.add(m[1]);
  }
  return [...names].sort();
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
});
