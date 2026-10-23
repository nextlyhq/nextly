import { describe, expect, it } from "vitest";

import {
  byVersion,
  lockstepFailure,
  lockstepMismatches,
} from "./check-lockstep.mjs";

/** Manifest entries as `getReleaseManifest` returns them, with an empty manifest of their own. */
const at = (version, ...names) =>
  names.map(name => ({ name, version, pkg: {} }));

describe("lockstepMismatches", () => {
  it("finds none when every package shares one version", () => {
    expect(
      lockstepMismatches(
        at("0.0.2-alpha.69", "@nextlyhq/admin", "@nextlyhq/ui", "nextly")
      )
    ).toEqual([]);
  });

  it("names a package added after a Version Packages refresh, still on the old version", () => {
    // Sorted by name, as the manifest is, so the train's version comes first here.
    const manifest = [
      ...at("0.0.2-alpha.69", "@nextlyhq/admin", "@nextlyhq/plugin-a"),
      ...at("0.0.2-alpha.68", "@nextlyhq/plugin-new"),
      ...at("0.0.2-alpha.69", "nextly"),
    ];
    expect(lockstepMismatches(manifest)).toEqual([
      { name: "@nextlyhq/plugin-new", version: "0.0.2-alpha.68" },
    ]);
  });

  it("still reports the split when the odd package sorts first", () => {
    const manifest = [
      ...at("0.0.2-alpha.68", "@nextlyhq/aaa-new"),
      ...at("0.0.2-alpha.69", "@nextlyhq/admin", "nextly"),
    ];
    expect(lockstepMismatches(manifest)).toHaveLength(2);
  });
});

describe("lockstepFailure", () => {
  const manifest = [
    ...at("0.0.2-alpha.68", "@nextlyhq/aaa-new"),
    ...at("0.0.2-alpha.69", "@nextlyhq/admin", "nextly"),
  ];

  it("groups the packages by version, the largest group first", () => {
    expect(byVersion(manifest)).toEqual([
      ["0.0.2-alpha.69", ["@nextlyhq/admin", "nextly"]],
      ["0.0.2-alpha.68", ["@nextlyhq/aaa-new"]],
    ]);
  });

  it("prints each version's packages and how to refresh the pull request", () => {
    const text = lockstepFailure(manifest);
    expect(text).toContain("0.0.2-alpha.69 (2): @nextlyhq/admin, nextly");
    expect(text).toContain("0.0.2-alpha.68 (1): @nextlyhq/aaa-new");
    expect(text).toContain("Run workflow");
  });
});
