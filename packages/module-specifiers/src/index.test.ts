/**
 * One case per form the reader CLAIMS to see, plus the forms it must not
 * report.
 *
 * These live here rather than in each consuming guard on purpose. A reader that
 * quietly stops recognising a form returns a clean result to every consumer at
 * once, and each consumer's own suite reports the same green it always did. The
 * corpus that would catch it belongs beside the reader.
 *
 * This is a different control from "the input set is non-empty". A guard can
 * read every file it was given and still be unable to fail on any input — one
 * in this repository hunted a `node:` prefix its bundler never emits, read the
 * whole built graph, and passed a deliberately-dependent entry. An input check
 * passes that cleanly. Only a known offender it must REJECT catches it.
 */
import { describe, expect, it } from "vitest";

import {
  UNRESOLVABLE_SPECIFIER,
  importedSpecifiers,
  moduleSpecifierRefs,
} from "./index";

const read = (text: string, fileName = "module.ts"): string[] =>
  importedSpecifiers(text, fileName);

describe("the forms this reader claims to see", () => {
  it("sees static imports and re-exports", () => {
    expect(read('import x from "pkg";')).toContain("pkg");
    expect(read('export { x } from "pkg";')).toContain("pkg");
  });

  it("sees a bare side-effect import, which carries no bindings to notice", () => {
    expect(read('import "pkg";')).toContain("pkg");
  });

  it("sees type-only imports, which a rename could turn into a value import", () => {
    expect(read('import type { T } from "pkg";')).toContain("pkg");
  });

  it("sees dynamic imports, which carry a dependency no declaration records", () => {
    expect(read('await import("pkg");')).toContain("pkg");
  });

  it("sees a bare require, which reaches a module exactly as an import does", () => {
    expect(read('require("pkg");')).toContain("pkg");
  });

  it("does not see a require METHOD, which resolves nothing", () => {
    // `loader.require("x")` is a call on some object. Reporting it is a false
    // positive, and a guard that cries wolf about code the compiler never loads
    // stops being read — taking its true findings with it.
    expect(read('loader.require("pkg");')).toEqual([]);
  });

  it("sees the CommonJS-interop import-equals spelling", () => {
    expect(read('import x = require("pkg");')).toContain("pkg");
  });

  it("sees a typeof-import type query, which no call expression covers", () => {
    expect(read('type A = typeof import("pkg");')).toContain("pkg");
  });

  it("sees a JSDoc @import tag, which carries its own module specifier", () => {
    expect(read('/** @import { T } from "pkg" */', "module.js")).toContain(
      "pkg"
    );
  });

  it("sees an import type inside a JSDoc typedef, which JavaScript files use", () => {
    expect(read('/** @typedef {import("pkg").T} T */', "module.js")).toContain(
      "pkg"
    );
  });

  it("sees a triple-slash type reference, which is not in the node tree at all", () => {
    expect(read('/// <reference types="pkg" />')).toContain("pkg");
  });

  it("sees a specifier written as a substitution-free template literal", () => {
    // As statically known as a quoted string, and a reader that accepts only
    // `StringLiteral` walks past it.
    expect(read("await import(`pkg`);")).toContain("pkg");
  });
});

describe("the forms this reader must NOT report", () => {
  it("ignores a specifier that appears only in a comment", () => {
    expect(read('// never import from "pkg" here')).toEqual([]);
  });

  it("ignores a specifier that appears only inside a string", () => {
    expect(read(`const s = 'from "pkg"';`)).toEqual([]);
  });
});

describe("a target it cannot resolve is a finding, not an absence", () => {
  it("reports a computed dynamic import as unresolvable", () => {
    // The alternative is a guard that approves whatever it could not read.
    expect(read("await import(base + name);")).toEqual([
      UNRESOLVABLE_SPECIFIER,
    ]);
  });

  it("reports a computed require as unresolvable", () => {
    expect(read("require(name);")).toEqual([UNRESOLVABLE_SPECIFIER]);
  });

  it("uses a marker no allowlist entry can satisfy", () => {
    // It has to be un-spellable as a package: an allowlist that happened to
    // contain it would turn every unreadable call into a pass.
    expect(UNRESOLVABLE_SPECIFIER).toContain("<");
  });
});

describe("the parser follows the filename, not a default", () => {
  it("reads a load inside JSX when the file is .tsx", () => {
    // The load is INSIDE a JSX expression on purpose. Read as `.ts`, `<div>`
    // parses as a type assertion and the recovered tree contains no import
    // nodes at all, so the file reports as importing nothing — a clean green
    // over a file that was never really read.
    const jsx = 'export const C = () => <div>{require("pkg")}</div>;';
    expect(importedSpecifiers(jsx, "component.tsx")).toContain("pkg");
  });

  it("reads a plain .ts angle-bracket assertion, which .tsx cannot parse", () => {
    // The other direction, so the fix cannot be "always parse as TSX": this is
    // valid TypeScript and a syntax error in a `.tsx` file.
    const assertion = 'const el = <HTMLElement>document.body;\nimport "pkg";';
    expect(importedSpecifiers(assertion, "module.ts")).toContain("pkg");
  });
});

