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

  it("sees a JSDoc @import of a scoped package, whose name starts with the tag character", () => {
    // The tag ends at the next tag, which starts after whitespace; an `@`
    // inside the quoted specifier is part of the name.
    const read2 = read(
      '/**\n * @import { T } from "@scope/pkg"\n * @import { U } from "other"\n */',
      "module.js"
    );
    expect(read2).toContain("@scope/pkg");
    expect(read2).toContain("other");
  });

  it("reads an escaped JSDoc specifier as the string it spells", () => {
    // `p\u0067` is `pg` to the compiler; the raw text would name no package.
    expect(read('/** @import { T } from "p\\u0067" */', "module.js")).toEqual([
      "pg",
    ]);
    expect(
      read('/** @typedef {import("p\\u0067").T} T */', "module.js")
    ).toEqual(["pg"]);
  });

  it("reads past a quoted brace inside a JSDoc type, which is a character, not its end", () => {
    expect(
      read('/** @type {"}" | import("forbidden").T} */', "module.js")
    ).toContain("forbidden");
  });

  it("sees an import type inside a JSDoc typedef, which JavaScript files use", () => {
    expect(read('/** @typedef {import("pkg").T} T */', "module.js")).toContain(
      "pkg"
    );
  });

  it("sees a triple-slash type reference, which is not in the node tree at all", () => {
    expect(read('/// <reference types="pkg" />')).toContain("pkg");
  });

  it("sees a triple-slash type reference whose types attribute is not the first", () => {
    expect(
      read('/// <reference resolution-mode="import" types="pkg" />')
    ).toContain("pkg");
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

  it("ignores an import mentioned in JSDoc prose rather than in a tag's type", () => {
    // The description is text, not a type expression. The control beside it is
    // the same words inside `{...}`, which IS read, so this cannot pass by the
    // JSDoc scan reading nothing at all.
    expect(read('/** Loads import("pkg") lazily. */', "module.js")).toEqual([]);
    expect(read('/** @type {import("pkg")} */', "module.js")).toEqual(["pkg"]);
  });

  it("ignores a reference directive below the first statement", () => {
    // The compiler honours triple-slash directives only at the top of a file;
    // further down the same text is an ordinary comment.
    expect(read('export const x = 1;\n/// <reference types="pkg" />')).toEqual(
      []
    );
    expect(read('/// <reference types="pkg" />\nexport const x = 1;')).toEqual([
      "pkg",
    ]);
  });
});

describe("a file the parser cannot read", () => {
  it("throws rather than reporting that it imports nothing", () => {
    // A failed parse yields an empty program. Returning its (empty) imports
    // would be a clean green over a file that was never read. `<div>` in a
    // `.ts` file is the classic way to get there: it is not a type assertion
    // the parser can finish.
    expect(() =>
      importedSpecifiers('import "pkg";\nconst el = <div>x</div>;', "module.ts")
    ).toThrow(/module\.ts cannot be parsed/);
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

describe("a JSDoc block attached to a declaration", () => {
  it("is read once, not once per node it documents", () => {
    // JSDoc is read from the comment list, which holds each block once,
    // whether or not a declaration follows it. A reader that also walked the
    // block from the declaration it documents would report the specifier twice,
    // so the exact list is the assertion, and the ATTACHED form is the fixture.
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

  it("reports a type-only import-equals as erased", () => {
    expect(refs(`import type a = require("pkg");`)).toEqual([
      { specifier: "pkg", typeOnly: true },
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

/**
 * `module.require` is the documented CommonJS method and resolves exactly as the
 * free function does, so a reader that sees only the bare identifier reports a
 * file loading nothing while it loads a driver.
 */
describe("module.require", () => {
  it("reads it as a runtime resolve", () => {
    expect(
      importedSpecifiers(`const a = module.require("pkg");`, "m.ts")
    ).toEqual(["pkg"]);
    expect(
      moduleSpecifierRefs(`const a = module.require("pkg");`, "m.ts")
    ).toEqual([{ specifier: "pkg", typeOnly: false }]);
  });

  it("reads the bracket spelling the same way", () => {
    // `a.b` and `a["b"]` are the same read, and a rule for one is a rule the
    // other walks around.
    expect(
      importedSpecifiers(`const a = module["require"]("pkg");`, "m.ts")
    ).toEqual(["pkg"]);
  });

  it("keeps an unreadable target unreadable", () => {
    expect(
      importedSpecifiers(`const a = module.require(name);`, "m.ts")
    ).toEqual([UNRESOLVABLE_SPECIFIER]);
  });

  it("leaves a require method on some other object alone", () => {
    // 🔴 The negative control. Treating every `.require` as a resolve reports
    // ordinary code as a dependency nobody has, and a rule that fires on correct
    // code stops being read.
    expect(
      importedSpecifiers(`const a = loader.require("pkg");`, "m.ts")
    ).toEqual([]);
    expect(
      importedSpecifiers(`const a = holder["require"]("pkg");`, "m.ts")
    ).toEqual([]);
  });
});

/**
 * The receiver, seen through what the language lets you write around it.
 */
describe("module.require through wrappers and shadows", () => {
  it.each([
    `const a = (module).require("pkg");`,
    `const a = (module as NodeModule).require("pkg");`,
    `const a = module!.require("pkg");`,
    `const a = (module satisfies object).require("pkg");`,
    `const a = ((module)).require("pkg");`,
  ])("still reads it in %s", source => {
    // 🔴 Each of these reads the same binding. A check on the receiver as
    // written treats them as somebody else's property and reports the file as
    // loading nothing, which is a bypass anyone can reach by accident.
    expect(importedSpecifiers(source, "m.ts")).toEqual(["pkg"]);
  });

  it.each([
    `function f(module: { require(id: string): unknown }) { return module.require("pkg"); }`,
    `const module = { require: (id: string) => id };\nconst a = module.require("pkg");`,
  ])(
    "claims no dependency when the file declares its own module: %s",
    source => {
      // 🔴 The false direction for a guard. Renaming the identical receiver to
      // `loader` already makes the report disappear, which is the tell that it was
      // about the name rather than the thing.
      expect(importedSpecifiers(source, "m.ts")).toEqual([]);
    }
  );

  it("reports only the real import when module is a default binding", () => {
    // The import itself is a specifier and stays one; what goes is the invented
    // dependency on "pkg" that the file never loads.
    const source = `import module from "elsewhere";\nconst a = module.require("pkg");`;
    expect(importedSpecifiers(source, "m.ts")).toEqual(["elsewhere"]);
  });

  it("still sees a bare require in a file that shadows module", () => {
    // The shadow is about the receiver, not about the file.
    const source = `function f(module: unknown) { return module; }\nconst a = require("pkg");`;
    expect(importedSpecifiers(source, "m.ts")).toEqual(["pkg"]);
  });
});
