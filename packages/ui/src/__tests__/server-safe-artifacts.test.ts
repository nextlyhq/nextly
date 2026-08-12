/**
 * The reading the artifact gate does, checked against sources it will never see in a build.
 *
 * The gate itself runs in `build:js` and is the real assertion: it compares what each built
 * server-safe artifact reaches against the allow-list. What it cannot do is prove it would still
 * catch a crossing that is not currently present — the artifacts are clean, so every run of it
 * passes for the same reason whether the reading is right or wrong.
 *
 * These cover that: the specifier reader and the package classifier are exercised against the
 * spellings a bundler emits, including the ones that would let a real dependency through unseen.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  bundledPackages,
  disallowedSpecifiers,
  packageOf,
  packageOfInput,
  reachedFrom,
  specifiersIn,
} from "../../scripts/check-server-safe-artifacts.mjs";
import { SERVER_SAFE_ALLOWED_PACKAGES } from "../../scripts/published-entries.mjs";

const read = (source: string): string[] => specifiersIn(source, "artifact.mjs");

describe("reading an artifact's specifiers", () => {
  it("finds every form a bundler emits", () => {
    expect(
      read(`
        import { clsx } from "clsx";
        export * from "tailwind-merge";
        const lazy = import("react");
        const cjs = require("react-dom");
      `)
    ).toEqual(["clsx", "tailwind-merge", "react", "react-dom"]);
  });

  it("reads a backtick specifier, which is not a string literal", () => {
    // `import(\`react\`)` parses as a no-substitution template. A reader that checks only for a
    // string literal records it as unreadable at best, and silently skips it at worst.
    expect(read("const lazy = import(`react`);")).toEqual(["react"]);
  });

  it("resolves a shadowed require against the scoping rules the language has", () => {
    // The CJS build calls its own `require`, so the one question the scope reader still answers is
    // whether a call reaches the AMBIENT loader or a local of that name. These cases each cost a
    // review round when the reader modelled scope one example at a time, so they are pinned
    // together rather than as separate suites.
    const ambient = ["react"];
    const shadowed: string[] = [];

    // `var` is FUNCTION-scoped however deeply nested, and a nested function owns its own.
    expect(
      read(
        `function f() { { var require = (n) => n; } return require("react"); }`
      )
    ).toEqual(shadowed);
    expect(
      read(
        `function f() { for (var require = (n) => n; false; ) {} return require("react"); }`
      )
    ).toEqual(shadowed);
    expect(
      read(
        `function o() { function i() { var require = (n) => n; } return require("react"); }`
      )
    ).toEqual(ambient);
    // `let` stays in its block, which is what makes the above a `var` rule.
    expect(
      read(
        `function f() { { let require = (n) => n; } return require("react"); }`
      )
    ).toEqual(ambient);
    // A class static block is its own `var` scope, in both directions.
    expect(
      read(`class C { static { var require = (n) => n; require("react"); } }`)
    ).toEqual(shadowed);
    expect(
      read(
        `class C { static { var require = (n) => n; } }\nexport const r = require("react");`
      )
    ).toEqual(ambient);
    // A switch's CaseBlock is one scope shared by its clauses, and does not escape the switch.
    expect(
      read(
        `function f(k) { switch (k) { case 0: const require = (n) => n; return require("react"); } }`
      )
    ).toEqual(shadowed);
    expect(
      read(
        `function f(k) { switch (k) { case 0: const require = (n) => n; } return require("react"); }`
      )
    ).toEqual(ambient);
    // A named class binds its own name throughout its body.
    expect(
      read(
        `const C = class require { static f() { return require("react"); } };`
      )
    ).toEqual(shadowed);
    // A default parameter initializer runs before the body's `var`s exist.
    expect(read(`function f(x = require("react")) { var require; }`)).toEqual(
      ambient
    );
    expect(
      read(`function f(require, x = require("react")) { return x; }`)
    ).toEqual(shadowed);
    // Destructuring binds without an identifier in `node.name`.
    expect(
      read(
        `const { require } = loaders;\nexport const label = require("react");`
      )
    ).toEqual(shadowed);
    // And an unrelated nested binding cannot reach a top-level call.
    expect(
      read(
        `function unrelated(require) { return require; }\nconst react = require("react");`
      )
    ).toEqual(ambient);
  });

  it("does not treat a locally declared require as the loader", () => {
    // A module declaring its own `require` is not reaching the CommonJS loader, so its argument is
    // not a module specifier. Reported, it rejects an artifact with no dependency at all -- the
    // expensive direction, since a lane whose code is correct gets a red build.
    expect(
      read(`
        const require = (name) => name.toUpperCase();
        export const label = require("react");
      `)
    ).toEqual([]);
    // The control: the AMBIENT `require` in a CommonJS artifact is still read.
    expect(read(`const react = require("react");`)).toEqual(["react"]);
  });

  it("does not treat a local helper of the same name as the loader", () => {
    // The name proves nothing; where it came from does. A module defining its own `createRequire`
    // has no dependency on Node's, and reading one in would reject an artifact that imports
    // nothing at all.
    expect(
      read(`
        const createRequire = (base) => (name) => base + name;
        export const x = createRequire("")("react-dom");
      `)
    ).toEqual([]);
  });

  it("does not treat an unrelated function as a loader", () => {
    // The control: only a name assigned FROM `createRequire` counts, or every one-argument call
    // with a string would be read as a module load.
    expect(
      read(`
        const load = (name) => name.toUpperCase();
        export const x = load("react");
      `)
    ).toEqual([]);
  });

  it("refuses a specifier it cannot read, rather than passing it", () => {
    // A bundler folds `"re" + "act"` to React. This does not evaluate expressions, so the honest
    // outcome is a name no allow-list can hold — which fails — not a silent skip.
    const found = read(`const lazy = import("re" + "act");`);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("unreadable specifier");
  });

  it("is not fooled by a specifier inside a comment or a template", () => {
    // Parsed rather than matched. A regular expression over the text reports both of these.
    expect(
      read(`
        /** Example: import Button from "react"; */
        export const doc = \`import "react-dom";\`;
      `)
    ).toEqual([]);
  });
});

