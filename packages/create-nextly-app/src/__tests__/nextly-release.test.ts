/**
 * Which source a run's Nextly packages come from, from the options it was
 * given: this CLI's release on the default paths, the alpha line for a
 * template from a disk or a branch, and local builds with --use-yalc.
 */
import { describe, expect, it } from "vitest";

import { nextlySource } from "../lib/nextly-release";

const cliVersion = "0.0.2-alpha.40";

describe("nextlySource", () => {
  it("is this CLI's release when no source is asked for", () => {
    expect(nextlySource({ cliVersion })).toEqual({
      kind: "release",
      cliVersion,
    });
  });

  it.each([
    ["--local-template", { localTemplatePath: "/tmp/templates" }],
    ["a --branch", { branch: "feature/x" }],
    // With no default, an explicit main is a source asked for too.
    ["--branch main", { branch: "main" }],
  ])("is the alpha line with %s", (_label, options) => {
    expect(nextlySource({ cliVersion, ...options })).toEqual({
      kind: "alpha",
      cliVersion,
    });
  });

  it("is yalc with --use-yalc, whatever else is given", () => {
    expect(nextlySource({ cliVersion, useYalc: true, branch: "main" })).toEqual(
      { kind: "yalc", cliVersion }
    );
  });

  // A build whose version names no one release was never published as one.
  it("is the alpha line for a version that names no one release", () => {
    expect(nextlySource({ cliVersion: "workspace:*" }).kind).toBe("alpha");
  });
});
