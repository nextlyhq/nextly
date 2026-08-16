/**
 * A package may not advertise a wider React range than its own dependencies allow.
 *
 * `plugin-page-builder` advertised `^18.0.0 || ^19.0.0` while depending on
 * `@nextlyhq/blocks-react`, which requires `^19.0.0`. That combination does not
 * GIVE anyone React 18 — it hands a React 18 app an unsatisfiable peer graph and
 * an error naming a transitive package they did not install. The manifest was
 * making a promise its dependencies could not keep.
 *
 * Asserted from the manifests rather than restated as a literal, so the check
 * cannot drift from the values it is checking. A hand-written "react must be
 * ^19.0.0" would keep passing after a dependency widened, which is the case
 * worth catching.
 *
 * Scoped to workspace dependencies because those are the ones this repo can fix.
 * An external package that narrows its React range is a real problem too, but it
 * is not one a test in this repo can act on.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const PACKAGES = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface Manifest {
  name?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

function manifest(pkgDir: string): Manifest {
  return JSON.parse(
    readFileSync(join(PACKAGES, pkgDir, "package.json"), "utf8")
  ) as Manifest;
}

/** The workspace packages this one installs or requires, by directory name. */
function workspaceDependencies(m: Manifest): string[] {
  const all = { ...m.dependencies, ...m.peerDependencies };
  return Object.entries(all)
    .filter(
      ([name, range]) =>
        name.startsWith("@nextlyhq/") && /^workspace:/.test(range)
    )
    .map(([name]) => name.replace("@nextlyhq/", ""));
}

/** True when a range admits any React 18. */
function allowsReact18(range: string | undefined): boolean {
  return range !== undefined && /\^?18/.test(range);
}

describe("the React range this package advertises", () => {
  const self = manifest("plugin-page-builder");

  it("reads its own manifest, so the assertions below are not vacuous", () => {
    // Positive control. A misresolved path would make every check pass trivially.
    expect(self.name).toBe("@nextlyhq/plugin-page-builder");
    expect(Object.keys(self.peerDependencies ?? {}).length).toBeGreaterThan(0);
  });

  it("is no wider than every workspace dependency allows", () => {
    const ours = self.peerDependencies?.react;
    const offenders: string[] = [];
    const checked: string[] = [];

    for (const dir of workspaceDependencies(self)) {
      let theirs: string | undefined;
      try {
        theirs = manifest(dir).peerDependencies?.react;
      } catch {
        // Not every workspace name maps to a directory of the same name. A
        // package that cannot be read is reported rather than skipped silently,
        // because a skipped dependency is exactly how this check would go blind.
        offenders.push(`${dir} (manifest unreadable)`);
        continue;
      }
      if (theirs === undefined) continue;
      checked.push(dir);
      if (allowsReact18(ours) && !allowsReact18(theirs)) {
        offenders.push(`${dir} requires ${theirs}, we advertise ${ours}`);
      }
    }

    // The population assertion. Without it, a resolution change that found no
    // dependencies at all would satisfy the verdict below perfectly.
    expect(checked.length).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });

  it("matches the renderer it ships pages through", () => {
    // The separating property, named rather than implied: `blocks-react` is what
    // renders published pages, so a host that cannot satisfy ITS React range
    // cannot use this plugin for the thing the plugin exists to do.
    expect(manifest("blocks-react").peerDependencies?.react).toBe(
      self.peerDependencies?.react
    );
  });
});
