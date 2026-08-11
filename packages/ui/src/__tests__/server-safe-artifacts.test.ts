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
  packageOf,
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
});

describe("comparing against the allow-list", () => {
  const allowed = new Set(["clsx"]);

  it("reports each disallowed package once, and permits the rest", () => {
    expect(
      disallowedSpecifiers(
        `
          import "clsx";
          import "react";
          import "react";
          import "./local.mjs";
          import "node:path";
        `,
        "artifact.mjs",
        allowed
      )
    ).toEqual(["react"]);
  });

  it("does not let a subpath of an allowed package smuggle another in", () => {
    expect(
      disallowedSpecifiers(`import "clsx/lite";`, "artifact.mjs", allowed)
    ).toEqual([]);
    expect(
      disallowedSpecifiers(`import "clsxx";`, "artifact.mjs", allowed)
    ).toEqual(["clsxx"]);
  });
});

describe("the vacuity guard", () => {
  it("names the globals that mean this is not a bare server", () => {
    expect(domGlobalsPresent({ document: {}, window: {} })).toEqual([
      "window",
      "document",
    ]);
  });

  it("ignores navigator, which Node itself defines", () => {
    // Node has had a `navigator` global since v21. Probing for it would report a DOM on every
    // current runtime, and the gate would refuse to run rather than check anything.
    expect(domGlobalsPresent({ navigator: {} })).toEqual([]);
  });

  it("passes on a real server, so the gate is reachable here", () => {
    // The positive control for the two above: this suite runs in Node, and the gate's precondition
    // has to actually hold there or it would never assert anything in the build either.
    expect(domGlobalsPresent()).toEqual([]);
  });
});
