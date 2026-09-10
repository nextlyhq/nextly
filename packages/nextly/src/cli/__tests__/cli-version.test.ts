/**
 * `nextly --version` reports the version that shipped.
 *
 * The constant used to be typed by hand under a comment saying it "should match
 * package.json version". It did not: the CLI answered `0.1.0` while the package
 * shipped `0.0.2-alpha.65`, so anyone — or any agent — asking the tool which
 * Nextly they were working against got a confident wrong answer, and telemetry
 * attributed every CLI event to a version that has never been published.
 *
 * A comment is not a control, which is what this is.
 *
 * @module cli/__tests__/cli-version.test
 */
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import { getCoreVersion } from "../../plugins/core-version";
import { CLI_VERSION } from "../program";

const pkg = createRequire(import.meta.url)("../../../package.json") as {
  version?: string;
};

describe("the version the CLI reports", () => {
  it("is the version this package publishes", () => {
    // The population: a package.json with no version would satisfy an equality
    // between two empty values.
    expect(pkg.version).toBeTruthy();
    expect(CLI_VERSION).toBe(pkg.version);
  });

  it("is the same answer the plugin resolver validates ranges against", () => {
    // Two version constants is how this drifted. A plugin declaring a `nextly`
    // range is checked against `getCoreVersion`, so a CLI reporting something
    // else would tell a user their range is satisfied by a version the resolver
    // never saw.
    expect(CLI_VERSION).toBe(getCoreVersion());
  });

  it("is not the sentinel the resolver falls back to", () => {
    // `getCoreVersion` never throws: with no injected constant and no readable
    // package.json it answers "0.0.0". Without this, the two assertions above
    // are satisfied by both sides being equally uninformative.
    expect(CLI_VERSION).not.toBe("0.0.0");
    expect(CLI_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
