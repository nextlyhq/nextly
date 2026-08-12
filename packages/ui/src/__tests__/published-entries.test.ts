/**
 * The export map is the enrolment list for three guards, so what it REFUSES is load-bearing.
 *
 * These run against fixtures rather than this package's own `package.json`. Every refusal below
 * describes a map the package does not have yet — a client subpath beside the root, a bare
 * JavaScript target, two subpaths sharing one artifact — and a check exercised only against the
 * real map would be asserting that today's map is acceptable, which is a different claim.
 */
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path, { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import ts from "typescript";

import {
  clientBuildEntries,
  derivePublishedEntries,
  serverSafeBuildEntries,
  type DeclaredBarrel,
} from "../../scripts/published-entries.mjs";

/** The four conditions a JavaScript entry point has to name. */
function conditions(name: string): Record<string, Record<string, string>> {
  return {
    import: { types: `./dist/${name}.d.ts`, default: `./dist/${name}.mjs` },
    require: { types: `./dist/${name}.d.cts`, default: `./dist/${name}.cjs` },
  };
}

const barrel = (source: string, client: boolean): DeclaredBarrel => ({
  source,
  client,
});

describe("which side of the React boundary an entry point sits on", () => {
  it("reads the declaration rather than assuming anything but the root is server-safe", () => {
    // Derived from `subpath !== "."`, a client subpath added later was built by the server-safe
    // config — which adds no `"use client"` banner — while the directive guard demanded that same
    // artifact stay unmarked. Three guards pass over an entry point React cannot use.
    const entries = derivePublishedEntries(
      {
        ".": conditions("index"),
        "./charts": conditions("charts"),
        "./utils": conditions("utils"),
      },
      {
        ".": barrel("src/index.ts", true),
        "./charts": barrel("src/charts/index.ts", true),
        "./utils": barrel("src/lib/utils.ts", false),
      }
    );

    const serverSafe = entries
      .filter(entry => entry.serverSafe)
      .map(entry => entry.subpath);

    // The control is `./utils` in the same map: a declared server-safe subpath is still one, so
    // this is not passing by calling everything client code.
    expect(serverSafe).toEqual(["./utils"]);
  });
});

describe("which tsup config builds what", () => {
  it("builds every client entry, not only the first", () => {
    // Selecting one client entry left a second emitted by NEITHER config — the server-safe build
    // excludes all client entries — while the directive guard still required its banner, so the
    // build failed on a file nothing had been asked to produce.
    const entries = derivePublishedEntries(
      {
        ".": conditions("index"),
        "./charts": conditions("charts"),
        "./utils": conditions("utils"),
      },
      {
        ".": barrel("src/index.ts", true),
        "./charts": barrel("src/charts/index.ts", true),
        "./utils": barrel("src/lib/utils.ts", false),
      }
    );

    expect(clientBuildEntries(entries)).toEqual({
      index: "src/index.ts",
      charts: "src/charts/index.ts",
    });
    // The control: the two builds partition the entries, so nothing is emitted twice either.
    expect(serverSafeBuildEntries(entries)).toEqual({
      utils: "src/lib/utils.ts",
    });
  });

  it("refuses an export map with no client entry at all", () => {
    const entries = derivePublishedEntries(
      { "./utils": conditions("utils") },
      { "./utils": barrel("src/lib/utils.ts", false) }
    );
    expect(() => clientBuildEntries(entries)).toThrow(
      /No client entry point was found/
    );
  });
});

describe("two subpaths that resolve to one artifact", () => {
  it("refuses them when they are built from different barrels", () => {
    // The build entries are keyed by artifact name, so the second overwrites the first and both
    // subpaths ship the later barrel's API — while the surface suite snapshots the two declared
    // sources separately and the file guards inspect the one shared output twice.
    expect(() =>
      derivePublishedEntries(
        { "./a": conditions("shared"), "./b": conditions("shared") },
        {
          "./a": barrel("src/a.ts", false),
          "./b": barrel("src/b.ts", false),
        }
      )
    ).toThrow(/both resolve to the artifact "shared"/);
  });

  it("allows them when they are aliases of one barrel", () => {
    // The control: sharing an artifact is only a problem when the sources disagree. Refusing it
    // outright would ban a deliberate alias.
    expect(() =>
      derivePublishedEntries(
        { "./a": conditions("shared"), "./b": conditions("shared") },
        {
          "./a": barrel("src/shared.ts", false),
          "./b": barrel("src/shared.ts", false),
        }
      )
    ).not.toThrow();
  });
});

describe("targets the guards cannot read", () => {
  it("refuses a JavaScript subpath published as a bare string", () => {
    expect(() =>
      derivePublishedEntries(
        { ".": conditions("index"), "./motion": "./dist/motion.mjs" },
        { ".": barrel("src/index.ts", true) }
      )
    ).toThrow(/maps directly to "\.\/dist\/motion\.mjs"/);
  });

  it("refuses one with no extension at all", () => {
    // The reason the test is an allow-list of asset extensions and not a list of JavaScript ones:
    // a deny-list passes this, and it is still JavaScript no condition names.
    expect(() =>
      derivePublishedEntries(
        { ".": conditions("index"), "./motion": "./dist/motion" },
        { ".": barrel("src/index.ts", true) }
      )
    ).toThrow(/maps directly to "\.\/dist\/motion"/);
  });

  it("still passes over a stylesheet", () => {
    // The control: stylesheets are published as bare strings too, and none of the guards has
    // anything to say about one.
    const entries = derivePublishedEntries(
      { ".": conditions("index"), "./theme.css": "./dist/theme.css" },
      { ".": barrel("src/index.ts", true) }
    );
    expect(entries.map(entry => entry.subpath)).toEqual(["."]);
  });

  it("refuses an entry missing one of its four conditions", () => {
    const partial = conditions("index");
    delete partial.require;
    expect(() =>
      derivePublishedEntries(
        { ".": partial },
        { ".": barrel("src/index.ts", true) }
      )
    ).toThrow(/has no requireTypes target/);
  });
});

describe("export conditions the guards do not follow", () => {
  it("refuses a runtime condition it cannot traverse", () => {
    // A resolver picks the FIRST condition it matches, so `react-server` would be selected ahead
    // of `import`/`require` in that environment — and the file those consumers receive would have
    // had neither its surface nor its client directive checked.
    const target = {
      "react-server": { types: "./dist/rsc.d.ts", default: "./dist/rsc.mjs" },
      ...conditions("index"),
    };
    expect(() =>
      derivePublishedEntries(
        { ".": target },
        { ".": barrel("src/index.ts", true) }
      )
    ).toThrow(/has a "react-server" condition/);
  });

  it("refuses an unfollowed target inside a condition it does follow", () => {
    const target = conditions("index");
    target.import = { ...target.import, browser: "./dist/index.browser.mjs" };
    expect(() =>
      derivePublishedEntries(
        { ".": target },
        { ".": barrel("src/index.ts", true) }
      )
    ).toThrow(/has a "import.browser" target/);
  });

  it("still accepts the four it does follow", () => {
    // The control: the refusal is scoped to keys the guards cannot read, not to conditions in
    // general — the ordinary dual-format entry must keep working.
    expect(
      derivePublishedEntries(
        { ".": conditions("index") },
        { ".": barrel("src/index.ts", true) }
      )
    ).toHaveLength(1);
  });
});

describe("a condition pointing at the wrong module format", () => {
  it("refuses require resolving to ESM", () => {
    // This builds cleanly, passes the client-directive check and draws only a publint warning,
    // while `require()` of the package throws ERR_REQUIRE_ESM at the first consumer — CI ignores
    // attw's `cjs-resolves-to-esm` rule, so the extension check here is what stops it shipping.
    const target = conditions("index");
    target.require = { ...target.require, default: "./dist/index.mjs" };
    expect(() =>
      derivePublishedEntries(
        { ".": target },
        { ".": barrel("src/index.ts", true) }
      )
    ).toThrow(/points requireDefault at ".\/dist\/index.mjs"/);
  });

  it("refuses a declaration whose extension does not match its condition", () => {
    const target = conditions("index");
    target.require = { ...target.require, types: "./dist/index.d.ts" };
    expect(() =>
      derivePublishedEntries(
        { ".": target },
        { ".": barrel("src/index.ts", true) }
      )
    ).toThrow(/points requireTypes at/);
  });
});

describe("targets that belong to more than one build entry", () => {
  it("refuses a subpath whose require targets borrow another entry's name", () => {
    // Ownership used to be checked through the name derived from `import.default` alone, so this
    // map passed: `./a` and `./b` had distinct import names, but `./a`'s require targets carried
    // `./b`'s. The builds then emitted `shared.cjs` from `./b`, and `require("./a")` received
    // `./b`'s API while `import "./a"` received its own.
    const a = conditions("a");
    a.require = { types: "./dist/shared.d.cts", default: "./dist/shared.cjs" };
    expect(() =>
      derivePublishedEntries(
        { "./a": a, "./b": conditions("shared") },
        {
          "./a": barrel("src/a.ts", false),
          "./b": barrel("src/shared.ts", false),
        }
      )
    ).toThrow(/resolves to more than one build entry \(a, shared\)/);
  });
});

describe("the barrel declaration and the export map", () => {
  it("refuses a published subpath with no declared barrel", () => {
    expect(() =>
      derivePublishedEntries({ ".": conditions("index") }, {})
    ).toThrow(/has no source barrel/);
  });

  it("refuses a declared barrel the export map does not publish", () => {
    // Consumers derive their lists from the published entries, so a stale key is dropped before
    // any guard sees it: the retarget it describes would go unchecked.
    expect(() =>
      derivePublishedEntries(
        { ".": conditions("index") },
        {
          ".": barrel("src/index.ts", true),
          "./motion": barrel("src/lib/motion.ts", false),
        }
      )
    ).toThrow(/SOURCES names \.\/motion/);
  });

  it("refuses an export map with no JavaScript entry points at all", () => {
    expect(() =>
      derivePublishedEntries({ "./theme.css": "./dist/theme.css" }, {})
    ).toThrow(/passing vacuously/);
  });
});

/**
 * Every name a module source publishes.
 *
 * Pure so the reading itself can be checked. Comparing two files it reads the same wrong way
 * returns equal lists and reports parity, so a form neither matcher recognises is invisible in
 * exactly the comparison meant to catch it.
 */
/**
 * Every name a declaration's binding form introduces.
 *
 * `const { a, b: c } = v` binds `a` and `c`; `const [x, , y] = v` binds `x` and `y`; a rest element
 * binds its own name. Written as a walk rather than a case per shape, because the forms nest.
 */
function boundNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  const found: string[] = [];
  for (const element of name.elements) {
    // An array pattern can hold a hole, which binds nothing.
    if (ts.isOmittedExpression(element)) continue;
    found.push(...boundNames(element.name));
  }
  return found;
}

