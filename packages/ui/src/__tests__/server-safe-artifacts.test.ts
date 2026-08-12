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

  it("reads a top-level loader that an unrelated nested binding cannot shadow", () => {
    // Shadowing was answered from one set of every name declared anywhere in the file, so a
    // parameter in some unrelated helper suppressed a call it could never reach. The binding below
    // is invisible at the top level, and `module.require` is opaque to both the metafile and the
    // specifier list, so the dependency passed the gate entirely.
    expect(
      read(`
        function unrelated(module) { return module.id; }
        const react = module.require("react");
      `)
    ).toEqual(["react"]);
    expect(
      read(`
        function unrelated(require) { return require; }
        const react = require("react");
      `)
    ).toEqual(["react"]);
    // The control, in the direction that costs a lane a red build: a binding that DOES enclose the
    // call still suppresses it, which is the behaviour the file-wide set got right.
    expect(
      read(`
        function outer(require) {
          return require("react");
        }
      `)
    ).toEqual([]);
  });

  it("sees a loader shadowed through a destructured binding", () => {
    // `const { require } = ...` binds the name without an identifier anywhere in `node.name`, so a
    // check reading only `ts.isIdentifier` treats the local as the ambient loader.
    expect(
      read(`
        const { require } = loaders;
        export const label = require("react");
      `)
    ).toEqual([]);
    expect(
      read(`
        const [require] = loaders;
        export const label = require("react");
      `)
    ).toEqual([]);
  });

  it("does not treat a nested binding as the stored loader it shadows", () => {
    // A stored loader is made BY a declaration, so the binding qualifies the call rather than
    // disqualifying it — the opposite of `require`, where any binding means the call is not the
    // ambient loader. Reading membership alone treated the parameter below as the resolver and
    // rejected an artifact whose call loads nothing, which costs a correct lane a red build.
    expect(
      read(`
        export const resolve = import.meta.resolve;
        export function f(resolve) { return resolve("react"); }
      `)
    ).toEqual([]);
    expect(
      read(`
        import { createRequire } from "node:module";
        const load = createRequire(import.meta.url);
        export function g(load) { return load("react"); }
      `)
    ).toEqual(["node:module"]);
    // The control, and the one a careless fix breaks: at the scope where the loader IS declared,
    // the call is still a module load.
    expect(
      read(`
        export const resolve = import.meta.resolve;
        export const react = resolve("react");
      `)
    ).toEqual(["react"]);
  });

  it("gives a var loader the function scope it actually has", () => {
    // `var` is function-scoped however deeply it is nested, so this call and that declaration are
    // the same binding. Attributing the loader to the BLOCK put it out of reach of the call and the
    // package went unreported — and neither the metafile nor the surviving specifiers name a
    // package reached this way, so nothing else would have caught it.
    expect(
      read(`
        function f() {
          { var resolve = import.meta.resolve; }
          return resolve("react");
        }
      `)
    ).toEqual(["react"]);
    // The mirror, in the shadowing direction: a `var` in a block DOES shadow the ambient loader
    // for the whole function, so this call loads nothing.
    expect(
      read(`
        function f() {
          { var require = (name) => name; }
          return require("react");
        }
      `)
    ).toEqual([]);
    // The control that keeps the fix honest: a nested FUNCTION owns its own `var`, so it cannot
    // shadow a call in the function containing it.
    expect(
      read(`
        function outer() {
          function inner() { var require = (name) => name; }
          return require("react");
        }
      `)
    ).toEqual(["react"]);
    // And `let` is still block-scoped, which is what makes this a `var` rule rather than a
    // "hoist everything" rule.
    expect(
      read(`
        function f() {
          { let require = (name) => name; }
          return require("react");
        }
      `)
    ).toEqual(["react"]);
  });

  it("sees a loader assigned after it is declared", () => {
    // A name takes a loader two ways that look different and mean the same: a declaration with an
    // initializer, and a later assignment. Reading only initializers made the assignment form
    // invisible, and it survives the bundler intact while leaving no metafile record.
    expect(
      read(
        `let load;\nload = import.meta.resolve;\nexport const r = load("react");`
      )
    ).toEqual(["react"]);
    expect(
      read(`
        import { createRequire } from "node:module";
        let load;
        load = createRequire(import.meta.url);
        export const r = load("react");
      `)
    ).toEqual(["node:module", "react"]);
    // Handed on by assignment rather than by declaration, which the alias chain must also follow.
    expect(
      read(
        `const a = import.meta.resolve;\nlet b;\nb = a;\nexport const r = b("react");`
      )
    ).toEqual(["react"]);
    // The controls: an assignment of something that is not a loader makes none, and a binding that
    // encloses the call still shadows it.
    expect(
      read(`let x;\nx = somethingElse;\nexport const r = x("react");`)
    ).toEqual([]);
    expect(
      read(`
        const resolve = import.meta.resolve;
        function f(resolve) { return resolve("react"); }
      `)
    ).toEqual([]);
  });

  it("reads a destructuring key in every spelling", () => {
    // `{ resolve: load }` names the key with an identifier and `{ ["resolve"]: load }` with a
    // literal wrapped in a ComputedPropertyName — one node kind deeper, so a check reading the
    // property name directly sees the wrong kind and the loader is never registered.
    expect(
      read(
        `const { ["resolve"]: load } = import.meta;\nexport const r = load("react");`
      )
    ).toEqual(["react"]);
    expect(
      read(
        'const { [`resolve`]: load } = import.meta;\nexport const r = load("react");'
      )
    ).toEqual(["react"]);
    // The control that keeps it a KEY rule rather than a blanket one: another computed property of
    // `import.meta` is still not a resolver.
    expect(
      read(`const { ["url"]: u } = import.meta;\nexport const r = u("react");`)
    ).toEqual([]);
  });

  it("reads a namespaced createRequire in both member spellings", () => {
    // `mod.createRequire` and `mod["createRequire"]` are the same access. Written as a property
    // access only, the computed form walked past — and `readsMember`, which covers both, already
    // existed a few lines above, so the two spellings had drifted inside one file.
    expect(
      read(`
        import * as mod from "node:module";
        const load = mod["createRequire"](import.meta.url);
        export const r = load("react");
      `)
    ).toEqual(["node:module", "react"]);
    // The control: only the namespace that node:module was imported under counts, in either
    // spelling.
    expect(
      read(`
        import * as other from "other-package";
        const load = other["createRequire"](import.meta.url);
        export const r = load("react");
      `)
    ).toEqual(["other-package"]);
  });

  it("sees a resolver taken off import.meta by destructuring", () => {
    // `const { resolve } = import.meta` binds the resolver without the text `import.meta.resolve`
    // appearing anywhere, so the initializer check never saw it — and this reading is the only
    // control on that resolver, since it leaves no metafile record and no surviving import.
    expect(
      read(
        `const { resolve } = import.meta;\nexport const r = resolve("react");`
      )
    ).toEqual(["react"]);
    // Renamed on the way out, which is the ordinary emitted form.
    expect(
      read(
        `const { resolve: load } = import.meta;\nexport const r = load("react");`
      )
    ).toEqual(["react"]);
    // The controls, both directions: another property of `import.meta` is not a resolver, and the
    // same destructuring off an unrelated object is not either.
    expect(
      read(`const { url } = import.meta;\nexport const r = url("react");`)
    ).toEqual([]);
    expect(
      read(
        `const { resolve } = someLibrary;\nexport const r = resolve("react");`
      )
    ).toEqual([]);
  });

  it("keeps a class static block's var inside it", () => {
    // `class C { static { var x } }` puts `x` nowhere outside those braces, so the block is its own
    // `var` scope. Hoisting out of it made the file look like the binding scope and rejected a
    // build whose call resolves to the block's own local.
    expect(
      read(`
        const resolve = import.meta.resolve;
        class C { static { var resolve = (name) => name; resolve("react"); } }
      `)
    ).toEqual([]);
    // The control in the other direction: a static block with no local of that name still reaches
    // the outer resolver, so this is a scoping rule and not a blanket exemption for static blocks.
    expect(
      read(`
        const resolve = import.meta.resolve;
        class C { static { resolve("react"); } }
      `)
    ).toEqual(["react"]);
    // And the other half of the same rule, which the two assertions above cannot distinguish: the
    // block's `var` must not escape to shadow a call OUTSIDE it. Making the block a binding scope
    // fixes the first case on its own; only stopping the hoisting walk at it fixes this one.
    expect(
      read(`
        class C { static { var require = (name) => name; } }
        export const r = require("react");
      `)
    ).toEqual(["react"]);
  });

  it("resolves a default parameter initializer without the body's vars", () => {
    // Parameter initializers are evaluated BEFORE the body's `var` declarations exist, so this call
    // reads the OUTER resolver. Counting the body's hoisted names made the function the nearest
    // binding and the loader stopped being recognised — and `import.meta.resolve` leaves no
    // metafile record, so nothing else would have caught the package it names.
    expect(
      read(`
        const resolve = import.meta.resolve;
        function f(x = resolve("react")) { var resolve; }
      `)
    ).toEqual(["react"]);
    // The control: a PARAMETER of that name is visible to a later initializer, so it still shadows.
    expect(
      read(`
        const resolve = import.meta.resolve;
        function f(resolve, x = resolve("react")) { return x; }
      `)
    ).toEqual([]);
  });

  it("does not read a named class as the loader it shadows", () => {
    // A named class binds its own name throughout its body, exactly as a named function expression
    // does. Only functions were doing that, so a call inside such a body read as the ambient loader
    // and rejected an artifact that loads nothing — the direction that costs a correct lane a red
    // build rather than letting a dependency through.
    expect(
      read(
        `const C = class require { static f() { return require("react"); } };`
      )
    ).toEqual([]);
    expect(
      read(`class require { static f() { return require("react"); } }`)
    ).toEqual([]);
    // The controls, in both directions a careless fix breaks: the binding does not escape the class
    // body, and an UNNAMED class shadows nothing at all.
    expect(
      read(`const C = class require {};\nexport const r = require("react");`)
    ).toEqual(["react"]);
    expect(
      read(`const C = class { static f() { return require("react"); } };`)
    ).toEqual(["react"]);
  });

  it("sees a loader declared in a braceless switch case", () => {
    // A switch's CaseBlock is ONE lexical scope shared by every clause, so a `const` in a case
    // without braces belongs to it. Recognising only blocks and source files left the declaration
    // with no scope at all, which unregistered the loader — and `import.meta.resolve` reaches a
    // package without leaving a metafile record, so nothing else would have caught it.
    expect(
      read(`
        function f(kind) {
          switch (kind) {
            case 0:
              const resolve = import.meta.resolve;
              return resolve("react");
          }
        }
      `)
    ).toEqual(["react"]);
    // The braced form, which already worked, kept as the control that the two spellings agree.
    expect(
      read(`
        function f(kind) {
          switch (kind) {
            case 0: {
              const resolve = import.meta.resolve;
              return resolve("react");
            }
          }
        }
      `)
    ).toEqual(["react"]);
    // The shadowing mirror, and the bound on it: a case-scoped binding suppresses the loader
    // INSIDE the switch and does not escape it.
    expect(
      read(`
        function f(kind) {
          switch (kind) {
            case 0:
              const require = (name) => name;
              return require("react");
          }
        }
      `)
    ).toEqual([]);
    expect(
      read(`
        function f(kind) {
          switch (kind) {
            case 0:
              const require = (name) => name;
          }
          return require("react");
        }
      `)
    ).toEqual(["react"]);
  });

  it("gives a for-loop var loader the function scope too", () => {
    // The `for` initializer is a scope for `let`/`const` and NOT for `var`, which binds to the
    // enclosing function like any other. Treating every initializer as a scope put the loader out
    // of reach of a call after the loop.
    expect(
      read(`
        function f() {
          for (var resolve = import.meta.resolve; false; ) {}
          return resolve("react");
        }
      `)
    ).toEqual(["react"]);
    // The shadowing mirror: a `var` in the initializer suppresses the ambient loader for the whole
    // function, so this call loads nothing.
    expect(
      read(`
        function f() {
          for (var require = (name) => name; false; ) {}
          return require("react");
        }
      `)
    ).toEqual([]);
    // The control that separates the two kinds: a `let` initializer stays with the loop, so it
    // shadows nothing after it.
    expect(
      read(`
        function f() {
          for (let require = (name) => name; false; ) {}
          return require("react");
        }
      `)
    ).toEqual(["react"]);
  });

  it("keeps every loader binding, not the last one declared under a name", () => {
    // Two scopes can each declare a resolver under the same name. Recording one scope per name let
    // the second declaration overwrite the first, so the earlier function's call stopped resolving
    // and whatever it named went unreported — while the later one kept working, which is what makes
    // this invisible: the check still reports something.
    expect(
      read(`
        export function a() {
          const resolve = import.meta.resolve;
          return resolve("react");
        }
        export function b() {
          const resolve = import.meta.resolve;
          return resolve("clsx");
        }
      `)
    ).toEqual(["react", "clsx"]);
    // The same shape through the CommonJS factory rather than the resolver.
    expect(
      read(`
        import { createRequire } from "node:module";
        export function a() {
          const load = createRequire(import.meta.url);
          return load("react");
        }
        export function b() {
          const load = createRequire(import.meta.url);
          return load("clsx");
        }
      `)
    ).toEqual(["node:module", "react", "clsx"]);
  });

  it("does not treat a nested binding as the imported require factory", () => {
    // The import that makes a name the factory sits at module scope, so a parameter of the same
    // word is a different value and calling it makes no loader.
    expect(
      read(`
        import { createRequire } from "node:module";
        export function h(createRequire) {
          return createRequire(import.meta.url)("react");
        }
      `)
    ).toEqual(["node:module"]);
    // The control: at module scope the factory is still recognised.
    expect(
      read(`
        import { createRequire } from "node:module";
        export const react = createRequire(import.meta.url)("react");
      `)
    ).toEqual(["node:module", "react"]);
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
    const declared = new Set(Object.keys(manifest.dependencies ?? {}));
    const undeclared = [...SERVER_SAFE_ALLOWED_PACKAGES].filter(
      name => !declared.has(name)
    );
    expect(undeclared).toEqual([]);
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
