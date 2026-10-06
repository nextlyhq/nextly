/**
 * The check on what the admin publishes, against small packages built for each
 * case it must refuse and for the ones it must let through.
 *
 * Every refusing case names the kind it expects, so a check that failed for
 * another reason, such as a fixture it could not read, does not pass here.
 * The package a real development-mode build produces is not a fixture: CI
 * builds one and runs the check on it with `--must-fail-with`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DEVELOPER_TOOLS_MARKER,
  ERROR_DETAIL_TEXTS,
  checkPublishedBuild,
  exportTargets,
  unreported,
} from "./check-published-build.mjs";

const made = [];

afterEach(() => {
  for (const directory of made.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

/** A package directory holding these files, named with `/`. */
function packageOf(files) {
  const directory = mkdtempSync(join(tmpdir(), "nx-published-build-"));
  made.push(directory);
  for (const [name, content] of Object.entries(files)) {
    const path = join(directory, ...name.split("/"));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return directory;
}

const MANIFEST = JSON.stringify({
  name: "fixture",
  exports: {
    ".": {
      types: "./dist/index.d.ts",
      import: "./dist/index.mjs",
      default: "./dist/index.mjs",
    },
    "./style.css": "./dist/style.css",
  },
});

const CONSTANTS = `const R = { DASHBOARD: "/admin", BUILDER_LIST: "/admin/builder/things", BUILDER_NEW: "/admin/builder/things/new" };`;

const ROUTE_TABLE = `const table = {
  [R.DASHBOARD]: { component: Dashboard },
  [R.BUILDER_LIST]: { component: List, requiresBuilder: true },
  [R.BUILDER_NEW]: { component: lazy(() => import("./builder-new.mjs")), requiresBuilder: true },
};`;

/** What a correct build's entry does: a route table, and a stream opened only on request. */
const ENTRY = `${CONSTANTS}
${ROUTE_TABLE}
export function enableDevReload() {
  return new EventSource(window.location.origin + "/admin/api/dev-reload");
}
export { table };`;

/** A correct package, with any files replaced or added. */
function correctPackage(overrides = {}) {
  return packageOf({
    "package.json": MANIFEST,
    "dist/index.d.ts": "export {};",
    "dist/index.mjs": ENTRY,
    "dist/builder-new.mjs": "export default function BuilderNew() {}",
    "dist/style.css": ".nextly-admin{}",
    ...overrides,
  });
}

async function kindsFor(directory) {
  const { problems } = await checkPublishedBuild(directory);
  return problems.map(problem => problem.kind);
}

describe("exportTargets", () => {
  it("reads a bare string, and conditions nested under an entry", () => {
    expect(exportTargets("./dist/a.mjs")).toEqual([
      { entry: ".", target: "dist/a.mjs" },
    ]);
    expect(
      exportTargets({
        ".": { types: "./dist/a.d.ts", import: { default: "./dist/a.mjs" } },
        "./b": "./dist/b.mjs",
      })
    ).toEqual([
      { entry: ".", target: "dist/a.d.ts" },
      { entry: ".", target: "dist/a.mjs" },
      { entry: "./b", target: "dist/b.mjs" },
    ]);
  });

  it("reads a manifest with no export map as naming nothing", () => {
    expect(exportTargets(undefined)).toEqual([]);
  });
});

describe("a correct package", () => {
  it("passes, and counts the modules it reached", async () => {
    const result = await checkPublishedBuild(correctPackage());
    expect(result.problems).toEqual([]);
    expect(result.modules).toBe(2);
  });

  it("passes while holding the developer tools in a chunk nothing imports", async () => {
    const directory = correctPackage({
      "dist/orphan.mjs": `export const panel = "${DEVELOPER_TOOLS_MARKER}parent-container";`,
    });
    expect(await kindsFor(directory)).toEqual([]);
  });

  it("passes when the mode is left to the application and production drops the rest", async () => {
    const directory = correctPackage({
      "dist/index.mjs": `${ENTRY}
export function Fallback(error) {
  if (process.env.NODE_ENV === "development") return ["${ERROR_DETAIL_TEXTS[0]}", error.stack];
  return "Something went wrong";
}
export const Devtools =
  process.env.NODE_ENV !== "development" ? () => null : () => import("./devtools.mjs");`,
      "dist/devtools.mjs": `export const panel = "${DEVELOPER_TOOLS_MARKER}parent-container";`,
    });
    expect(await kindsFor(directory)).toEqual([]);
  });
});

describe("a package that would show a production user development-only behaviour", () => {
  it.each(ERROR_DETAIL_TEXTS)(
    "is refused when reached code holds the error box's text %j",
    async text => {
      const directory = correctPackage({
        "dist/index.mjs": `${ENTRY}\nexport const box = ["${text}", e => e.stack];`,
      });
      const { problems } = await checkPublishedBuild(directory);
      expect(problems.map(problem => problem.kind)).toEqual(["error-detail"]);
      expect(problems[0].message).toContain(text);
      expect(problems[0].message).toContain("dist/index.mjs");
    }
  );

  it("is refused when the mode is left to the application and production keeps the box", async () => {
    const directory = correctPackage({
      "dist/index.mjs": `${ENTRY}
export function Fallback(error) {
  if (process.env.NODE_ENV === "production") return ["${ERROR_DETAIL_TEXTS[0]}", error.stack];
  return "Something went wrong";
}`,
    });
    expect(await kindsFor(directory)).toEqual(["error-detail"]);
  });

  it("is refused when reached code loads the developer tools", async () => {
    const directory = correctPackage({
      "dist/index.mjs": `${ENTRY}\nexport const Devtools = () => import("./devtools.mjs");`,
      "dist/devtools.mjs": `export const panel = "${DEVELOPER_TOOLS_MARKER}parent-container";`,
    });
    const { problems } = await checkPublishedBuild(directory);
    expect(problems.map(problem => problem.kind)).toEqual(["developer-tools"]);
    expect(problems[0].message).toContain("dist/devtools.mjs");
  });

  it.each([
    [
      "at the top of a module",
      `const es = new EventSource("/admin/api/dev-reload");`,
    ],
    [
      "inside a condition at the top of a module",
      `if (typeof window !== "undefined") { new EventSource("/admin/api/dev-reload"); }`,
    ],
    [
      "inside a function called where it is written",
      `(() => { new EventSource("/admin/api/dev-reload"); })();`,
    ],
  ])("is refused when it opens the reload stream %s", async (_where, code) => {
    const directory = correctPackage({ "dist/index.mjs": `${ENTRY}\n${code}` });
    expect(await kindsFor(directory)).toEqual(["eager-reload-stream"]);
  });
});

describe("a package that lacks a builder page", () => {
  it("is refused when the route table has no entry for a builder address", async () => {
    const withoutNew = ROUTE_TABLE.replace(
      /\n {2}\[R\.BUILDER_NEW\][^\n]*/,
      ""
    );
    expect(withoutNew).not.toContain("BUILDER_NEW");
    const directory = correctPackage({
      "dist/index.mjs": ENTRY.replace(ROUTE_TABLE, withoutNew),
    });
    const { problems } = await checkPublishedBuild(directory);
    expect(problems).toEqual([
      {
        kind: "missing-builder-page",
        message: "/admin/builder/things/new has no page in the route table",
      },
    ]);
  });

  it("is refused when the route table deletes a builder address as it loads", async () => {
    const directory = correctPackage({
      "dist/index.mjs": `${ENTRY}\ndelete table[R.BUILDER_NEW];`,
    });
    const { problems } = await checkPublishedBuild(directory);
    expect(problems).toEqual([
      {
        kind: "missing-builder-page",
        message:
          "/admin/builder/things/new is deleted from the route table at load",
      },
    ]);
  });

  it("is refused when no builder address can be read at all", async () => {
    const directory = correctPackage({
      "dist/index.mjs": `export const table = {};`,
    });
    expect(await kindsFor(directory)).toEqual(["builder-pages-unread"]);
  });
});

describe("a package with nothing to check", () => {
  it("is refused when it holds no build output", async () => {
    const directory = packageOf({ "package.json": MANIFEST });
    const kinds = await kindsFor(directory);
    expect(kinds).toContain("no-build-output");
    expect(kinds.filter(kind => kind === "missing-export-target")).toHaveLength(
      4
    );
  });

  it("is refused when it has no manifest", async () => {
    expect(await kindsFor(packageOf({}))).toEqual(["no-build-output"]);
  });

  it("is refused when the export map names a file the package does not hold", async () => {
    const directory = correctPackage();
    rmSync(join(directory, "dist", "style.css"));
    const { problems } = await checkPublishedBuild(directory);
    expect(problems).toEqual([
      {
        kind: "missing-export-target",
        message:
          'the export map\'s "./style.css" names dist/style.css, which the package does not hold',
      },
    ]);
  });

  it("is refused when reached code imports a file the package does not hold", async () => {
    const directory = correctPackage();
    rmSync(join(directory, "dist", "builder-new.mjs"));
    const { problems } = await checkPublishedBuild(directory);
    expect(problems).toEqual([
      {
        kind: "missing-module",
        message:
          "dist/builder-new.mjs is imported and the package does not hold it",
      },
    ]);
  });
});

describe("unreported", () => {
  it("names the kinds a build was expected to fail with and did not", () => {
    const problems = [{ kind: "error-detail", message: "" }];
    expect(unreported(["error-detail", "developer-tools"], problems)).toEqual([
      "developer-tools",
    ]);
    expect(unreported(["error-detail"], problems)).toEqual([]);
  });
});
