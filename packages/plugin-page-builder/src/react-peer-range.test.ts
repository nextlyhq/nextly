/**
 * A package may not advertise a wider React range than its own dependencies allow.
 *
 * `plugin-page-builder` advertised `^18.0.0 || ^19.0.0` while depending on
 * `@nextlyhq/blocks-react`, which requires `^19.0.0`. That combination does not
 * GIVE anyone React 18 — it hands a React 18 app an unsatisfiable peer graph and
 * an error naming a transitive package they did not install. The manifest was
 * making a promise its dependencies could not keep.
 *
 * "Wider" is decided by semver range SUBSET rather than by matching version
 * numerals in the range string. A numeral test only ever answers the question it
 * spells out — an earlier form of this file asked "does the range mention 18",
 * which is silent on `^19.0.0` against a dependency that has moved to `^20.0.0`,
 * silent on this package widening to `^19.0.0 || ^20.0.0`, and wrong in the
 * reporting direction on `19.x`, which mentions no caret and no 19.0.0 while
 * denoting the same set. The property that decides compatibility is whether
 * every React version satisfying OUR range also satisfies THEIRS, so that is
 * what is asked.
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

import { subset, validRange } from "semver";
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

/**
 * Why `ours` promises more than `theirs` can deliver, or `null` when it does not.
 *
 * An unparseable range on either side is REPORTED rather than skipped. Treating
 * it as compatible would let a typo silence the check for that dependency, which
 * is the failure this whole file exists to prevent, one level up.
 */
function widerThan(ours: string, theirs: string): string | null {
  if (validRange(ours) === null)
    return `our range ${ours} is not a valid range`;
  if (validRange(theirs) === null)
    return `their range ${theirs} is not a valid range`;
  if (subset(ours, theirs)) return null;
  return `requires ${theirs}, we advertise ${ours}`;
}

describe("the React range this package advertises", () => {
  const self = manifest("plugin-page-builder");

  it("reads its own manifest, so the assertions below are not vacuous", () => {
    // Positive control. A misresolved path would make every check pass trivially.
    expect(self.name).toBe("@nextlyhq/plugin-page-builder");
    expect(Object.keys(self.peerDependencies ?? {}).length).toBeGreaterThan(0);
  });

  describe("the comparison it decides that with", () => {
    // The predicate is exercised directly on known answers, because the
    // manifest-driven assertion below reports nothing while the workspace is
    // consistent — and silence is the same output whether the comparison works
    // or cannot see anything at all.

    it("reports a range wider than the dependency allows", () => {
      // Each of these is a real shape a numeral test answers wrongly. The first
      // is the defect that prompted the file; the rest involve no 18 at all.
      expect(widerThan("^18.0.0 || ^19.0.0", "^19.0.0")).not.toBeNull();
      expect(widerThan("^19.0.0", "^20.0.0")).not.toBeNull();
      expect(widerThan("^19.0.0 || ^20.0.0", "^19.0.0")).not.toBeNull();
    });

    it("stays silent when our range is equal or narrower", () => {
      expect(widerThan("^19.0.0", "^19.0.0")).toBeNull();
      expect(widerThan("^19.2.0", "^19.0.0")).toBeNull();
      expect(widerThan("^19.0.0", "^18.0.0 || ^19.0.0")).toBeNull();
      // Denotes the same set as `^19.0.0` while sharing none of its spelling —
      // the case a string comparison reports and a subset check does not.
      expect(widerThan("19.x", "^19.0.0")).toBeNull();
    });

    it("reports a range it cannot parse rather than passing it", () => {
      expect(widerThan("nonsense", "^19.0.0")).not.toBeNull();
      expect(widerThan("^19.0.0", "nonsense")).not.toBeNull();
    });
  });

  it("is no wider than every workspace dependency allows", () => {
    const ours = self.peerDependencies?.react;
    const offenders: string[] = [];
    const checked: string[] = [];

    // Our own range missing is a violation, not a pass: this package renders
    // React and every dependency below constrains it.
    if (ours === undefined) {
      offenders.push("this package declares no react peer range");
    }

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
      const why = ours === undefined ? null : widerThan(ours, theirs);
      if (why !== null) offenders.push(`${dir} ${why}`);
    }

    // The population assertion, by MEMBERSHIP rather than by count. A count is
    // satisfied by a selector that drops the renderer and picks up something
    // else, which would leave the one dependency that decides this unexamined.
    expect(checked).toContain("blocks-react");
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