describe("classifying a specifier", () => {
  it("keeps both segments of a scoped name", () => {
    // Splitting on the first segment would compare "@radix-ui" against the allow-list, so
    // permitting one package under a scope would permit the whole scope.
    expect(packageOf("@radix-ui/react-slot")).toBe("@radix-ui/react-slot");
    expect(packageOf("react-dom/client")).toBe("react-dom");
  });

  it("names no package for the things a server already has", () => {
    expect(packageOf("./chunk.mjs")).toBeNull();
    expect(packageOf("node:path")).toBeNull();
  });

  it("names an absolute specifier rather than exempting it", () => {
    // An absolute path is not part of the emitted output and is never traversed. It resolves on
    // the machine that built it and is absent for every consumer, so it has to fail the
    // allow-list rather than pass as package-free.
    expect(packageOf("/workspace/node_modules/react/index.js")).toBe(
      "/workspace/node_modules/react/index.js"
    );
  });

  it("recognises a built-in in either spelling", () => {
    // Both resolve to the same module and the build preserves whichever the source used, so
    // matching on the `node:` prefix alone would reject a server-safe entry for importing `path`.
    expect(packageOf("path")).toBeNull();
    expect(packageOf("fs/promises")).toBeNull();
    // The control: a real package that merely looks like one must still be named.
    expect(packageOf("react")).toBe("react");
    expect(packageOf("path-browserify")).toBe("path-browserify");
  });
});