function exportedNames(source: string): string[] {
  // PARSED, not matched. Export syntax has a long tail -- a default export, a re-export list, a
  // namespace re-export, a declaration inside a block comment whose inner line begins at column
  // zero -- and a pattern blind to any one of them is blind to it in BOTH files at once, so both
  // arrays lose the same entry and compare EQUAL. A parity check cannot detect a form it does not
  // understand, by construction, which is why the grammar is not restated here.
  //
  // The compiler already answers this exactly, and comments cease to be a category to handle.
  const tree = ts.createSourceFile(
    "module.mjs",
    source,
    ts.ScriptTarget.Latest,
    true
  );
  const found: string[] = [];

  // One reader, so the `canHaveModifiers` guard is applied once rather than at each call site.
  // `getModifiers` requires a node that can carry them, and a second caller reaching for them
  // directly is how the guard gets skipped.
  const modifiersOf = (node: ts.Node): readonly ts.Modifier[] =>
    ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []) : [];

  const hasModifier = (node: ts.Node, kind: ts.SyntaxKind): boolean =>
    modifiersOf(node).some(modifier => modifier.kind === kind);

  // Names this file declares in TYPE space, and names it declares in VALUE space.
  //
  // `interface Foo {}` followed by `export { Foo }` marks nothing type-only — not the declaration,
  // not the element — yet publishes no runtime binding, so a module with `export const Foo = 1`
  // compares equal to a declaration that never offered a value. Two sets rather than one because
  // declaration merging is real: `interface Foo {}` beside `const Foo = 1` publishes both, and the
  // value is what a consumer importing the name receives.
  const typeSpace = new Set<string>();
  const valueSpace = new Set<string>();
  for (const statement of tree.statements) {
    if (
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement)
    ) {
      typeSpace.add(statement.name.text);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        for (const name of boundNames(declaration.name)) valueSpace.add(name);
      }
    } else if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement) ||
        ts.isModuleDeclaration(statement) ||
        ts.isImportEqualsDeclaration(statement)) &&
      statement.name !== undefined &&
      ts.isIdentifier(statement.name)
    ) {
      valueSpace.add(statement.name.text);
    } else if (ts.isImportDeclaration(statement)) {
      // An IMPORT binds a name too, and which space it lands in is written on the syntax:
      // `import type { Foo }` marks the whole clause, `import { type Foo }` marks the element.
      // Reading only the local declarations left an imported type looking like a value, so a
      // declaration re-exporting one compared equal to a module publishing a real binding.
      const clause = statement.importClause;
      if (clause === undefined) continue;
      const space = clause.isTypeOnly ? typeSpace : valueSpace;
      if (clause.name !== undefined) space.add(clause.name.text);
      const bindings = clause.namedBindings;
      if (bindings === undefined) continue;
      if (ts.isNamespaceImport(bindings)) {
        space.add(bindings.name.text);
        continue;
      }
      for (const element of bindings.elements) {
        (clause.isTypeOnly || element.isTypeOnly ? typeSpace : valueSpace).add(
          element.name.text
        );
      }
    }
  }

  /** Whether a name exported from a LOCAL binding exists only in type space. */
  const isTypeOnlyLocal = (local: string): boolean =>
    typeSpace.has(local) && !valueSpace.has(local);

  for (const statement of tree.statements) {
    if (ts.isExportAssignment(statement)) {
      // `export default value`. `export =` is the CommonJS form and publishes no named binding.
      if (statement.isExportEquals !== true) found.push("default");
      continue;
    }

    if (ts.isExportDeclaration(statement)) {
      // `export type { X } from "./x"` marks the whole DECLARATION type-only, where
      // `export { type X }` marks the element. Both publish no value, and checking only the
      // element form let the declaration form through.
      if (statement.isTypeOnly) continue;
      const clause = statement.exportClause;
      if (clause === undefined) {
        // `export * from "./x"` is REFUSED rather than modelled. Following it correctly means
        // implementing the module system's own resolution: `default` is not forwarded, a name
        // reached through two sources is ambiguous and published by neither UNLESS both resolve to
        // the same underlying binding, a declaration file's target maps to `.d.mts`/`.d.cts`/`.d.ts`
        // by the runtime extension it names, and cycles have to terminate. Each of those is a real
        // rule, and a reader that gets any one wrong reports a surface neither file has.
        //
        // Neither file this compares uses one, so modelling it would be an unbounded exercise in
        // service of a construct that is not there. Refusing is bounded, fails closed, and says so:
        // adding a star export makes this fail with an explicit message rather than quietly
        // producing a surface that is subtly wrong.
        const specifier = statement.moduleSpecifier;
        const where =
          specifier !== undefined && ts.isStringLiteral(specifier)
            ? specifier.text
            : "?";
        found.push(`<unsupported: export * from ${where}>`);
      } else if (ts.isNamespaceExport(clause)) {
        // `export * as colors from "./x"` publishes exactly one binding, named `colors`.
        found.push(clause.name.text);
      } else {
        // A list, with or without a `from`. A re-export publishes a binding as a local one does,
        // and `export { x as default }` is the other spelling of a default export.
        for (const element of clause.elements) {
          if (element.isTypeOnly) continue;
          const local = (element.propertyName ?? element.name).text;
          // A list WITH a `from` names a binding in ANOTHER module, and which space it occupies is
          // decided there. `export { Foo } from "./helper.mjs"` publishes a value or publishes
          // nothing depending on whether `helper` declares `const Foo` or `interface Foo`, and
          // recording the name either way makes a declaration re-exporting a type compare equal to
          // a module publishing a real one.
          //
          // REFUSED rather than resolved, for the same reason `export *` is: following it means
          // reading the target, mapping a declaration file to its runtime twin by extension, and
          // terminating cycles. Neither file this compares uses the form, so refusing costs
          // nothing and says so when that changes.
          if (statement.moduleSpecifier !== undefined) {
            const from = ts.isStringLiteral(statement.moduleSpecifier)
              ? statement.moduleSpecifier.text
              : "?";
            found.push(`<unsupported: re-export of ${local} from ${from}>`);
            continue;
          }
          if (isTypeOnlyLocal(local)) continue;
          found.push(element.name.text);
        }
      }
      continue;
    }

    if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) continue;

    if (ts.isVariableStatement(statement)) {
      // Every declarator, so `export const a = 1, b = 2` publishes both.
      for (const declaration of statement.declarationList.declarations) {
        // A destructuring export publishes every name it BINDS: `export const { a, b: c } = value`
        // publishes `a` and `c`. Reading only the identifier form recorded nothing for those, so a
        // declaration omitting them compared equal to a module that publishes them.
        found.push(...boundNames(declaration.name));
      }
      continue;
    }

    const isDefault = hasModifier(statement, ts.SyntaxKind.DefaultKeyword);
    // Interfaces and type aliases are deliberately absent from this list. They exist only in type
    // space, so a runtime module CANNOT publish one: counting them would make every declaration
    // file differ from its module by exactly its types, and the comparison would report a mismatch
    // on every correct pair. What this compares is the VALUE surface, which is what a consumer
    // importing a binding at runtime actually receives.
    // `export declare namespace Foo {}` publishes `Foo` as a value binding, so a declaration that
    // adds one the module does not have is a real divergence. Its name is an identifier for an
    // ordinary namespace; the string form belongs to `declare module "x"`, which augments another
    // module rather than publishing anything here.
    // `export import Foo = require("./foo.cjs")` publishes `Foo` as a value a consumer can import
    // by name. It is a declaration file's way of re-exporting a CommonJS module, and it carries the
    // export modifier while being neither a declaration nor an export declaration.
    if (ts.isImportEqualsDeclaration(statement)) {
      // The export modifier is already required above, so reaching here means it is exported.
      found.push(statement.name.text);
      continue;
    }
    if (ts.isModuleDeclaration(statement)) {
      if (ts.isIdentifier(statement.name)) found.push(statement.name.text);
      continue;
    }
    if (
      ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isEnumDeclaration(statement)
    ) {
      // `export default function build() {}` publishes `default`, not `build`: a consumer imports it
      // without naming it, and the local name is not part of the surface.
      if (isDefault) found.push("default");
      else if (statement.name !== undefined) found.push(statement.name.text);
    }
  }

  return [...new Set(found)].sort();
}

