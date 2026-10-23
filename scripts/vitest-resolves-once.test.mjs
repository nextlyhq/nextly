/**
 * Vitest, and every `@vitest/*` package, resolves to one instance.
 *
 * pnpm installs a package once per set of peers it resolves, and Vitest has
 * `@types/node` among its peers. Importers that reached different `@types/node`
 * versions got a vitest each, and a second copy is not harmless: a library
 * that imports vitest itself (`@testing-library/jest-dom/vitest`) extends the
 * other copy's `expect`, which broke `rejects` in admin. One `@types/node`
 * across the workspace, the root included, is what keeps the copies at one;
 * this holds it there.
 *
 * Read from `pnpm-lock.yaml`'s `snapshots` section, where pnpm writes one key
 * per instance it installs.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const LOCKFILE = fileURLToPath(new URL("../pnpm-lock.yaml", import.meta.url));

/** The package a snapshot key names: `vitest@5.0.5(…)` or `'@vitest/ui@5.0.5(…)'`. */
function packageOf(key) {
  const bare = key.replace(/^'|'?:( \{\})?$/g, "");
  return bare.slice(0, bare.indexOf("@", 1));
}

/** The keys of every `snapshots` section, one per installed instance. */
function snapshotKeys(lockfile) {
  return lockfile
    .split(/^snapshots:$/m)
    .slice(1)
    .flatMap(section => section.split(/\n(?=\S)/)[0].split("\n"))
    .filter(line => /^ {2}\S/.test(line))
    .map(line => line.trim());
}

/** How many instances of each package a lockfile's `snapshots` section installs. */
export function instancesByPackage(lockfile) {
  const counts = new Map();
  for (const name of snapshotKeys(lockfile).map(packageOf)) {
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}

const isVitest = name => name === "vitest" || name.startsWith("@vitest/");

describe("vitest in the lockfile", () => {
  it("counts a package installed under two peer sets as two", () => {
    const fixture = [
      "snapshots:",
      "",
      "  vitest@5.0.5(@types/node@20.19.17):",
      "    dependencies: {}",
      "",
      "  vitest@5.0.5(@types/node@22.20.5):",
      "    dependencies: {}",
      "",
      "  '@vitest/spy@5.0.5': {}",
    ].join("\n");
    const counts = instancesByPackage(fixture);
    expect(counts.get("vitest")).toBe(2);
    expect(counts.get("@vitest/spy")).toBe(1);
  });

  it("installs vitest and each @vitest/* package once", () => {
    const counts = instancesByPackage(readFileSync(LOCKFILE, "utf8"));
    // The control: the section was found and vitest is in it.
    expect(counts.get("vitest")).toBeGreaterThanOrEqual(1);
    const duplicated = [...counts]
      .filter(([name, count]) => isVitest(name) && count > 1)
      .map(([name, count]) => `${name} x${count}`);
    expect(duplicated).toEqual([]);
  });
});
