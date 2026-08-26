import { describe, expect, it } from "vitest";

import {
  changedPackageDirs,
  packageFilters,
  report,
  touchesScripts,
} from "./gate-scope.mjs";

describe("the packages a diff touches", () => {
  it("names each one once, whatever its file count", () => {
    expect(
      changedPackageDirs([
        "packages/plugin-page-builder/src/a.ts",
        "packages/plugin-page-builder/src/b.ts",
        "packages/plugin-sdk/src/index.ts",
      ])
    ).toEqual(["plugin-page-builder", "plugin-sdk"]);
  });

  it("names a package the author did not expect to touch", () => {
    // The case this module exists for. A gate list written from the package
    // the author has in mind cannot report the second one; a derivation does.
    expect(
      changedPackageDirs([
        "packages/plugin-page-builder/src/blocks-fields.ts",
        "packages/plugin-sdk/src/index.ts",
      ])
    ).toContain("plugin-sdk");
  });

  it("drops paths outside packages/ rather than mapping them to a package", () => {
    // A change to `scripts/` or `.github/` belongs to a root task. Attaching it
    // to a nearest package would gate the wrong thing while reporting coverage.
    expect(
      changedPackageDirs([
        "scripts/gate-scope.mjs",
        ".github/workflows/ci.yml",
        "README.md",
        "packages/ui/src/x.ts",
      ])
    ).toEqual(["ui"]);
  });

  it("ignores a bare packages/<dir> entry that names no file", () => {
    expect(changedPackageDirs(["packages/ui", "packages"])).toEqual([]);
  });

  it("returns nothing for a diff that touches no package", () => {
    // Must come out EMPTY rather than defaulting to every package: a gate list
    // that always names everything is not a derivation and would be ignored.
    expect(changedPackageDirs(["README.md", "scripts/x.mjs"])).toEqual([]);
  });
});

describe("turning directories into filters", () => {
  const manifests = {
    "plugin-sdk": { name: "@nextlyhq/plugin-sdk" },
    nextly: { name: "nextly" },
  };

  it("reads each filter from that package's own manifest", () => {
    // Derived, not restated: a rename cannot leave a filter pointing at
    // nothing, because the name comes from the file the rename edits.
    const { filters } = packageFilters(
      ["plugin-sdk", "nextly"],
      dir => manifests[dir]
    );

    expect(filters).toEqual(["@nextlyhq/plugin-sdk", "nextly"]);
  });

  it("REPORTS a directory whose manifest cannot be read", () => {
    // Skipping it would shrink the gate silently, which is the failure this
    // module exists to prevent. The likeliest cause is a package deleted in the
    // diff, and the author should see that rather than have it hidden.
    const { filters, unreadable } = packageFilters(
      ["plugin-sdk", "ghost"],
      dir => {
        if (dir === "ghost") throw new Error("ENOENT");
        return manifests[dir];
      }
    );

    expect(filters).toEqual(["@nextlyhq/plugin-sdk"]);
    expect(unreadable).toEqual(["ghost"]);
  });

  it("treats a manifest with no name as unreadable rather than as empty", () => {
    const { filters, unreadable } = packageFilters(["odd"], () => ({}));

    expect(filters).toEqual([]);
    expect(unreadable).toEqual(["odd"]);
  });
});

describe("the scripts/ task, which turbo run test does not reach", () => {
  it("is flagged when the diff touches scripts/", () => {
    expect(touchesScripts(["scripts/gate-scope.mjs"])).toBe(true);
  });

  it("is NOT flagged otherwise", () => {
    // The control: a flag that is always on tells the reader nothing and will
    // be ignored, which is worse than not printing it.
    expect(touchesScripts(["packages/ui/src/x.ts", "README.md"])).toBe(false);
  });
});

describe("the report", () => {
  it("lists a filter per package", () => {
    const text = report({
      filters: ["@nextlyhq/plugin-sdk", "nextly"],
      unreadable: [],
      scripts: false,
    });

    expect(text).toContain("--filter @nextlyhq/plugin-sdk");
    expect(text).toContain("--filter nextly");
    expect(text).not.toContain("test:scripts");
  });

  it("says so when nothing changed, rather than printing an empty list", () => {
    expect(report({ filters: [], unreadable: [], scripts: false })).toContain(
      "No workspace package changed"
    );
  });

  it("names the scripts task when it applies", () => {
    expect(
      report({ filters: [], unreadable: [], scripts: true })
    ).toContain("pnpm test:scripts");
  });

  it("surfaces unreadable directories instead of dropping them", () => {
    expect(
      report({ filters: [], unreadable: ["ghost"], scripts: false })
    ).toContain("packages/ghost");
  });
});