describe("reading the names a module publishes", () => {
  it("records a default export, in each form it is written", () => {
    // Neither the keyword matcher nor the export list saw these, so a module with one and a
    // declaration without it compared equal.
    expect(exportedNames(`export default function build() {}`)).toEqual([
      "default",
    ]);
    expect(exportedNames(`export default async function build() {}`)).toEqual([
      "default",
    ]);
    expect(exportedNames(`export default class Preset {}`)).toEqual([
      "default",
    ]);
    expect(exportedNames(`const preset = {};\nexport default preset;`)).toEqual(
      ["default"]
    );
    // A declaration file states it this way, and it is the same published name.
    expect(
      exportedNames(
        `declare const preset: object;\nexport { preset as default };`
      )
    ).toEqual(["default"]);
  });

  it("does not read a default export into a module without one", () => {
    // The control: `default` must come from the export, not from the word appearing in the file.
    expect(
      exportedNames(`export const defaults = 1;\n// export default preset;`)
    ).toEqual(["defaults"]);
  });

  it("refuses a re-exported binding, whose space another module decides", () => {
    // Recording the name was the earlier behaviour, and it fails OPEN: whether
    // `export { extra } from "./other.mjs"` publishes a value depends on whether `other` declares
    // `const extra` or `interface extra`, so a declaration re-exporting a type compared equal to a
    // module publishing a real one. Skipping it fails open differently — invisible on BOTH sides,
    // which is agreement over a real gap.
    //
    // Refusing is the third option and the only one that cannot pass wrongly. Resolving it properly
    // means reading the target, mapping a declaration file to its runtime twin by extension, and
    // terminating cycles — the unbounded exercise `export *` is already refused for.
    expect(exportedNames(`export { extra } from "./other.mjs";`)).toEqual([
      "<unsupported: re-export of extra from ./other.mjs>",
    ]);
    // The LOCAL name is what another module decides, so a rename is reported by its source name.
    expect(
      exportedNames(`export { extra as renamed } from "./other.mjs";`)
    ).toEqual(["<unsupported: re-export of extra from ./other.mjs>"]);
    // The control: a list with no `from` names local bindings and is still read exactly.
    expect(exportedNames(`const extra = 1;\nexport { extra };`)).toEqual([
      "extra",
    ]);
  });

  it("refuses a star export rather than modelling the module system", () => {
    // Following `export *` correctly means implementing resolution: `default` is not forwarded, a
    // name reached through two sources is ambiguous unless both resolve to the SAME binding, a
    // declaration file maps its target by the runtime extension it names, and cycles must
    // terminate. Getting any one wrong reports a surface neither file has.
    //
    // Neither file compared here uses one, so this fails closed and says why, rather than
    // producing a subtly wrong answer.
    expect(exportedNames(`export * from "./helper.mjs";`)).toEqual([
      "<unsupported: export * from ./helper.mjs>",
    ]);
    // The refusal carries the SOURCE, so two files agree only when they star-export the same
    // module -- and a one-sided star export fails loudly rather than comparing equal.
    expect(exportedNames(`export * from "./a.mjs";`)).not.toEqual(
      exportedNames(`export * from "./b.mjs";`)
    );
    // A local export beside it is still read, so the refusal does not swallow the rest of the file.
    expect(
      exportedNames(`export * from "./x.mjs";\nexport const own = 1;`)
    ).toEqual(["<unsupported: export * from ./x.mjs>", "own"]);
  });

  it("records a namespace re-export, which publishes exactly one name", () => {
    // `export * as colors from "./color.mjs"` is neither a star export whose names live elsewhere
    // nor a braced list, so it matched nothing and was invisible on both sides at once.
    expect(exportedNames(`export * as colors from "./color.mjs";`)).toEqual([
      "colors",
    ]);
    // The control: it must not also be read as an unenumerable star export, or the two forms would
    // report the same thing and the binding's NAME would be lost.
    expect(
      exportedNames(`export * as colors from "./color.mjs";`)
    ).not.toContain("<star export from ./color.mjs>");
  });

  it("does not read an export out of a block comment", () => {
    // Commenting a binding out is how one is REMOVED. Matched as text, the inner line still begins
    // with `export` at column zero, so the binding was reported as published and a declaration that
    // still named it compared equal -- the removal invisible on both sides at once.
    expect(
      exportedNames(`/*\nexport const stale = 1;\n*/\nexport const live = 2;`)
    ).toEqual(["live"]);
    // A line comment is the same question, and so is an export named inside a string.
    expect(
      exportedNames(`// export const alsoStale = 1;\nexport const live = 2;`)
    ).toEqual(["live"]);
    expect(
      exportedNames(`export const doc = \`export const inText = 1;\`;`)
    ).toEqual(["doc"]);
  });

  it("publishes `default` for a default declaration, not its local name", () => {
    // `export default function build() {}` is imported without naming it, so the local name is not
    // part of the surface and reporting it would compare against a name no consumer can use.
    expect(exportedNames(`export default function build() {}`)).toEqual([
      "default",
    ]);
    expect(exportedNames(`export default class Preset {}`)).toEqual([
      "default",
    ]);
  });

  it("publishes an exported import-equals declaration", () => {
    // A declaration file re-exports a CommonJS module this way, and a consumer can import `Foo` by
    // name. It carries the export modifier while being neither a declaration nor an export
    // declaration, so it matched nothing.
    expect(exportedNames(`export import Foo = require("./foo.cjs");`)).toEqual([
      "Foo",
    ]);
    // The control: WITHOUT the export modifier it is a local alias and publishes nothing.
    expect(exportedNames(`import Foo = require("./foo.cjs");`)).toEqual([]);
  });

  it("publishes an exported namespace, which is a value binding", () => {
    // A declaration file adding `export declare namespace Foo {}` that the module does not have is
    // a real divergence, and ignoring the statement made both lists agree over it.
    expect(
      exportedNames(`export declare namespace Foo { const x: number; }`)
    ).toEqual(["Foo"]);
    // The control: `declare module "x"` augments ANOTHER module and publishes nothing here, so a
    // rule keyed on the statement kind alone would invent a binding named after a package.
    expect(
      exportedNames(`declare module "some-package" { export const y: number; }`)
    ).toEqual([]);
  });

  it("names every binding a destructuring export introduces", () => {
    // `export const { extra } = value` binds a name the module publishes, and reading only the
    // identifier form recorded nothing -- invisible on both sides at once.
    expect(exportedNames(`export const { extra } = value;`)).toEqual(["extra"]);
    expect(exportedNames(`export const { a, b: c } = value;`)).toEqual([
      "a",
      "c",
    ]);
    expect(exportedNames(`export const [x, , y] = value;`)).toEqual(["x", "y"]);
    expect(exportedNames(`export const { a, ...rest } = value;`)).toEqual([
      "a",
      "rest",
    ]);
  });

  it("names every declarator in one exported statement", () => {
    expect(exportedNames(`export const a = 1, b = 2;`)).toEqual(["a", "b"]);
  });

  it("ignores a type-only re-export, which publishes no value", () => {
    expect(exportedNames(`export { type Only } from "./x.mjs";`)).toEqual([]);
    expect(exportedNames(`export type { Also } from "./x.mjs";`)).toEqual([]);
  });

  it("names a binding once when it is both declared and listed", () => {
    expect(exportedNames(`export const a = 1;\nexport { a };`)).toEqual(["a"]);
  });

  it("leaves out a listed name that exists only in type space", () => {
    // Neither the declaration nor the element is marked type-only here, so nothing syntactic says
    // this publishes no value — and a runtime module with `export const Foo = 1` would compare
    // equal to a declaration that never offered one.
    expect(exportedNames(`interface Foo {}\nexport { Foo };`)).toEqual([]);
    expect(exportedNames(`type Bar = string;\nexport { Bar };`)).toEqual([]);
    // Renamed on the way out: the LOCAL name decides which space it occupies, not the public one.
    expect(
      exportedNames(`interface Foo {}\nexport { Foo as Public };`)
    ).toEqual([]);
  });

  it("leaves out a listed name imported only as a type", () => {
    // The syntax says which space it lands in, and neither spelling marks the EXPORT — so a
    // declaration re-exporting an imported type read as publishing a value, and compared equal to
    // a module that publishes a real binding of that name.
    expect(
      exportedNames(`import type { Foo } from "./x.mjs";\nexport { Foo };`)
    ).toEqual([]);
    expect(
      exportedNames(`import { type Foo } from "./x.mjs";\nexport { Foo };`)
    ).toEqual([]);
    expect(
      exportedNames(`import type Foo from "./x.mjs";\nexport { Foo };`)
    ).toEqual([]);
    // The control, and the one that must not regress: an ordinary import re-exported IS a value.
    expect(
      exportedNames(`import { Foo } from "./x.mjs";\nexport { Foo };`)
    ).toEqual(["Foo"]);
    expect(
      exportedNames(`import Foo from "./x.mjs";\nexport { Foo };`)
    ).toEqual(["Foo"]);
  });

  it("keeps a name that is a type AND a value", () => {
    // Declaration merging is real, and the value is what a consumer importing the name receives.
    // Dropping it because a type shares the name would report a surface the module does not have.
    expect(
      exportedNames(`interface Foo {}\nconst Foo = 1;\nexport { Foo };`)
    ).toEqual(["Foo"]);
    // The controls: ordinary value declarations are unaffected by the type-space reading.
    expect(exportedNames(`function build() {}\nexport { build };`)).toEqual([
      "build",
    ]);
    expect(exportedNames(`class Preset {}\nexport { Preset };`)).toEqual([
      "Preset",
    ]);
    expect(exportedNames(`enum Mode { On }\nexport { Mode };`)).toEqual([
      "Mode",
    ]);
  });
});

