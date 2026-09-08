import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  importedSpecifiers,
  UNRESOLVABLE_SPECIFIER,
} from "@nextlyhq/module-specifiers";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  collectModules,
  MODULE_EXTENSIONS,
  TEST_GLOBS,
  TEST_MODULE,
} from "./source-modules";

/**
 * The package's layering contract, enforced rather than documented.
 *
 * Two promises, each broken by an import that is individually reasonable:
 *
 * 1. **The builder never imports `@nextlyhq/admin` directly.** Plugins and
 *    libraries reach admin only through `@nextlyhq/plugin-sdk/admin` — a curated
 *    facade where every export is named individually and carries a stability
 *    tag. A direct import bypasses the facade and takes a dependency on
 *    internals nobody promised to keep.
 *
 *    The pull toward it is real rather than hypothetical: the editor wants
 *    admin's Lexical node set for inline rich text, and reaching for it directly
 *    is the shape that looks harmless at the call site.
 *
 * 2. **The builder does not pull in the CMS runtime.** It draws with
 *    `@nextlyhq/blocks-react`'s root entry, which is standalone; the `/next`
 *    subpath is the Next-coupled one and imports `nextly/runtime`. Admitting it
 *    here would put the whole server runtime behind an editor component.
 *
 * The guard is an ALLOWLIST of exact specifiers. A blocklist only stops what
 * someone thought to name, and a rule written per PACKAGE rather than per
 * specifier silently admits every subpath a package happens to publish — which
 * is how `blocks-react/next` and `plugin-sdk/testing` would arrive. Adding an
 * entry below is a deliberate act with a reason recorded beside it.
 *
 * **What this file does NOT prove.** That the canvas renders THROUGH
 * `blocks-react` rather than reimplementing rendering on top of React and
 * `@nextlyhq/blocks-engine` is a property of what the code does, not of what it
 * imports, and both spellings import exactly the same packages. The allowlist
 * makes the shortcut inconvenient; it cannot make it impossible. That rule is a
 * design constraint, and nothing in this file enforces it.
 */

// `import.meta.dirname` only exists from Node 20.11 and the package floor is
// Node >=20.0, so derive the directory from the module URL instead.
const SRC_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * What the package may import at runtime, and why.
 *
 * - `react`, `react-dom`, `react/jsx-runtime`: the editor is a React app. Peer
 *   dependencies, so the host's copy is the only one in the tree.
 * - `@nextlyhq/blocks-engine`: the document model, validation and style
 *   compiler. Runtime-free.
 * - `@nextlyhq/blocks-react`: the renderer the canvas draws with — the same one
 *   that serves published pages.
 * - `@nextlyhq/ui`: the design system, and the only source of admin-theme
 *   tokens. Peer, for the same one-copy reason as React.
 * - `@nextlyhq/plugin-sdk`: the stable import surface, including the `/admin`
 *   subpath that is the ONLY sanctioned route to admin components.
 */
const ALLOWED_RUNTIME_IMPORTS = [
  "react",
  "react-dom",
  "react/jsx-runtime",
  // Icons only. `@nextlyhq/ui` declares it a peer for the same reason: one copy
  // resolved by the host app rather than one bundled per package.
  "lucide-react",
  "@nextlyhq/blocks-engine",
  // The ROOT entry only. `@nextlyhq/blocks-react/next` imports `nextly/runtime`,
  // and `/blocks` is the built-in catalogue, which nothing here needs yet.
  "@nextlyhq/blocks-react",
  "@nextlyhq/ui",
  // The `cn` helper only. A separate subpath because the root barrel carries a
  // `"use client"` banner and this one is plain string joining.
  "@nextlyhq/ui/utils",
  // Colour conversion only, and a separate subpath for the same reason `utils`
  // is: `ui` publishes it away from the root barrel precisely because it is
  // arithmetic on numbers with no React in it, so importing it does not pull a
  // client boundary into a pure module.
  //
  // It is the writing half of hex, and the engine owns the reading half — so
  // this entry is what keeps `style-colour.ts` from growing a hex composer of
  // its own. Note what it deliberately does NOT admit: `ui/styles/contrast` is
  // a different subpath, is not listed here, and is not published at all;
  // `style-colour-boundary.test.ts` is the guard that says why.
  "@nextlyhq/ui/color",
  // The `/admin` subpath ONLY, and not the SDK root. The root re-exports runtime
  // values from `nextly` (`export { definePlugin } from "nextly"`), which that
  // package's build leaves external, so importing it loads the CMS runtime this
  // guard exists to keep out. `/admin` re-exports from `@nextlyhq/admin` alone
  // and is the one sanctioned route to admin components. Nothing here imports
  // the root today; when the editor needs SDK types, add a type-only route
  // deliberately rather than widening this entry back.
  "@nextlyhq/plugin-sdk/admin",
];

