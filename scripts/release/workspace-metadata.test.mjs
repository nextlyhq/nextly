import { describe, expect, it } from "vitest";

import {
  findMissingPublishFields,
  getReleaseManifest,
  rootEnginesRange,
} from "./lib.mjs";

/**
 * Every publishable package carries the metadata a publish needs, checked
 * against THIS workspace.
 *
 * `preflight.test.mjs` exercises the same rules against constructed fixtures,
 * which proves the rules and says nothing about the packages: a real package
 * missing `repository.directory` satisfies every one of those cases. The
 * difference matters because of WHEN each one answers. Preflight runs at
 * release time, so a package added with incomplete metadata is correct all the
 * way through review and blocks the train that ships everything else.
 *
 * Derived from the release library rather than restating its rules, for the
 * reason a second copy always drifts: a field added to `REQUIRED_FIELDS` is
 * enforced here the moment it is added, without anyone remembering this file.
 */
describe("every publishable package can actually be published", () => {
  const manifest = getReleaseManifest();

  it("reads the packages at all, so the rules below are not vacuous", () => {
    // The control. An "everything is fine" assertion over an empty list passes
    // perfectly, and this list comes off the filesystem.
    expect(manifest.length).toBeGreaterThan(10);
  });

  it("includes the first-party plugins, so the population is the real one", () => {
    // Membership rather than a count: a selector that drops one package and
    // picks up another matches any total. These are named because a plugin is
    // the kind of package most likely to be added next.
    const names = manifest.map(entry => entry.name);
    expect(names).toContain("@nextlyhq/plugin-mcp");
    expect(names).toContain("@nextlyhq/plugin-seo");
    expect(names).toContain("nextly");
  });

  it("leaves none of them missing a field a publish needs", () => {
    const offenders = manifest
      .map(entry => ({
        name: entry.name,
        missing: findMissingPublishFields(entry.pkg),
      }))
      .filter(entry => entry.missing.length > 0);

    expect(offenders).toEqual([]);
  });

  it("reports a package that IS missing one, so silence means checked", () => {
    // The discriminating control. Every assertion above is satisfied by a
    // checker that finds nothing under any circumstances, and that checker is
    // exactly what this file exists to not be.
    const withoutLicence = { ...manifest[0].pkg };
    delete withoutLicence.license;

    expect(findMissingPublishFields(withoutLicence)).toContain("license");
  });

  it("holds every package to the repository's own Node range", () => {
    // Not a restatement of the range: it is read from the root manifest, which
    // is also where `package-smoke.yml` derives the versions it tests. A
    // package advertising more than that claims support for versions nothing
    // ever runs, and the user finds out at runtime rather than at install.
    const engines = rootEnginesRange();
    const drifted = manifest
      .filter(entry => entry.pkg.engines?.node !== engines)
      .map(entry => `${entry.name}: ${entry.pkg.engines?.node}`);

    expect(drifted).toEqual([]);
  });
});
