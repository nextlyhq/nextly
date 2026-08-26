import { describe, expect, it } from "vitest";

import {
  changedPackageDirs,
  filterArguments,
  filtersRefusal,
  workspaceDirsOf,
  workspaceGlobs,
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

describe("the workspace roots, which are not only packages/", () => {
  // `pnpm-workspace.yaml` declares `apps/*`, `packages/*` and the bare `e2e`.
  // A mapper that knows only `packages/` drops a change to an app or to the
  // browser suite silently — and silence is the failure this module exists to
  // remove.
  const GLOBS = ["apps/*", "packages/*", "e2e"];

  it("maps a packages/ path", () => {
    expect(workspaceDirsOf(["packages/ui/src/x.ts"], GLOBS)).toEqual([
      "packages/ui",
    ]);
  });

  it("maps an apps/ path", () => {
    expect(workspaceDirsOf(["apps/playground/app/page.tsx"], GLOBS)).toEqual([
      "apps/playground",
    ]);
  });

  it("maps a BARE workspace entry that has no wildcard", () => {
    expect(workspaceDirsOf(["e2e/tests/a.spec.ts"], GLOBS)).toEqual(["e2e"]);
  });

  it("drops a path in no workspace root", () => {
    // The control. A mapper that returned something for every path would
    // satisfy the three cases above and name a package for `README.md`.
    expect(workspaceDirsOf(["README.md", "scripts/x.mjs"], GLOBS)).toEqual([]);
  });

  it("ignores a bare root entry naming no file", () => {
    expect(workspaceDirsOf(["packages/ui", "packages"], GLOBS)).toEqual([]);
  });
});

describe("reading the workspace roots from pnpm-workspace.yaml", () => {
  it("takes every list entry, quoted or bare", () => {
    expect(
      workspaceGlobs(
        [
          "packages:",
          '  - "apps/*"',
          '  - "packages/*"',
          "  # a comment, and the bare entry below it",
          "  - e2e",
        ].join("\n")
      )
    ).toEqual(["apps/*", "packages/*", "e2e"]);
  });

  it("returns nothing for a file that declares no list", () => {
    // Must be EMPTY rather than defaulting to `packages/*`: a silent default
    // is how the mapper came to know one root and drop the other two.
    expect(workspaceGlobs("packages:\n")).toEqual([]);
  });
});

describe("the machine-readable form a hook consumes", () => {
  it("emits one flag per package", () => {
    expect(
      filterArguments(["@nextlyhq/plugin-sdk", "nextly"]).split("\n")
    ).toEqual(["--filter=@nextlyhq/plugin-sdk", "--filter=nextly"]);
  });

  it("emits NOTHING when no package changed", () => {
    // The caller tests for an empty string to decide whether to run at all.
    // Emitting a placeholder would turn "nothing changed" into a whole-repo
    // sweep, which is the version of this nobody would keep enabled.
    expect(filterArguments([])).toBe("");
  });
});

describe("refusing a scope that would silently omit a workspace", () => {
  it("REFUSES when a manifest cannot be read", () => {
    // The consumed mode emits no filter for such a directory — there is no
    // package name to give — so a hook reading it would see an empty value and
    // run nothing. A change that DELETES a workspace manifest would then pass
    // its gate having tested nothing at all, which is the silent
    // under-scoping this module exists to remove, reappearing in the one mode
    // written to be consumed rather than read.
    const refusal = filtersRefusal(["packages/prettier-config"]);

    expect(refusal).toContain("packages/prettier-config");
    expect(refusal).toContain("refusing");
  });

  it("does NOT refuse when every manifest was readable", () => {
    // The control: a refusal that always fired would block every push and be
    // disabled within the day.
    expect(filtersRefusal([])).toBeNull();
  });
});