describe("the JSDoc descent terminates", () => {
  it("reads a typedef attached to a declaration without recursing forever", () => {
    // The two descents reach each other. A `@typedef` on a declaration is
    // reachable from that declaration, and `forEachChild` on the tag walks back
    // to it, so an unguarded walk overflows the stack rather than returning a
    // wrong answer.
    //
    // The ATTACHED form is what makes this fixture reach the mechanism: a
    // free-floating `/** @typedef ... */` with no declaration under it has
    // nothing to cycle through, terminates either way, and passes with the
    // guard removed. That was the first version of this test.
    expect(
      read(
        '/** @typedef {import("pkg").T} T */\nexport const x = 1;',
        "module.js"
      )
    ).toEqual(["pkg"]);
  });
});

/**
 * The kind half of the same walk.
 *
 * A guard about a BUNDLE needs only the references that survive to runtime, and one about an import
 * BOUNDARY needs all of them. Both come from this one walk, so they cannot drift apart -- and the
 * drift would be silent in the direction that answers "clean".
 */
describe("whether a reference survives to runtime", () => {
  const refs = (text: string, fileName = "module.ts") =>
    moduleSpecifierRefs(text, fileName);

  it("reports a plain import as reaching runtime", () => {
    expect(refs(`import a from "pkg";`)).toEqual([
      { specifier: "pkg", typeOnly: false },
    ]);
  });

  it("reports a bare side-effect import as reaching runtime", () => {
    expect(refs(`import "pkg";`)).toEqual([
      { specifier: "pkg", typeOnly: false },
    ]);
  });

  it("reports an import type as erased", () => {
    expect(refs(`import type { A } from "pkg";`)).toEqual([
      { specifier: "pkg", typeOnly: true },
    ]);
  });

  it("reports an export type as erased", () => {
    expect(refs(`export type { A } from "pkg";`)).toEqual([
      { specifier: "pkg", typeOnly: true },
    ]);
  });

  it("reports a mixed clause as reaching runtime", () => {
    // 🔴 The module is still loaded for the value binding. Reading the inline `type` keyword as
    // governing the whole clause erases a real runtime edge, which is the direction that answers
    // "clean" for a bundle guard.
    expect(refs(`import { a, type B } from "pkg";`)).toEqual([
      { specifier: "pkg", typeOnly: false },
    ]);
  });

  it("reports a dynamic import as reaching runtime", () => {
    expect(refs(`const f = () => import("pkg");`)).toEqual([
      { specifier: "pkg", typeOnly: false },
    ]);
  });

  it("reports require as reaching runtime", () => {
    expect(refs(`const a = require("pkg");`)).toEqual([
      { specifier: "pkg", typeOnly: false },
    ]);
  });

  it("reports an import-equals as reaching runtime", () => {
    expect(refs(`import a = require("pkg");`)).toEqual([
      { specifier: "pkg", typeOnly: false },
    ]);
  });

  it("reports typeof import as erased", () => {
    expect(refs(`type A = typeof import("pkg");`)).toEqual([
      { specifier: "pkg", typeOnly: true },
    ]);
  });

  it("reports a JSDoc import as erased", () => {
    expect(
      refs(
        `/** @typedef {import("pkg").T} T */\nexport const x = 1;`,
        "module.js"
      )
    ).toEqual([{ specifier: "pkg", typeOnly: true }]);
  });

  it("reports a triple-slash type reference as erased", () => {
    expect(refs(`/// <reference types="pkg" />\nexport const x = 1;`)).toEqual([
      { specifier: "pkg", typeOnly: true },
    ]);
  });

  it("keeps an unreadable target unreadable, and at runtime", () => {
    // An unresolvable target has to stay a violation for both consumers.
    expect(refs(`const a = require(name);`)).toEqual([
      { specifier: UNRESOLVABLE_SPECIFIER, typeOnly: false },
    ]);
  });

  it("is the source the string list is derived from", () => {
    // 🔴 The control for the rule this file exists under. If `importedSpecifiers` ever grows its
    // own walk again, this disagrees.
    const text = [
      `import a from "one";`,
      `import type { B } from "two";`,
      `const c = require("three");`,
      `type D = typeof import("four");`,
    ].join("\n");
    expect(importedSpecifiers(text, "module.ts")).toEqual(
      moduleSpecifierRefs(text, "module.ts").map(ref => ref.specifier)
    );
    expect(moduleSpecifierRefs(text, "module.ts").map(r => r.typeOnly)).toEqual(
      [false, true, false, true]
    );
  });
});
