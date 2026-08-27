import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/** This module's sibling script, resolved from here rather than from the cwd. */
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "gate-scope.mjs");

import {
  changedPaths,
  filterArguments,
  filtersFor,
  filtersRefusal,
  report,
  touchesScripts,
  workspaceRootsOf,
  workspacesFrom,
} from "./gate-scope.mjs";

/** The workspaces pnpm reports for this repository, in pnpm's own shape. */
const PNPM = [
  { name: "nextly-project-setup", path: "/repo" },
  { name: "@nextlyhq/plugin-page-builder", path: "/repo/packages/plugin-page-builder" },
  { name: "@nextlyhq/plugin-sdk", path: "/repo/packages/plugin-sdk" },
  { name: "@nextlyhq/ui", path: "/repo/packages/ui" },
  { name: "playground", path: "/repo/apps/playground" },
  { name: "@nextlyhq/e2e", path: "/repo/e2e" },
];
const WS = workspacesFrom(PNPM, "/repo");
const filtersOf = paths => filtersFor(paths, WS).filters;

describe("the packages a diff touches", () => {
  it("names each one once, whatever its file count", () => {
    expect(
      filtersOf([
        "packages/plugin-page-builder/src/a.ts",
        "packages/plugin-page-builder/src/b.ts",
        "packages/plugin-sdk/src/index.ts",
      ])
    ).toEqual(["@nextlyhq/plugin-page-builder", "@nextlyhq/plugin-sdk"]);
  });

  it("names a package the author did not expect to touch", () => {
    // The case this module exists for. A gate list written from the package
    // the author has in mind cannot report the second one; a derivation does.
    expect(
      filtersOf([
        "packages/plugin-page-builder/src/blocks-fields.ts",
        "packages/plugin-sdk/src/index.ts",
      ])
    ).toContain("@nextlyhq/plugin-sdk");
  });

  it("gates a workspace that is under neither packages/ nor apps/", () => {
    // `e2e` is declared as a bare directory. A mapper that assumed a wildcard
    // root would drop it, and the browser suite would never be gated.
    expect(filtersOf(["e2e/tests/canvas/acceptance.spec.ts"])).toEqual([
      "@nextlyhq/e2e",
    ]);
  });

  it("gates an app, not only a package", () => {
    expect(filtersOf(["apps/playground/app/page.tsx"])).toEqual(["playground"]);
  });

  it("attaches a root-level path to NO workspace", () => {
    // A change to `scripts/` or `.github/` belongs to a root task. Attaching it
    // to a nearest package would gate the wrong thing while reporting coverage.
    // The repository root is itself a workspace pnpm lists, and its directory
    // is a prefix of every path — so this also asserts the root was dropped.
    expect(
      filtersOf([
        "scripts/gate-scope.mjs",
        ".github/workflows/ci.yml",
        "README.md",
        "packages/ui/src/x.ts",
      ])
    ).toEqual(["@nextlyhq/ui"]);
  });

  it("ignores a bare workspace directory that names no file", () => {
    expect(filtersOf(["packages/ui", "packages"])).toEqual([]);
  });

  it("returns nothing for a diff that touches no workspace", () => {
    // Must come out EMPTY rather than defaulting to every package: a gate list
    // that always names everything is not a derivation and would be ignored.
    expect(filtersOf(["README.md", "scripts/x.mjs"])).toEqual([]);
  });

  it("keeps a path Git would have QUOTED", () => {
    // Under the default `core.quotePath` a non-ASCII path comes back quoted, so
    // it began with `"` and matched no workspace — the only changed package was
    // dropped and the gate ran nothing. The commands ask for NUL-delimited
    // output now, which is neither quoted nor escaped, so the raw path arrives.
    expect(filtersOf(["packages/ui/src/é.ts"])).toEqual(["@nextlyhq/ui"]);
  });
});

describe("the workspaces pnpm reports", () => {
  it("drops the repository root, whose directory prefixes every path", () => {
    // Keeping it would match everything and collapse the scope to one filter.
    expect(WS.map(w => w.name)).not.toContain("nextly-project-setup");
  });

  it("orders them longest directory first, so a nested workspace wins", () => {
    const nested = workspacesFrom(
      [
        { name: "outer", path: "/repo/packages/outer" },
        { name: "inner", path: "/repo/packages/outer/inner" },
      ],
      "/repo"
    );
    expect(filtersFor(["packages/outer/inner/x.ts"], nested).filters).toEqual([
      "inner",
    ]);
  });

  it("ignores an entry with no usable name", () => {
    // A filter built from an empty name matches nothing, so it would shrink the
    // gate while reading as coverage.
    expect(
      workspacesFrom([{ name: "", path: "/repo/packages/x" }], "/repo")
    ).toEqual([]);
  });

  it("derives the roots from the workspaces themselves", () => {
    // Read back from the list rather than from the globs, so the two cannot
    // disagree about where a workspace lives. A bare directory contributes no
    // root and needs none — it matches itself.
    expect(workspaceRootsOf(WS)).toEqual(["apps", "packages"]);
  });
});

