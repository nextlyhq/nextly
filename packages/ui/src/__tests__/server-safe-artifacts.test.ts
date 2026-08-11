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
  disallowedSpecifiers,
  domGlobalsPresent,
  floorGlobalsPresent,
  packageOf,
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
    expect(packageOf("/abs/path.mjs")).toBeNull();
    expect(packageOf("node:path")).toBeNull();
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
    expect(floorGlobalsPresent({ navigator: {}, WebSocket: class {} })).toEqual(
      ["navigator", "WebSocket"]
    );
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