describe("what the allow-list is allowed to name", () => {
  it("names only packages this one declares as its own dependencies", () => {
    // A manifest assertion is a boundary only if the RESOLVER agrees with it. Under pnpm a root
    // dependency, or one hoisted for another workspace package, stays importable here — so an
    // allow-list entry this package does not declare would pass the specifier scan, resolve in the
    // evaluation child, and then fail for a consumer who installed only what the manifest names.
    //
    // Read from the manifest rather than restated, so adding a dependency and adding it to the
    // allow-list stay two deliberate acts that cannot silently diverge.
    const manifest = JSON.parse(
      readFileSync(
        path.join(
          path.dirname(fileURLToPath(import.meta.url)),
          "..",
          "..",
          "package.json"
        ),
        "utf8"
      )
    ) as { dependencies?: Record<string, string> };
    const dependencies = manifest.dependencies ?? {};
    const declared = new Set(Object.keys(dependencies));
    const undeclared = [...SERVER_SAFE_ALLOWED_PACKAGES].filter(
      name => !declared.has(name)
    );
    expect(undeclared).toEqual([]);

    // A manifest KEY is a name this package chose; it is not the package that name resolves to.
    // `"clsx": "npm:react@19"` keeps the key, and the artifact and the metafile both keep naming
    // the external `clsx`, so every check downstream approves a dependency whose real target is
    // something else entirely. Refused rather than resolved: following the alias means asking the
    // registry what a range points at, and an allow-list that needs the network to be read is a
    // different kind of check. No allowed dependency uses one today, so this costs nothing.
    const aliased = [...SERVER_SAFE_ALLOWED_PACKAGES]
      .filter(name => (dependencies[name] ?? "").startsWith("npm:"))
      .map(name => `${name} -> ${dependencies[name]}`);

    expect(
      aliased,
      "An allowed package declared through an npm alias resolves to a different package while " +
        "keeping its key, so the artifact checks approve a name that is not what consumers get. " +
        "Declare it under its real name, or resolve the alias here before allowing it."
    ).toEqual([]);
  });

  it("has something to check, so the rule cannot pass vacuously", () => {
    // An empty allow-list satisfies the rule above by having nothing to test.
    expect(SERVER_SAFE_ALLOWED_PACKAGES.size).toBeGreaterThan(0);
  });
});

describe("comparing against the allow-list", () => {
  const allowed = new Set(["clsx"]);
  /** A reader over an in-memory output directory, standing in for `dist`. */
  const from =
    (files: Record<string, string>) =>
    (file: string): string | null =>
      files[file] ?? null;

  it("reports each disallowed package once, and permits the rest", () => {
    expect(
      disallowedSpecifiers(
        "artifact.mjs",
        from({
          "artifact.mjs": `
            import "clsx";
            import "react";
            import "react";
            import "node:path";
          `,
        }),
        allowed
      )
    ).toEqual({ offending: ["react"], missing: [] });
  });

  it("does not let a subpath of an allowed package smuggle another in", () => {
    expect(
      disallowedSpecifiers(
        "a.mjs",
        from({ "a.mjs": `import "clsx/lite";` }),
        allowed
      ).offending
    ).toEqual([]);
    expect(
      disallowedSpecifiers(
        "a.mjs",
        from({ "a.mjs": `import "clsxx";` }),
        allowed
      ).offending
    ).toEqual(["clsxx"]);
  });

  it("follows a split build's chunks, where the entry names nothing", () => {
    // With code splitting on — tsup's default for ESM — an entry can be a re-export and nothing
    // else, with the real dependency in the chunk beside it. Scanning only the named entry exempts
    // exactly the file holding what this looks for, and the evaluation misses it too, because
    // importing React under Node succeeds.
    expect(
      disallowedSpecifiers(
        "utils.mjs",
        from({
          "utils.mjs": `export { x } from "./chunk-abc.mjs";`,
          "chunk-abc.mjs": `import "react";\nexport const x = 1;`,
        }),
        allowed
      )
    ).toEqual({ offending: ["react"], missing: [] });
  });

  it("does not loop on chunks that import each other", () => {
    expect(
      disallowedSpecifiers(
        "a.mjs",
        from({
          "a.mjs": `export { b } from "./b.mjs";`,
          "b.mjs": `export { a } from "./a.mjs";\nimport "react";`,
        }),
        allowed
      )
    ).toEqual({ offending: ["react"], missing: [] });
  });

  it("visits each file once, and reports what it saw", () => {
    // The walk's own shape, so a change to it is visible here rather than only through its verdict.
    expect(
      reachedFrom(
        "a.mjs",
        file =>
          ({
            "a.mjs": `export { b } from "./b.mjs";\nimport "clsx";`,
            "b.mjs": `import "react";`,
          })[file] ?? null
      )
    ).toEqual([
      { file: "a.mjs", missing: false, specifiers: ["./b.mjs", "clsx"] },
      { file: "b.mjs", missing: false, specifiers: ["react"] },
    ]);
  });

  it("names a chunk the build did not emit rather than passing it", () => {
    // A specifier this cannot read is a hole in the walk, so it is reported. Silently treating it
    // as empty would exempt whatever it contained.
    expect(
      disallowedSpecifiers(
        "entry.mjs",
        from({ "entry.mjs": `export { x } from "./gone.mjs";` }),
        allowed
      )
    ).toEqual({ offending: [], missing: ["gone.mjs"] });
  });
});