describe("a workspace the diff removed", () => {
  it("is REPORTED rather than dropped, at the path it actually had", () => {
    // Dropping it shrinks the gate for the very change that deleted a package.
    // The path is rendered as derived: re-rooting it produced
    // `packages/packages/ui` and `packages/apps/playground`, nonexistent paths
    // in the one message whose job is to name what could not be gated.
    const { filters, unreadable } = filtersFor(
      ["packages/deleted-pkg/src/x.ts", "apps/gone/a.ts"],
      WS
    );

    expect(filters).toEqual([]);
    expect(unreadable).toEqual(["apps/gone", "packages/deleted-pkg"]);
  });

  it("catches a workspace whose ROOT went with it", () => {
    // The root-based check cannot see this. Roots are derived from the
    // workspaces pnpm currently lists, so removing the last workspace under a
    // root — or the bare `e2e` entry, which contributes no root at all — takes
    // the root away too. The paths then match nothing and the removal passes
    // with neither a filter nor a refusal, which is the one diff the refusal
    // exists for. The deleted manifest is what survives to name it.
    const survivors = workspacesFrom(
      [
        { name: "nextly-project-setup", path: "/repo" },
        { name: "@nextlyhq/ui", path: "/repo/packages/ui" },
      ],
      "/repo"
    );

    const { filters, unreadable } = filtersFor(
      [
        "e2e/tests/a.spec.ts",
        "e2e/package.json",
        "apps/playground/app/page.tsx",
        "apps/playground/package.json",
      ],
      survivors
    );

    expect(filters).toEqual([]);
    expect(unreadable).toEqual(["apps/playground", "e2e"]);
  });

  it("does not mistake a manifest INSIDE a live workspace for a removal", () => {
    // A fixture or a nested example carries its own `package.json`. The
    // workspace owns the path first, so it never reaches the removal check.
    expect(
      filtersFor(["packages/ui/fixtures/package.json"], WS)
    ).toEqual({ filters: ["@nextlyhq/ui"], unreadable: [] });
  });

  it("does NOT report a root-level path as a missing workspace", () => {
    // `scripts/` and `.github/` are under no workspace root, so there is
    // nothing missing — refusing here would refuse every tooling change.
    expect(filtersFor(["scripts/x.mjs", ".github/w.yml"], WS).unreadable).toEqual(
      []
    );
  });

  it("does not report a bare root path, which names no workspace directory", () => {
    expect(filtersFor(["packages/README.md"], WS).unreadable).toEqual([]);
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
    // Rendered exactly as derived. Prepending a root here turned
    // `apps/playground` into `packages/apps/playground` — a path that exists
    // nowhere, in the one message whose job is to name the workspace that
    // could not be gated.
    const rendered = report({
      filters: [],
      unreadable: ["apps/playground", "packages/ghost"],
      scripts: false,
    });

    expect(rendered).toContain("packages/ghost");
    expect(rendered).toContain("apps/playground");
    expect(rendered).not.toContain("packages/apps/playground");
    expect(rendered).not.toContain("packages/packages/ghost");
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

describe("against a real repository, where Git decides how paths arrive", () => {
  // The unit cases above hand the derivation raw paths, so they cannot see how
  // Git was ASKED for them. These build a throwaway repository instead: they
  // are the only tests that fail if the commands stop requesting NUL-delimited
  // output or start detecting renames again.
  const run = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8" });

  /** A repository with one workspace, a base commit, and a branch off it. */
  function repo() {
    const dir = mkdtempSync(join(tmpdir(), "gate-scope-"));
    run(dir, ["init", "-q", "-b", "main"]);
    run(dir, ["config", "user.email", "t@example.com"]);
    run(dir, ["config", "user.name", "t"]);
    // Left at its default ON, which is what quotes a non-ASCII path.
    mkdirSync(join(dir, "packages", "ui", "src"), { recursive: true });
    writeFileSync(join(dir, "packages", "ui", "package.json"), '{"name":"@nextlyhq/ui"}');
    writeFileSync(join(dir, "packages", "ui", "src", "a.ts"), "export const a = 1;\n");
    run(dir, ["add", "-A"]);
    run(dir, ["commit", "-qm", "base"]);
    // The work happens on a BRANCH: the derivation diffs the merge base, so a
    // change committed onto the base itself would compare a commit with itself
    // and report nothing — an empty result that reads exactly like "clean".
    run(dir, ["checkout", "-q", "-b", "feature"]);
    return dir;
  }

  /** The script's own path collection, run against a real repository. */
  const changedIn = dir => changedPaths(dir, "main");

  it("sees an ordinary change at all, which the two cases below rely on", () => {
    // The control. Both cases assert a path is PRESENT, and an empty result
    // would fail them for the wrong reason — a broken fixture rather than a
    // lost path. This says the harness reports anything.
    const dir = repo();
    writeFileSync(join(dir, "packages", "ui", "src", "b.ts"), "export const b = 1;\n");
    run(dir, ["add", "-A"]);
    run(dir, ["commit", "-qm", "ordinary"]);

    expect(changedIn(dir)).toEqual(["packages/ui/src/b.ts"]);
  });

  it("does not lose a path Git would have quoted", () => {
    // With `core.quotePath` at its default, `git diff --name-only` returns
    // "packages/ui/src/\303\251.ts" — starting with a quote, so it matched no
    // workspace and the only changed package was dropped in silence.
    const dir = repo();
    writeFileSync(join(dir, "packages", "ui", "src", "é.ts"), "export const e = 1;\n");
    run(dir, ["add", "-A"]);
    run(dir, ["commit", "-qm", "add non-ascii"]);

    expect(changedIn(dir)).toContain("packages/ui/src/é.ts");
  });

  it("reports BOTH sides when a file moves out of a workspace", () => {
    // Rename detection reports a move as the destination alone, so a workspace
    // that LOST a file was not gated — though it is the one whose build could
    // break. Detection off, Git reports the delete and the add separately.
    const dir = repo();
    mkdirSync(join(dir, "docs"), { recursive: true });
    run(dir, ["mv", "packages/ui/src/a.ts", "docs/a.ts"]);
    run(dir, ["commit", "-qm", "move out"]);

    const paths = changedIn(dir);
    expect(paths).toContain("packages/ui/src/a.ts");
    expect(paths).toContain("docs/a.ts");
  });
})