describe("the hand-written declaration beside the module", () => {
  // A `.d.mts` maintained alongside a `.mjs` is a second list of the same facts, which is the
  // shape this module exists to remove everywhere else. Nothing typechecks these tests today, so
  // a declaration naming a function that no longer exists stayed green through a rename.
  const scripts = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "scripts"
  );
  // A marker means the reader met syntax it will not model, and it has to STOP the comparison
  // rather than take part in one. Both surfaces are collected the same way, so the same
  // unsupported syntax on each side — the natural shape, since a star export is added to a module
  // and its declaration together — produces the same marker twice and the two lists compare equal
  // while none of the bindings it publishes has been compared at all.
  const bindings = (file: string, source: string): string[] => {
    const found = exportedNames(source);
    const unreadable = found.filter(name => name.startsWith("<unsupported:"));
    if (unreadable.length > 0) {
      throw new Error(
        `${file} uses syntax this reader will not model (${unreadable.join(", ")}), so the ` +
          `bindings it publishes were never listed. Name them explicitly, or teach the reader ` +
          `to resolve them.`
      );
    }
    return found;
  };

  const names = (file: string): string[] =>
    bindings(file, readFileSync(path.join(scripts, file), "utf8"));

  it("refuses a surface it could not read, rather than comparing markers", () => {
    expect(() =>
      bindings("published-entries.mjs", `export * from "./helper.mjs";`)
    ).toThrow(/will not model/);
    // The control: an ordinary surface is still read and returned, so the refusal above is the
    // marker's doing and not a helper that rejects everything.
    expect(bindings("published-entries.mjs", `export const x = 1;`)).toEqual([
      "x",
    ]);
  });

  // DISCOVERED rather than listed. A named pair covers the module someone remembered, and a second
  // `.mjs` that grows a declaration beside it drifts unwatched — which is how a declaration went on
  // advertising five helpers after their implementations were deleted.
  const pairs = readdirSync(scripts)
    .filter(file => file.endsWith(".d.mts"))
    .map(declaration => ({
      declaration,
      module: `${declaration.slice(0, -".d.mts".length)}.mjs`,
    }));

  it("has a declaration to check, so the rule cannot pass vacuously", () => {
    expect(pairs.map(pair => pair.declaration)).toContain(
      "published-entries.d.mts"
    );
  });

  it.each(pairs)(
    "$declaration declares exactly the bindings $module exports",
    ({ declaration, module }) => {
      const runtime = names(module);
      expect(
        runtime.length,
        `no exported bindings were found in ${module} to compare`
      ).toBeGreaterThan(0);
      expect(names(declaration)).toEqual(runtime);
    }
  );
});