describe("reading what the build bundled", () => {
  it("names the package an input belongs to", () => {
    expect(packageOfInput("src/lib/utils.ts")).toBeNull();
    expect(packageOfInput("../../node_modules/clsx/dist/clsx.mjs")).toBe(
      "clsx"
    );
    expect(packageOfInput("node_modules/@scope/thing/dist/index.js")).toBe(
      "@scope/thing"
    );
    // The LAST marker wins: a nested dependency lives under its parent's node_modules, and pnpm's
    // store layout puts the real name after the last one too.
    expect(
      packageOfInput(
        "node_modules/.pnpm/culori@4.0.2/node_modules/culori/src/index.js"
      )
    ).toBe("culori");
  });

  it("lists the packages inlined into one artifact", () => {
    // A bundled package leaves no import to find, so the build's own record is the only place it
    // is visible.
    const metafile = {
      outputs: {
        "dist/utils.mjs": {
          inputs: {
            "src/lib/utils.ts": {},
            "node_modules/.pnpm/culori@4.0.2/node_modules/culori/src/index.js":
              {},
          },
        },
      },
    };
    expect(bundledPackages(metafile, "dist/utils.mjs")).toEqual(["culori"]);
  });

  it("reads a resolver-only dependency from the build's import record", () => {
    // `require.resolve` reaches a package that appears in no input and in no surviving specifier,
    // so the consumer without that dependency gets MODULE_NOT_FOUND. The bundler records it under
    // `imports`, and the declaration has to admit that property or typed callers cannot pass a
    // real metafile at all.
    // Passed INLINE on purpose. Excess-property checking only fires on a fresh object literal at
    // the call site, so binding it to a variable first would typecheck against a declaration that
    // omits `imports` and prove nothing about the declaration.
    expect(
      bundledPackages(
        {
          outputs: {
            "dist/utils.mjs": {
              inputs: {},
              imports: [
                {
                  path: "node_modules/culori/index.js",
                  kind: "require-resolve",
                },
              ],
            },
          },
        },
        "dist/utils.mjs"
      )
    ).toEqual(["culori"]);
  });

  it("aggregates the inputs of every output reached from the entry", () => {
    // Splitting can leave the entry holding only its own source while a chunk beside it owns the
    // bundled dependency. Reading the entry alone leaves the chunk's inputs unread, even though
    // the specifier walk already follows the chunk.
    const metafile = {
      outputs: {
        "dist/utils.mjs": { inputs: { "src/lib/utils.ts": {} } },
        "dist/chunk-abc.mjs": {
          inputs: {
            "node_modules/.pnpm/culori@4.0.2/node_modules/culori/src/index.js":
              {},
          },
        },
      },
    };
    expect(
      bundledPackages(metafile, ["dist/utils.mjs", "dist/chunk-abc.mjs"])
    ).toEqual(["culori"]);
    // The negative control, and the reason the aggregation is necessary rather than tidy: read on
    // its own, the entry reports nothing, because its record holds only its own source.
    expect(bundledPackages(metafile, ["dist/utils.mjs"])).toEqual([]);
  });

  it("names a workspace package, which has no node_modules in its path", () => {
    // pnpm links a workspace dependency, so the bundler records its real location. Treating every
    // non-`node_modules` path as first-party made a whole sibling package invisible.
    // The DIRECTORY is not the package's identity: an allow-list entry has to be the name the
    // manifest declares, or it could never match — and would stop matching again the day the same
    // dependency is externalised and arrives under `node_modules/@nextlyhq/admin-css`.
    expect(packageOfInput("../admin-css/src/index.mjs")).toBe(
      "@nextlyhq/admin-css"
    );
    expect(packageOfInput("src/lib/utils.ts")).toBeNull();
  });

  it("refuses a PARTIALLY described set rather than answering from the rest", () => {
    // The entry is described and the chunk is not. Answering from the outputs that WERE found
    // reads as a complete result, and whatever the unmatched chunk inlined passes unseen.
    const metafile = {
      outputs: { "dist/utils.mjs": { inputs: { "src/lib/utils.ts": {} } } },
    };
    expect(
      bundledPackages(metafile, ["dist/utils.mjs", "dist/chunk-abc.mjs"])
    ).toBeNull();
  });

  it("does not read a shared chunk as a package named after the output directory", () => {
    // The record shape here was taken from a real split build, not written from memory: esbuild
    // emits `{ path: "dist/chunk-XXXXXX.js", kind: "import-statement" }` with NO `external` flag
    // once two entries share a module, and splitting is on by default. Classifying that by path
    // yields `dist`, which is on no allow-list, so a correct build would be rejected the day any
    // two server-safe entries first share code.
    const metafile = {
      outputs: {
        "dist/utils.mjs": {
          inputs: { "src/lib/utils.ts": {} },
          imports: [
            { path: "dist/chunk-C7SORCUA.mjs", kind: "import-statement" },
          ],
        },
        "dist/chunk-C7SORCUA.mjs": {
          inputs: { "src/lib/shared.ts": {} },
          imports: [{ path: "clsx", kind: "import-statement", external: true }],
        },
      },
    };
    expect(bundledPackages(metafile, ["dist/utils.mjs"])).toEqual([]);
    // The control: the chunk is not being ignored, only classified correctly. Asked about the
    // chunk itself, its real dependency is still reported.
    expect(bundledPackages(metafile, ["dist/chunk-C7SORCUA.mjs"])).toEqual([
      "clsx",
    ]);
  });

  it("reads what the bundler RESOLVED but did not inline", () => {
    // `require.resolve` reaches a package that appears in no input and in no surviving specifier.
    // The metafile records it under `imports`, so the information was present and unread.
    const metafile = {
      outputs: {
        "dist/utils.cjs": {
          inputs: { "src/lib/utils.ts": {} },
          imports: [
            { path: "@nextlyhq/admin-css", kind: "require-resolve" },
            { path: "./chunk-abc.cjs", kind: "require-call" },
          ],
        },
      },
    };
    expect(bundledPackages(metafile, ["dist/utils.cjs"])).toEqual([
      "@nextlyhq/admin-css",
    ]);
  });

  it("reports an artifact the metafile does not describe, rather than passing it", () => {
    // An absent entry means the question was not answered. Returning an empty list would read as
    // "nothing bundled", which is the failure this whole check exists to prevent.
    expect(bundledPackages({ outputs: {} }, "dist/utils.mjs")).toBeNull();
  });
});
