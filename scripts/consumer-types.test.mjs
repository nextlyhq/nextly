// The parts of the consumer type check that decide a verdict, on inputs whose
// answer is known: which declarations a manifest publishes and whether they
// can resolve, which diagnostics are ours, and whether the compiler read what
// it had to. The installs and compiler runs are exercised by the script itself
// in package-smoke.
import { describe, expect, it } from "vitest";

import {
  classifyDiagnostics,
  manifestProblems,
  pointAtTarballs,
  typedSubpaths,
  typeImportsSource,
  unread,
} from "./consumer-types.mjs";
import { parseJsonc } from "./jsonc.mjs";

/** A packed package as readTarball returns it. */
const pkg = (name, exportsField, files, extra = {}) => ({
  name,
  manifest: { name, exports: exportsField, ...extra },
  files: new Set(files),
});

describe("the subpaths a package publishes types for", () => {
  it("reads every exports shape the packages use", () => {
    const subpaths = typedSubpaths(
      pkg("nextly", {
        ".": { types: "./dist/index.d.mts", import: "./dist/index.mjs" },
        "./config": {
          import: { types: "./dist/config.d.mts", default: "./dist/config.mjs" },
          require: { types: "./dist/config.d.cts", default: "./dist/config.cjs" },
        },
        "./zod": { types: "./dist/zod.d.ts", default: "./dist/zod.js" },
      })
    );
    expect(subpaths).toEqual([
      { specifier: "nextly", import: "./dist/index.d.mts", require: undefined },
      { specifier: "nextly/config", import: "./dist/config.d.mts", require: "./dist/config.d.cts" },
      { specifier: "nextly/zod", import: "./dist/zod.d.ts", require: undefined },
    ]);
  });

  it("leaves out what has no types to check", () => {
    expect(
      typedSubpaths(
        pkg("@nextlyhq/ui", {
          "./styles.css": "./dist/styles.css",
          "./package.json": "./package.json",
          "./icons/*": { types: "./dist/icons/*.d.mts", import: "./dist/icons/*.mjs" },
        })
      )
    ).toEqual([]);
  });
});

describe("what is wrong with a packed manifest", () => {
  const exportsField = {
    ".": { types: "./dist/index.d.mts", import: "./dist/index.mjs" },
    "./node": {
      import: { types: "./dist/node.d.mts", default: "./dist/node.mjs" },
      require: { types: "./dist/node.d.cts", default: "./dist/node.cjs" },
    },
  };
  const files = ["package.json", "dist/index.d.mts", "dist/index.mjs", "dist/node.d.mts", "dist/node.mjs", "dist/node.d.cts", "dist/node.cjs"];

  it("finds nothing wrong with a complete one", () => {
    expect(manifestProblems(pkg("x", exportsField, files, { types: "./dist/index.d.mts" }))).toEqual([]);
  });

  it("names a types path the tarball does not hold", () => {
    expect(manifestProblems(pkg("x", exportsField, files.filter(f => f !== "dist/node.d.mts")))).toEqual([
      "x/node (import): types ./dist/node.d.mts is not in the tarball",
    ]);
  });

  it("names a missing top-level types file", () => {
    expect(manifestProblems(pkg("x", exportsField, files, { types: "./dist/gone.d.ts" }))).toEqual([
      'x: "types" names ./dist/gone.d.ts, which the tarball does not hold',
    ]);
  });

  it("names declarations of the wrong module format, either way round", () => {
    const swapped = {
      "./node": {
        import: { types: "./dist/node.d.cts", default: "./dist/node.mjs" },
        require: { types: "./dist/node.d.mts", default: "./dist/node.cjs" },
      },
    };
    expect(manifestProblems(pkg("x", swapped, files))).toEqual([
      "x/node (import): types ./dist/node.d.cts is the wrong format for import",
      "x/node (require): types ./dist/node.d.mts is the wrong format for require",
    ]);
  });
});

describe("the check files", () => {
  const subpaths = [
    { specifier: "nextly", import: "./dist/index.d.mts" },
    { specifier: "nextly/config", import: "./dist/config.d.mts", require: "./dist/config.d.cts" },
  ];

  it("imports every subpath's types for ESM, and uses each binding", () => {
    const source = typeImportsSource(subpaths, "esm");
    expect(source).toContain('import type * as subpath0 from "nextly";');
    expect(source).toContain('import type * as subpath1 from "nextly/config";');
    expect(source).toContain("export type Everything = [typeof subpath0, typeof subpath1];");
  });

  it("requires only the subpaths with a require condition", () => {
    const source = typeImportsSource(subpaths, "cjs");
    expect(source).toContain('import subpath1 = require("nextly/config");');
    expect(source).not.toContain('"nextly";');
  });
});