/** Node built-ins and test-only tooling, which never reach a consumer's bundle. */
const ALLOWED_IN_TESTS = [
  "@nextlyhq/module-specifiers",
  "@testing-library/react",
  "node:fs",
  "node:path",
  "node:url",
  // Server rendering, for the hydration assertions. A shell whose server and
  // first client render disagree is repaired by React discarding the subtree,
  // and `renderToString` is the only way to observe that from a test.
  "react-dom/server",
  "typescript",
  "vitest",
];

/**
 * Extensions the bundler will follow, and therefore the ones this guard must read.
 *
 * Not just `.ts`/`.tsx`. A TypeScript entry can side-effect-import `./bridge.js`, and tsup
 * bundles it; a scan restricted to TypeScript would walk past the one file free to import
 * anything, with the typecheck none the wiser because `allowJs` is off.
 */

/** The package's modules, by the shared rule; only the file reading is local. */
function sourceFiles(dir: string): string[] {
  return collectModules(
    dir,
    at => readdirSync(at, { withFileTypes: true }),
    join
  );
}

/**
 * Every module specifier a file imports.
 *
 * MEMOISED, because the answer cannot change during a run and every contract
 * below sweeps the whole package: without this each one re-reads and re-parses
 * all of them, so the cost is the file count times the number of contracts
 * rather than the file count. That is disk-bound work on a shared runner, and
 * it put a single contract 200ms past the default 5s timeout while the same
 * test took under half a second locally — a red that says nothing about the
 * import graph it exists to check.
 *
 * Keyed by absolute path, which is what `sourceFiles` yields.
 */
const importCache = new Map<string, string[]>();

function importsOf(file: string): string[] {
  const cached = importCache.get(file);
  if (cached !== undefined) return cached;
  const specifiers = importedSpecifiers(readFileSync(file, "utf8"), file);
  importCache.set(file, specifiers);
  return specifiers;
}

/**
 * Whether one specifier may be imported.
 *
 * Exact match, deliberately. Judging by package would let any subpath in, and the subpaths are
 * exactly where the coupling lives: `blocks-react/next` carries `nextly/runtime` and
 * `plugin-sdk/testing` is not a production surface. A permitted subpath is written out in full.
 */
function isAllowed(specifier: string, inTest: boolean): boolean {
  const allowed = inTest
    ? [...ALLOWED_RUNTIME_IMPORTS, ...ALLOWED_IN_TESTS]
    : ALLOWED_RUNTIME_IMPORTS;
  return allowed.includes(specifier);
}

/** Bare package specifiers only — relative paths are this package's own code. */
function isBare(specifier: string): boolean {
  return !specifier.startsWith(".") && !specifier.startsWith("/");
}

describe("reading a module's imports", () => {
  // One case per import form the reader claims — static, side-effect, dynamic,
  // require, import-equals, typeof-import, JSDoc, triple-slash, template
  // literal — and the comment and string cases it must not claim, now live
  // beside the reader in `packages/module-specifiers/src/index.test.ts`. They
  // moved with it: a reader that quietly stops recognising a form returns a
  // clean result to every consumer at once, so the corpus that catches it
  // belongs where the reader is, not copied into each guard that calls it.
  //
  // What remains here is this package's own wiring, which the shared corpus
  // cannot establish.

  it("is exercised — the reader this guard calls finds a specifier", () => {
    // An empty offender list is only evidence once the search is shown to work.
    // A misrouted import or a renamed export returns exactly the same clean
    // result as compliance does.
    expect(
      importedSpecifiers(`import type { P } from "@nextlyhq/admin";`, "m.ts")
    ).toEqual(["@nextlyhq/admin"]);
    expect(
      importedSpecifiers(
        `export const C = () => <div>{require("@nextlyhq/admin")}</div>;`,
        "m.tsx"
      )
    ).toEqual(["@nextlyhq/admin"]);
  });

  it("rejects an unresolved dynamic import through the same allowlist as a named one", () => {
    // The sentinel is only useful if it survives the two filters between the
    // reader and the verdict: it must look bare, and must match no entry. That
    // is a property of THIS package's allowlists, so it stays here.
    expect(isBare(UNRESOLVABLE_SPECIFIER)).toBe(true);
    expect(ALLOWED_RUNTIME_IMPORTS).not.toContain(UNRESOLVABLE_SPECIFIER);
    expect(ALLOWED_IN_TESTS).not.toContain(UNRESOLVABLE_SPECIFIER);
  });

  it("ignores relative imports of the package's own code", () => {
    expect(
      importedSpecifiers(`import { x } from "./canvas";`, "m.ts").filter(isBare)
    ).toEqual([]);
  });
});

