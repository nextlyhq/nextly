/**
 * The export map is the enrolment list for three guards, so what it REFUSES is load-bearing.
 *
 * These run against fixtures rather than this package's own `package.json`. Every refusal below
 * describes a map the package does not have yet — a client subpath beside the root, a bare
 * JavaScript target, two subpaths sharing one artifact — and a check exercised only against the
 * real map would be asserting that today's map is acceptable, which is a different claim.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function exportedNames(
  source: string,
  from?: { dir: string; seen: Set<string>; declaration?: boolean }
): string[] {
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
  /** One entry per `export * from`, so a name reached through two of them is recognisable. */
  const starred: string[][] = [];

  // One reader, so the `canHaveModifiers` guard is applied once rather than at each call site.
  // `getModifiers` requires a node that can carry them, and a second caller reaching for them
  // directly is how the guard gets skipped.
  const modifiersOf = (node: ts.Node): readonly ts.Modifier[] =>
    ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []) : [];

  const hasModifier = (node: ts.Node, kind: ts.SyntaxKind): boolean =>
    modifiersOf(node).some(modifier => modifier.kind === kind);

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
        // `export * from "./x"` publishes the other module's names as this one's. Comparing two
        // files that each carry the same MARKER agrees without ever comparing what the two sides
        // of the star actually publish, so the target is read and its names merged in.
        //
        // Only relative specifiers can be followed. A bare package name resolves through
        // node_modules and is not this package's surface to declare, so it stays a marker: two
        // files then agree only when they star-export the same package, and a one-sided one fails.
        const specifier = statement.moduleSpecifier;
        const where =
          specifier !== undefined && ts.isStringLiteral(specifier)
            ? specifier.text
            : "?";
        // A declaration file uses the NodeNext spelling and points at the RUNTIME name:
        // `export * from "./helper.mjs"` inside a `.d.mts` means `helper.d.mts`. Opening the
        // literal path reads the runtime helper from both sides, so the two readers collect the
        // same names and a binding the declaration omits is invisible.
        const target =
          from !== undefined && where.startsWith(".")
            ? from.declaration
              ? resolve(
                  from.dir,
                  where.replace(/\.m?js$/, match =>
                    match === ".mjs" ? ".d.mts" : ".d.ts"
                  )
                )
              : resolve(from.dir, where)
            : undefined;
        if (target === undefined) {
          found.push(`<star export from ${where}>`);
        } else if (from!.seen.has(target)) {
          // A cycle. Already being read further up the stack, so its names arrive from there.
          continue;
        } else {
          from!.seen.add(target);
          // Unreadable is reported rather than skipped: a star export naming a file that is not
          // there is a broken surface, and silently contributing nothing would read as agreement.
          let text: string;
          try {
            text = readFileSync(target, "utf8");
          } catch {
            found.push(`<unreadable star export from ${where}>`);
            continue;
          }
          // Kept apart from the local names, because ECMAScript resolves a collision between two
          // star exports by publishing NEITHER, while a LOCAL export of the same name wins
          // outright. Merged straight in, an ambiguous name would be reported as published and a
          // declaration that correctly omits it would read as a divergence.
          // `export *` never forwards `default` -- ECMAScript excludes it explicitly, so a barrel
          // star-exporting a module with a default export does not itself have one. Merging it made
          // the reader report a default the module does not publish.
          starred.push(
            exportedNames(text, {
              dir: dirname(target),
              seen: from!.seen,
              declaration: from!.declaration,
            })
          );
        }
      } else if (ts.isNamespaceExport(clause)) {
        // `export * as colors from "./x"` publishes exactly one binding, named `colors`.
        found.push(clause.name.text);
      } else {
        // A list, with or without a `from`. A re-export publishes a binding as a local one does,
        // and `export { x as default }` is the other spelling of a default export.
        for (const element of clause.elements) {
          if (element.isTypeOnly) continue;
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

  // A local export shadows every star export of the same name, so those are settled first. Among
  // the stars, a name reached through exactly one of them is published and a name reached through
  // two or more is ambiguous and published by neither -- which is what the runtime barrel does, so
  // it is what the declaration must be compared against.
  const local = new Set(found);
  const reach = new Map<string, number>();
  for (const names of starred) {
    for (const name of new Set(names)) {
      if (name === "default") continue;
      if (local.has(name)) continue;
      reach.set(name, (reach.get(name) ?? 0) + 1);
    }
  }
  for (const [name, sources] of reach) {
    if (sources === 1) local.add(name);
  }
  return [...local].sort();
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

  it("records a re-exported binding, which publishes a name like any other", () => {
    // `export { extra } from "./other.mjs"` adds a public binding. Skipped, it was invisible on
    // BOTH sides at once — the one way a parity comparison reports agreement over a real gap.
    expect(exportedNames(`export { extra } from "./other.mjs";`)).toEqual([
      "extra",
    ]);
    expect(
      exportedNames(`export { extra as renamed } from "./other.mjs";`)
    ).toEqual(["renamed"]);
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

  it("follows a relative star export and publishes what it finds", () => {
    // The names of `export * from "./helper.mjs"` ARE this module's surface. Two files that each
    // carry the same marker compare equal without either side of the star ever being read, so a
    // binding the helper publishes and the declaration omits would pass unexamined.
    const dir = mkdtempSync(path.join(tmpdir(), "nx-star-"));
    writeFileSync(
      path.join(dir, "helper.mjs"),
      `export const fromHelper = 1;\nexport function alsoHelper() {}\n`
    );
    expect(
      exportedNames(`export * from "./helper.mjs";\nexport const own = 2;`, {
        dir,
        seen: new Set(),
      })
    ).toEqual(["alsoHelper", "fromHelper", "own"]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("does not forward a default export through a star", () => {
    // ECMAScript excludes `default` from `export *` explicitly, so a barrel star-exporting a module
    // with a default does not itself have one. Reporting it invents a binding no consumer can
    // import, and a declaration that correctly omits it would read as a divergence.
    const dir = mkdtempSync(path.join(tmpdir(), "nx-star-default-"));
    writeFileSync(
      path.join(dir, "helper.mjs"),
      `export default function build() {}\nexport const named = 1;`
    );
    expect(
      exportedNames(`export * from "./helper.mjs";`, { dir, seen: new Set() })
    ).toEqual(["named"]);
    // The control: a default the barrel declares ITSELF is still published.
    expect(
      exportedNames(`export * from "./helper.mjs";\nexport default 1;`, {
        dir,
        seen: new Set(),
      })
    ).toEqual(["default", "named"]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("publishes neither name when two star exports collide", () => {
    // ECMAScript resolves an ambiguous star name by publishing NOTHING: a barrel star-exporting two
    // modules that both export `x` does not export `x` at all. Merged blindly, the reader reports it
    // as published and a declaration that correctly omits it reads as a divergence.
    const dir = mkdtempSync(path.join(tmpdir(), "nx-ambig-"));
    writeFileSync(
      path.join(dir, "a.mjs"),
      `export const shared = 1;\nexport const onlyA = 2;`
    );
    writeFileSync(
      path.join(dir, "b.mjs"),
      `export const shared = 3;\nexport const onlyB = 4;`
    );
    expect(
      exportedNames(`export * from "./a.mjs";\nexport * from "./b.mjs";`, {
        dir,
        seen: new Set(),
      })
    ).toEqual(["onlyA", "onlyB"]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("lets a local export win over a star export of the same name", () => {
    // The other half of the rule, and the control on it: ambiguity applies only among stars. A
    // local export shadows them outright, so `shared` IS published here.
    const dir = mkdtempSync(path.join(tmpdir(), "nx-shadow-"));
    writeFileSync(path.join(dir, "a.mjs"), `export const shared = 1;`);
    writeFileSync(path.join(dir, "b.mjs"), `export const shared = 3;`);
    expect(
      exportedNames(
        `export * from "./a.mjs";\nexport * from "./b.mjs";\nexport const shared = 5;`,
        { dir, seen: new Set() }
      )
    ).toEqual(["shared"]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("survives a star export cycle", () => {
    // Two modules star-exporting each other would otherwise recurse without end.
    const dir = mkdtempSync(path.join(tmpdir(), "nx-cycle-"));
    writeFileSync(
      path.join(dir, "a.mjs"),
      `export * from "./b.mjs";\nexport const fromA = 1;\n`
    );
    writeFileSync(
      path.join(dir, "b.mjs"),
      `export * from "./a.mjs";\nexport const fromB = 2;\n`
    );
    expect(
      exportedNames(readFileSync(path.join(dir, "a.mjs"), "utf8"), {
        dir,
        seen: new Set([path.join(dir, "a.mjs")]),
      })
    ).toEqual(["fromA", "fromB"]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports a star export it cannot read rather than contributing nothing", () => {
    // Silently skipping an unreadable target is the failure this whole reader exists to avoid:
    // both files would contribute nothing and compare equal over a broken surface.
    const dir = mkdtempSync(path.join(tmpdir(), "nx-missing-"));
    expect(
      exportedNames(`export * from "./gone.mjs";`, { dir, seen: new Set() })
    ).toEqual(["<unreadable star export from ./gone.mjs>"]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("leaves a bare package star export as a marker", () => {
    // A package name resolves through node_modules and is not this package's surface to declare,
    // so it stays a marker: two files agree only when they star-export the same package.
    expect(
      exportedNames(`export * from "some-package";`, {
        dir: "/nowhere",
        seen: new Set(),
      })
    ).toEqual(["<star export from some-package>"]);
  });

  it("records a star re-export by its source, since its names are in another file", () => {
    // Unanswerable from this file alone, so it is carried as a marker rather than dropped: two
    // files agree only when they star-export the SAME module, and a one-sided one fails.
    expect(exportedNames(`export * from "./other.mjs";`)).toEqual([
      "<star export from ./other.mjs>",
    ]);
    expect(exportedNames(`export * from "./a.mjs";`)).not.toEqual(
      exportedNames(`export * from "./b.mjs";`)
    );
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

  it("resolves a declaration file's star export to a declaration file", () => {
    // A `.d.mts` re-exports by the RUNTIME name: `export * from "./helper.mjs"` means
    // `helper.d.mts`. Opening the literal path reads the runtime helper from both sides, so both
    // readers collect the same names and a binding the declaration omits is invisible.
    const dir = mkdtempSync(path.join(tmpdir(), "nx-dts-"));
    writeFileSync(
      path.join(dir, "helper.mjs"),
      `export const runtimeOnly = 1;`
    );
    writeFileSync(
      path.join(dir, "helper.d.mts"),
      `export declare const declaredOnly: number;`
    );
    expect(
      exportedNames(`export * from "./helper.mjs";`, {
        dir,
        seen: new Set(),
        declaration: true,
      })
    ).toEqual(["declaredOnly"]);
    // The control: the same source read as RUNTIME resolves to the runtime helper.
    expect(
      exportedNames(`export * from "./helper.mjs";`, { dir, seen: new Set() })
    ).toEqual(["runtimeOnly"]);
    rmSync(dir, { recursive: true, force: true });
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
  const names = (file: string): string[] =>
    exportedNames(readFileSync(path.join(scripts, file), "utf8"), {
      dir: scripts,
      seen: new Set([path.join(scripts, file)]),
      // Declaration files re-export by the runtime name, so their star targets need mapping back.
      declaration: file.endsWith(".d.mts") || file.endsWith(".d.ts"),
    });

  it("declares exactly the bindings the module exports", () => {
    const runtime = names("published-entries.mjs");
    expect(
      runtime.length,
      "no exported functions were found to compare"
    ).toBeGreaterThan(0);
    expect(names("published-entries.d.mts")).toEqual(runtime);
  });
});
