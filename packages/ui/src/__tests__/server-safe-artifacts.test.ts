/**
 * The reading the artifact gate does, checked against sources it will never see in a build.
 *
 * The gate itself runs in `build:js` and is the real assertion: it imports every built server-safe
 * artifact under Node and compares what each one reaches against the allow-list. What it cannot do
 * is prove it would still catch a crossing that is not currently present — the artifacts are clean,
 * so every run of it passes for the same reason whether the reading is right or wrong.
 *
 * These cover that: the specifier reader and the package classifier are exercised against the
 * spellings a bundler emits, including the ones that would let a real dependency through unseen.
 */
import { describe, expect, it } from "vitest";

import {
  childOutcome,
  disallowedSpecifiers,
  domGlobalsPresent,
  floorGlobalsPresent,
  bundledPackages,
  packageOf,
  packageOfInput,
  reachedFrom,
  restrictToSupportedFloor,
  specifiersIn,
} from "../../scripts/check-server-safe-artifacts.mjs";

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

  it("sees a module loaded through createRequire", () => {
    // The loader is the RESULT of a call, so the callee is not the `require` identifier and the
    // direct check never sees it. This package uses `createRequire` itself, precisely because a
    // bundler leaves it opaque — which is what makes it a way around the allow-list.
    expect(
      read(`
        import { createRequire } from "node:module";
        export const react = createRequire(import.meta.url)("react");
      `)
    ).toEqual(["node:module", "react"]);
    // The namespaced spelling too, when the namespace is the one Node's built-in was imported
    // under — and only then.
    expect(
      read(`
        import * as mod from "node:module";
        export const r = mod.createRequire(import.meta.url)("react-dom");
      `)
    ).toEqual(["node:module", "react-dom"]);
    expect(
      read(`export const r = other.createRequire(u)("react-dom");`)
    ).toEqual([]);
  });

  it("sees a loader stored under a name before it is used", () => {
    // The call's callee is an ordinary identifier, so nothing about the call site says it loads a
    // module. What it was assigned makes it one.
    expect(
      read(`
        import { createRequire } from "node:module";
        const load = createRequire(import.meta.url);
        export const react = load("react");
      `)
    ).toEqual(["node:module", "react"]);
  });

  it("finds a stored loader declared below its use", () => {
    // Emitted output is not written in source order, so the declaration can follow the call.
    expect(
      read(`
        import { createRequire } from "node:module";
        export const react = load("react");
        const load = createRequire(import.meta.url);
      `)
    ).toEqual(["node:module", "react"]);
  });

  it("follows a loader handed on under another name", () => {
    // `const again = load` passes the loader along, and a chain of any length resolves.
    expect(
      read(`
        import { createRequire } from "node:module";
        const load = createRequire(import.meta.url);
        const again = load;
        const third = again;
        export const react = third("react");
      `)
    ).toEqual(["node:module", "react"]);
  });

  it("sees a load through the CommonJS module object", () => {
    // `module.require` survives a format guard into the CJS artifact and is opaque to the bundler,
    // so it appears in neither the specifier list nor the metafile inputs.
    expect(
      read(
        `export const react = typeof module === "undefined" ? null : module.require("react");`
      )
    ).toEqual(["react"]);
    // The computed spelling is the same call, so one rule covers both.
    expect(read(`export const react = module["require"]("react");`)).toEqual([
      "react",
    ]);
    // The control, in both spellings: a module binding its own `module` is not reaching the
    // ambient loader.
    expect(
      read(`
        const module = { require: (n) => n };
        export const x = module.require("react");
        export const y = module["require"]("react-dom");
      `)
    ).toEqual([]);
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

  it("resolves an aliased createRequire import", () => {
    // The build preserves the alias, so requiring the local name to be spelled `createRequire`
    // misses it entirely.
    expect(
      read(`
        import { createRequire as cr } from "node:module";
        const load = cr(import.meta.url);
        export const react = load("react");
      `)
    ).toEqual(["node:module", "react"]);
  });

  it("sees a package named through import.meta.resolve", () => {
    // `import.meta.resolve` is syntax rather than an import, so it names a package while the
    // artifact's import list stays empty and the bundler records no dependency. Both spellings of
    // the member read the same resolver.
    expect(
      read(`export const css = import.meta.resolve("@nextlyhq/admin-css");`)
    ).toEqual(["@nextlyhq/admin-css"]);
    expect(
      read(`export const css = import.meta["resolve"]("@nextlyhq/admin-css");`)
    ).toEqual(["@nextlyhq/admin-css"]);
  });

  it("sees a resolver guarded by a typeof check", () => {
    // A format guard leaves the call in the ESM artifact and takes the fallback in the CJS one, so
    // the specifier is reached on exactly one of the two outputs.
    expect(
      read(`
        export const css =
          typeof import.meta.resolve === "function"
            ? import.meta.resolve("@nextlyhq/admin-css")
            : null;
      `)
    ).toEqual(["@nextlyhq/admin-css"]);
  });

  it("resolves import.meta.resolve stored under a local name", () => {
    // The resolver is a value, so it can be held before it is called. Requiring the call to be
    // spelled `import.meta.resolve` at the call site misses that entirely.
    expect(
      read(`
        const resolve = import.meta.resolve;
        export const css = resolve("@nextlyhq/admin-css");
      `)
    ).toEqual(["@nextlyhq/admin-css"]);
  });

  it("leaves a local resolve of the artifact's own alone", () => {
    // The control: `resolve` is an ordinary name, and only one taken FROM `import.meta` reads the
    // module resolver. A rule keyed on the name rejects promise code that resolves no module.
    expect(
      read(`
        const resolve = (name) => name.trim();
        export const x = resolve("react");
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

describe("the vacuity guard", () => {
  it("names the globals that mean this is not a bare server", () => {
    expect(domGlobalsPresent({ document: {}, window: {} })).toEqual([
      "window",
      "document",
    ]);
  });

  it("probes only globals no Node release has ever defined", () => {
    // Node has had `navigator` since v21 and is adopting web storage now. Probing for either would
    // report a DOM on an ordinary build machine, and the gate would refuse to run rather than
    // check anything — turning a real assertion into a hard failure.
    expect(
      domGlobalsPresent({ navigator: {}, localStorage: {}, sessionStorage: {} })
    ).toEqual([]);
  });

  it("reads the binding, not its value", () => {
    // A preload that defines `globalThis.document` as `undefined` leaves `document?.title`
    // evaluating happily while ordinary Node throws `ReferenceError`. Comparing the VALUE against
    // undefined reports that environment as a bare server.
    expect(domGlobalsPresent({ document: undefined })).toEqual(["document"]);
  });

  it("passes on a real server, so the gate is reachable here", () => {
    // The positive control for the two above: this suite runs in Node, and the gate's precondition
    // has to actually hold there or it would never assert anything in the build either.
    expect(domGlobalsPresent()).toEqual([]);
  });
});

describe("restricting to the oldest supported Node", () => {
  it("removes a global that a newer Node added, and puts it back", () => {
    // Without this the artifact is evaluated against the build machine's capabilities rather than
    // the floor of the `engines` range, and a module-scope `navigator.userAgent` passes here while
    // throwing for a consumer on Node 20.
    const scope: Record<string, unknown> = { navigator: { userAgent: "x" } };
    const floor = restrictToSupportedFloor(scope);
    expect(floor.stubborn).toEqual([]);
    expect("navigator" in scope).toBe(false);
    floor.restore();
    expect(scope.navigator).toEqual({ userAgent: "x" });
  });

  it("reports a global it could not remove rather than proceeding", () => {
    // A leftover would let an artifact evaluate against a capability the floor does not have —
    // the same vacuous pass this file exists to prevent, one level down.
    const scope: Record<string, unknown> = {};
    Object.defineProperty(scope, "navigator", {
      value: {},
      configurable: false,
    });
    expect(restrictToSupportedFloor(scope).stubborn).toEqual(["navigator"]);
  });

  it("removes the constructor as well as the instance", () => {
    // Node exposes `navigator` AND `Navigator`; removing one leaves the other reachable, so a
    // module-scope `Navigator.prototype` would still evaluate here and throw on the floor.
    const scope: Record<string, unknown> = {
      navigator: {},
      Navigator: () => {},
    };
    restrictToSupportedFloor(scope);
    expect("navigator" in scope).toBe(false);
    expect("Navigator" in scope).toBe(false);
  });

  it("names a post-floor global that reappeared", () => {
    // Asked BETWEEN imports. An artifact that installs `navigator` puts it back for everything
    // evaluated afterwards, and those entries then pass against a runtime no consumer has.
    //
    // The fixture is one name per Node version that added one above the `engines` floor of 20.19:
    // `navigator` in 21, `WebSocket` unflagged in 22.4, and `Iterator`, `Float16Array` and
    // `SuppressedError` in 24. Each is present on the build machine and absent on the oldest
    // runtime a consumer may use, which is the whole reason the scope is restricted before an
    // artifact is imported.
    expect(
      floorGlobalsPresent({
        navigator: {},
        WebSocket: class {},
        Iterator: class {},
        Float16Array: class {},
        SuppressedError: class {},
      })
    ).toEqual([
      "navigator",
      "WebSocket",
      "Iterator",
      "Float16Array",
      "SuppressedError",
    ]);
    expect(floorGlobalsPresent({ clean: 1 })).toEqual([]);
  });

  it("leaves a scope that never had them untouched", () => {
    const scope: Record<string, unknown> = { untouched: 1 };
    const floor = restrictToSupportedFloor(scope);
    expect(floor.stubborn).toEqual([]);
    floor.restore();
    expect(scope).toEqual({ untouched: 1 });
  });
});

describe("reading one artifact's own process", () => {
  const ran = (over: Record<string, unknown>) =>
    childOutcome("utils.mjs", { status: 0, stderr: "", ...over });

  it("passes a child that exited cleanly", () => {
    expect(ran({})).toBeNull();
  });

  it("reports the child's reason without repeating the artifact name", () => {
    // The child names the failure and the parent names the file. Written at both ends, the report
    // reads the name twice and the reason once.
    expect(
      ran({ status: 1, stderr: "installed document while being imported\n" })
    ).toBe("utils.mjs installed document while being imported");
  });

  it("still reports a child that failed and said nothing", () => {
    // A file name with no reason is what this avoids: the exit status is all there is to give.
    expect(ran({ status: 3, stderr: "  \n" })).toContain("exited 3");
  });

  it("separates a signalled child from a verdict about the artifact", () => {
    // `status` is null for a signalled child, which is unequal to 0 and would otherwise be
    // described with the word "null" where the reason belongs.
    const said = ran({ status: null, signal: "SIGKILL", stderr: "" });
    expect(said).toContain("SIGKILL");
    expect(said).not.toContain("null");
  });

  it("calls a child killed at the deadline a defect, not an unrunnable check", () => {
    // An artifact that leaves a handle open finishes importing and never lets its process exit.
    // Read as a spawn failure it would be reported as "could not be evaluated", which hides it.
    const timedOut = Object.assign(new Error("ETIMEDOUT"), {
      code: "ETIMEDOUT",
    });
    const said = ran({ error: timedOut, status: null });
    expect(said).toContain("still running");
    expect(said).not.toContain("could not be evaluated");
  });

  it("separates a child that never started from one that failed", () => {
    // "The artifact is bad" and "the check could not run" call for different action, and a spawn
    // that never happened is the second.
    expect(ran({ error: new Error("EAGAIN"), status: null })).toContain(
      "could not be evaluated"
    );
  });
});
