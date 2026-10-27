/**
 * The Next.js and React versions every published package and template
 * accepts: 16.4.1 and 19.3.0 onward, within those majors, and nothing older.
 * CI builds and tests only these, so a wider peer range would promise support
 * nothing checks. A later minor is accepted, since semver keeps a minor
 * compatible; a new major is accepted only once a release raises these ranges.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// The ranges have one home, which `create-nextly-app` also holds an existing app to.
import { SUPPORTED_RANGES as SUPPORTED } from "../packages/create-nextly-app/src/supported-versions.ts";

const manifests = ["packages", "templates"].flatMap(root =>
  readdirSync(new URL(`../${root}/`, import.meta.url), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => `${root}/${entry.name}/package.json`)
    .filter(path => existsSync(new URL(`../${path}`, import.meta.url)))
    .map(path => ({ path, manifest: JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8")) }))
);
// Each peer naming one of these packages, as `path name range`.
const peers = manifests.flatMap(({ path, manifest }) =>
  Object.entries(manifest.peerDependencies ?? {})
    .filter(([name]) => name in SUPPORTED)
    .map(([name, range]) => ({ path, name, range }))
);

describe("the Next.js and React versions nextly accepts", () => {
  it("are read from the packages that name them", () => {
    expect(manifests.length).toBeGreaterThan(20);
    expect(new Set(peers.map(peer => peer.path)).size).toBeGreaterThanOrEqual(9);
    expect(new Set(peers.map(peer => peer.name))).toEqual(new Set(Object.keys(SUPPORTED)));
  });

  it("are exactly the supported range in every peer: no lower floor, no missing cap, no other alternative", () => {
    const off = peers.filter(peer => peer.range !== SUPPORTED[peer.name]).map(peer => `${peer.path} ${peer.name} ${peer.range}`);
    expect(off).toEqual([]);
  });

  it("are left to the app in every published package, never installed by one", () => {
    const installed = manifests
      .filter(({ manifest }) => manifest.private !== true)
      .flatMap(({ path, manifest }) =>
        Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies })
          .filter(name => name in SUPPORTED)
          .map(name => `${path} ${name}`)
      );
    expect(installed).toEqual([]);
  });
});