describe("whose diagnostics they are", () => {
  const ourNames = new Set(["nextly", "@nextlyhq/admin"]);
  const output = [
    "consumer-types.check.ts(3,1): error TS2307: Cannot find module 'nextly/gone'.",
    "node_modules/nextly/dist/config.d.mts(10,5): error TS2304: Cannot find name 'Broken'.",
    "node_modules/@nextlyhq/admin/dist/index.d.mts(2,1): error TS2322: Type 'string' is not assignable to type 'number'.",
    "  The expected type comes from property 'x'.",
    "node_modules/drizzle-orm/mysql-core/query.d.ts(4,4): error TS2344: Type 'A' does not satisfy the constraint 'B'.",
    "Found 4 errors in 4 files.",
  ].join("\n");

  it("counts the project's files and our packages as ours, and nothing else", () => {
    const { ours, thirdParty } = classifyDiagnostics(output, ourNames);
    expect(ours.map(d => d.file)).toEqual([
      "consumer-types.check.ts",
      "node_modules/nextly/dist/config.d.mts",
      "node_modules/@nextlyhq/admin/dist/index.d.mts",
    ]);
    expect(thirdParty.map(d => d.file)).toEqual(["node_modules/drizzle-orm/mysql-core/query.d.ts"]);
  });

  it("keeps a diagnostic's continuation lines with it", () => {
    const { ours } = classifyDiagnostics(output, ourNames);
    expect(ours[2].text).toContain("The expected type comes from property 'x'.");
  });
});

describe("whether the compiler read what it had to", () => {
  const expected = ["node_modules/nextly/dist/index.d.mts", "node_modules/nextly/dist/config.d.mts"];

  it("names a declaration missing from the files it listed", () => {
    const listed = "/w/app/node_modules/nextly/dist/index.d.mts\n/w/app/consumer-types.check.ts\n";
    expect(unread(expected, listed)).toEqual(["node_modules/nextly/dist/config.d.mts"]);
  });

  it("names nothing when every one was read", () => {
    const listed = expected.map(path => `/w/app/${path}`).join("\n");
    expect(unread(expected, listed)).toEqual([]);
  });
});

describe("pointing a scaffolded project at the tarballs", () => {
  it("rewrites each Nextly dependency, adds the rest, and overrides them all", () => {
    const tarballs = new Map([
      ["nextly", "/t/nextly.tgz"],
      ["@nextlyhq/admin", "/t/admin.tgz"],
      ["@nextlyhq/plugin-sdk", "/t/sdk.tgz"],
    ]);
    const manifest = {
      dependencies: { nextly: "0.0.2-alpha.68", next: "16.4.2" },
      devDependencies: { "@nextlyhq/plugin-sdk": "0.0.2-alpha.68", typescript: "^5" },
    };
    expect(pointAtTarballs(manifest, tarballs, ["@nextlyhq/admin", "@nextlyhq/plugin-sdk"])).toEqual({
      dependencies: { nextly: "file:/t/nextly.tgz", next: "16.4.2", "@nextlyhq/admin": "file:/t/admin.tgz" },
      devDependencies: { "@nextlyhq/plugin-sdk": "file:/t/sdk.tgz", typescript: "^5" },
      overrides: {
        nextly: "file:/t/nextly.tgz",
        "@nextlyhq/admin": "file:/t/admin.tgz",
        "@nextlyhq/plugin-sdk": "file:/t/sdk.tgz",
      },
    });
    // The scaffold's own manifest is left as it was.
    expect(manifest.dependencies.nextly).toBe("0.0.2-alpha.68");
  });
});

describe("JSON with comments", () => {
  it("drops comments outside strings and trailing commas, and keeps a URL's slashes", () => {
    expect(
      parseJsonc('{\n  // a note\n  "url": "https://x/y", /* block */\n  "list": [1, 2,],\n}')
    ).toEqual({ url: "https://x/y", list: [1, 2] });
  });
});