describe("what the allowlist admits", () => {
  // Asserted on specifiers directly rather than through the file scan: the rule that matters is
  // about subpaths no file in this package imports yet, and a contract test over real source can
  // only demonstrate rules its own source happens to exercise.

  it("admits the packages the editor is built from", () => {
    for (const specifier of [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "@nextlyhq/blocks-engine",
      "@nextlyhq/blocks-react",
      "@nextlyhq/ui",
    ]) {
      expect(isAllowed(specifier, false)).toBe(true);
    }
  });

  it("admits the one sanctioned route to admin", () => {
    expect(isAllowed("@nextlyhq/plugin-sdk/admin", false)).toBe(true);
  });

  it("refuses the Next-coupled renderer entry, which carries the CMS runtime", () => {
    // `@nextlyhq/blocks-react/next` imports `nextly/runtime`. Judging by package rather than by
    // specifier would have admitted it on the strength of the root entry being allowed.
    expect(isAllowed("@nextlyhq/blocks-react/next", false)).toBe(false);
    expect(isAllowed("@nextlyhq/blocks-react/blocks", false)).toBe(false);
  });

  it("refuses the SDK root, which re-exports runtime values from nextly", () => {
    // `@nextlyhq/plugin-sdk` re-exports `definePlugin` from `nextly`, and the SDK build leaves
    // `nextly` external, so the root drags the CMS runtime into the editor graph. The `/admin`
    // subpath re-exports from `@nextlyhq/admin` alone and stays allowed.
    expect(isAllowed("@nextlyhq/plugin-sdk", false)).toBe(false);
    expect(isAllowed("@nextlyhq/plugin-sdk/admin", false)).toBe(true);
  });

  it("refuses other subpaths of an allowed package", () => {
    expect(isAllowed("@nextlyhq/plugin-sdk/testing", false)).toBe(false);
    expect(isAllowed("@nextlyhq/plugin-sdk/client", false)).toBe(false);
  });

  it("refuses admin under every spelling", () => {
    expect(isAllowed("@nextlyhq/admin", false)).toBe(false);
    expect(isAllowed("@nextlyhq/admin/lexical", false)).toBe(false);
  });

  it("keeps test-only tooling out of shipped code", () => {
    // The one asymmetry in the list, so it is worth pinning in both directions.
    expect(isAllowed("vitest", true)).toBe(true);
    expect(isAllowed("vitest", false)).toBe(false);
    expect(isAllowed("node:fs", true)).toBe(true);
    expect(isAllowed("node:fs", false)).toBe(false);
  });
});

describe("the dependency graph, which is the stronger half of the admin rule", () => {
  // A package cannot import what it does not depend on. `@nextlyhq/admin` is in no dependency
  // field here, and pnpm's node_modules is not hoisted, so every spelling of a direct admin
  // import — dynamic, `require`, `import x = require`, `typeof import`, a JSDoc typedef, a
  // triple-slash reference, in a `.js` file, cached or not — fails to RESOLVE. That is a
  // completeness the source scan cannot claim: the scan covers the syntaxes someone thought of,
  // this covers all of them at once, including syntaxes TypeScript has not shipped yet.
  //
  // The scan is still worth having. It fails at test time with a message that names the rule
  // rather than at build time with a resolution error, and it is the ONLY enforcement for the
  // subpath policy: `blocks-react/next`, the `plugin-sdk` root and `plugin-sdk/testing` all
  // resolve perfectly, because their packages are legitimate dependencies — the graph has
  // nothing to say about which ENTRY of a dependency is allowed.

  const manifest: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  } = JSON.parse(readFileSync(join(SRC_DIR, "..", "package.json"), "utf8"));

  const declared = [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ];

  it("reads a manifest that actually declares things", () => {
    // Positive control. An unparsed or empty manifest would satisfy the assertion below while
    // proving nothing, which is the failure mode this file has already paid for once.
    expect(declared).toContain("@nextlyhq/blocks-react");
  });

  it("does not depend on @nextlyhq/admin in any form", () => {
    expect(
      declared.filter(
        name =>
          name === "@nextlyhq/admin" || name.startsWith("@nextlyhq/admin/")
      )
    ).toEqual([]);
  });
});

describe("the builder's layering contract", () => {
  const files = sourceFiles(SRC_DIR);

  it("reads its own source, so the assertions below are not vacuous", () => {
    // Positive control. An empty file list would satisfy every `every()` below,
    // and a guard that passes because it found nothing is the failure mode this
    // program has paid for repeatedly.
    expect(files.length).toBeGreaterThan(0);
    expect(files.some(f => f.endsWith("index.ts"))).toBe(true);
  });

  it("asks the runner to collect every extension it treats as a test", () => {
    // The globs and the allowlist agree about the word "test". That is an
    // internal-consistency property and it is worth checking here, but it is
    // NOT what catches a narrowed extension list: this assertion lives in a
    // file the globs decide whether to collect, so dropping `ts` un-collects
    // the check along with everything else and the run reports `1 passed (1)`
    // in green. Measured, not supposed.
    //
    // What survives that is in `vitest.global-setup.ts`, which runs before any
    // file is collected and compares the globs against the tests on disk.
    expect(TEST_GLOBS).toHaveLength(MODULE_EXTENSIONS.length);
    for (const extension of MODULE_EXTENSIONS) {
      expect(TEST_GLOBS).toContain(`src/**/*.test.${extension}`);
    }
    // And every glob names a file this package would classify as a test, so the
    // runner and the allowlist cannot mean different things by the word.
    for (const glob of TEST_GLOBS) {
      expect(TEST_MODULE.test(glob)).toBe(true);
    }
  });

  it("reads every extension it claims to, not only the common ones", () => {
    // `length > 0` and "an index.ts is present" both survive a walk narrowed to
    // `.ts` alone, so neither separates full coverage from partial. A file in a
    // less common extension has to be named for that.
    //
    // The scan going quiet on one extension is the dangerous direction: the
    // files it stops reading are the ones it then reports clean.
    expect(files.some(f => f.endsWith(".mts"))).toBe(true);
  });

  it("never imports @nextlyhq/admin directly", () => {
    // The one route to admin is `@nextlyhq/plugin-sdk/admin`. Asserted as a
    // prefix so `@nextlyhq/admin/anything` is caught too — a subpath import is
    // the shape this would most plausibly take.
    const offenders = files.filter(file =>
      importsOf(file).some(
        specifier =>
          specifier === "@nextlyhq/admin" ||
          specifier.startsWith("@nextlyhq/admin/")
      )
    );

    expect(offenders).toEqual([]);
  });

  it("imports only what the contract allows", () => {
    const violations: string[] = [];
    for (const file of files) {
      const inTest = TEST_MODULE.test(file);
      for (const specifier of importsOf(file).filter(isBare)) {
        if (!isAllowed(specifier, inTest)) {
          violations.push(`${file}: ${specifier}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("relaxes its allowlist only for files the runner actually runs", () => {
    // The test above trusts `TEST_MODULE` to say which files may import
    // `vitest` and `node:fs`. That trust is only sound while vitest RUNS
    // everything `TEST_MODULE` matches: a config listing narrower globs would
    // leave a file classified as a test, exempt from the allowlist, and never
    // executed — so a shipped module could reach anything it liked by choosing
    // its filename.
    //
    // Both now derive from one list, and this checks the config still asks for
    // it rather than restating it. The assertion is syntactic because the
    // question is syntactic: whether this file derives its globs or spells them
    // out again. Importing the config to compare values is not available —
    // `rootDir` is `src`, and reaching outside it fails `check-types` (TS6059).
    const configPath = join(SRC_DIR, "..", "vitest.config.ts");
    const config = ts.createSourceFile(
      "vitest.config.ts",
      readFileSync(configPath, "utf8"),
      ts.ScriptTarget.ESNext,
      true
    );

    let includeInitialiser: ts.Expression | undefined;
    const visit = (node: ts.Node): void => {
      if (
        ts.isPropertyAssignment(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === "include"
      ) {
        includeInitialiser = node.initializer;
      }
      ts.forEachChild(node, visit);
    };
    visit(config);

    // Positive control: an `include` that stopped being found would make the
    // assertion below vacuous, and this guard exists because a check that
    // passes on nothing is the failure mode the package keeps paying for.
    expect(
      includeInitialiser,
      "vitest.config.ts must set `include`"
    ).toBeDefined();
    expect(
      includeInitialiser && ts.isIdentifier(includeInitialiser)
        ? includeInitialiser.text
        : config.text.slice(
            includeInitialiser!.getStart(config),
            includeInitialiser!.getEnd()
          )
    ).toBe("TEST_GLOBS");
  });
});
