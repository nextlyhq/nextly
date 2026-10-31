/**
 * Every browser spec is written with the suite's `test`, never Playwright's.
 *
 * Under Cache Components, Next.js keeps a visited page mounted but hidden, and
 * a text, label, test-id or placeholder locator matches a hidden copy's
 * elements as readily as the visible page's. The suite's `test` holds every
 * page to its visible elements (`e2e/tests/support/visible.ts`); the main
 * config's specs take it with each file's account added
 * (`e2e/tests/support/test.ts`), the production suite's take it as it is. A
 * spec on Playwright's own `test` runs without any of it, and nothing in the
 * run would say so: its locators simply match more.
 *
 * Read from each spec's import declarations, parsed, not matched as text: a
 * spec takes Playwright's `test` by naming it (under any alias), as the
 * package's default export, or through a namespace import. The specs are every
 * file Playwright's default `testMatch` takes under `e2e/` (`e2e/test-files.mjs`,
 * which each config's own `--list` is held to in the browser suite).
 */
import { readFileSync } from "node:fs";
import { dirname, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  literalText,
  parseSource,
  walk,
} from "@nextlyhq/module-specifiers/parse-source";
import { describe, expect, it } from "vitest";

import { e2eTestFiles } from "../e2e/test-files.mjs";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** The suite's `test` for the main config's specs, with each file's account. */
const SUITE_TEST = "e2e/tests/support/test.ts";
/** The visible-only `test`, for the production suite, which signs in itself. */
const VISIBLE_TEST = "e2e/tests/support/visible.ts";

/**
 * Specs allowed Playwright's own `test`, each with why. Only a spec that
 * drives no page belongs here: the visible-only hold is about a page's
 * locators, so a spec with none loses nothing by going without it. Each is
 * held to that: none of its tests or hooks may take a page, context or
 * browser fixture.
 */
const RAW_TEST_ALLOWED = {
  "e2e/multi-instance/two-instances.spec.ts":
    "drives two app instances over HTTP only, through request contexts; it opens no page",
  "e2e/dev-reload/schema-edit.spec.ts":
    "edits a schema file and reads the dev server's answers over HTTP; it opens no page",
  "e2e/tests/canvas/dwelling-canvas.test.ts":
    "checks the canvas's dwell arithmetic in Node; it opens no page",
  "e2e/tests/canvas/oscillation.test.ts":
    "checks the canvas's oscillation guard in Node; it opens no page",
  "e2e/tests/canvas/settle.test.ts":
    "checks the canvas's settle detection in Node; it opens no page",
  "e2e/tests/canvas/zone-inset.test.ts":
    "checks the canvas's zone inset arithmetic in Node; it opens no page",
  "e2e/tests/flaky-reporter.test.ts":
    "checks the flaky reporter's summary in Node; it opens no page",
  "e2e/tests/locks-held.test.ts":
    "reads the suite's source and Playwright's own list; it opens no page",
};

/** The fixtures that hand a spec a page, so an allowed spec takes none. */
const PAGE_FIXTURES = new Set(["page", "context", "browser"]);

/** Every file Playwright takes as a test under `e2e/`, as repository paths. */
function specs() {
  return e2eTestFiles(REPO_ROOT);
}

/** The `test` a spec must take, by where it lives. */
function expectedTest(file) {
  if (file.startsWith("e2e/tests/production/")) return VISIBLE_TEST;
  if (file.startsWith("e2e/tests/")) return SUITE_TEST;
  return null;
}

/** Where an import's relative specifier points, as a repository path. */
function importedFile(file, specifier) {
  if (!specifier.startsWith(".")) return specifier;
  const target = posix.normalize(posix.join(posix.dirname(file), specifier));
  return target.endsWith(".ts") ? target : `${target}.ts`;
}

/** The name an import specifier takes from its module. */
function importedName(specifier) {
  return specifier.imported.type === "Identifier"
    ? specifier.imported.name
    : specifier.imported.value;
}

/**
 * How one import declaration reaches Playwright's own `test`, or null. A
 * type-only import reaches nothing at run time.
 */
function playwrightTestReached(declaration) {
  if (literalText(declaration.source) !== "@playwright/test") return null;
  if (declaration.importKind === "type") return null;
  for (const specifier of declaration.specifiers) {
    if (specifier.type === "ImportDefaultSpecifier") {
      return 'takes Playwright\'s `test` as the default export of "@playwright/test"';
    }
    if (specifier.type === "ImportNamespaceSpecifier") {
      return 'imports "@playwright/test" whole, which reaches Playwright\'s `test`';
    }
    if (importedName(specifier) === "test" && specifier.importKind !== "type") {
      return 'takes `test` from "@playwright/test"';
    }
  }
  return null;
}

/**
 * Whether one of the imports takes `test`, as a value, from the module
 * `expected`. A type-only import brings no `test` to run tests with.
 */
function takesTestFrom(file, imports, expected) {
  return imports.some(
    declaration =>
      declaration.importKind !== "type" &&
      importedFile(file, literalText(declaration.source) ?? "") === expected &&
      declaration.specifiers.some(
        specifier =>
          specifier.type === "ImportSpecifier" &&
          specifier.importKind !== "type" &&
          importedName(specifier) === "test"
      )
  );
}

/**
 * The local names a spec's `test` is reached by: each value import of a
 * binding named `test` under whatever local name, the default export of
 * "@playwright/test" (which is its `test`), and `test` itself; and the
 * namespaces "@playwright/test" is imported whole as, reached as `pw.test`.
 */
function testBindings(program) {
  const names = new Set(["test"]);
  const namespaces = new Set();
  for (const declaration of program.body) {
    if (declaration.type !== "ImportDeclaration") continue;
    if (declaration.importKind === "type") continue;
    const fromPlaywright =
      literalText(declaration.source) === "@playwright/test";
    for (const specifier of declaration.specifiers) {
      if (specifier.type === "ImportNamespaceSpecifier") {
        if (fromPlaywright) namespaces.add(specifier.local.name);
      } else if (specifier.type === "ImportDefaultSpecifier") {
        if (fromPlaywright) names.add(specifier.local.name);
      } else if (
        specifier.importKind !== "type" &&
        importedName(specifier) === "test"
      ) {
        names.add(specifier.local.name);
      }
    }
  }
  return { names, namespaces };
}

/**
 * Whether a call's callee is the spec's `test`, or a member of it
 * (`test.describe`, `pw.test.beforeEach`), by the bindings it has.
 */
function isTestCall(callee, { names, namespaces }) {
  let node = callee;
  while (node?.type === "MemberExpression") {
    const { object, property } = node;
    if (
      object.type === "Identifier" &&
      namespaces.has(object.name) &&
      property.type === "Identifier" &&
      property.name === "test"
    ) {
      return true;
    }
    node = object;
  }
  return node?.type === "Identifier" && names.has(node.name);
}

/** The fixture names one function's first parameter takes. */
function fixtureNames(fixtures) {
  // Taken whole, or with a rest element, the parameter reaches every fixture.
  if (fixtures.type !== "ObjectPattern") return ["*"];
  return fixtures.properties.map(property => {
    if (property.type === "RestElement") return "*";
    if (property.key.type === "Identifier") return property.key.name;
    return literalText(property.key) ?? "*";
  });
}

/**
 * The fixtures a spec's tests and hooks take: the names destructured from the
 * first parameter of each function passed to the spec's `test`, by any name it
 * is bound to, or one of its members, with `*` for a parameter that reaches
 * every fixture.
 *
 * @param {string} file the spec's repository path
 * @param {string} text its source
 * @returns {Set<string>}
 */
export function fixturesTaken(file, text) {
  const taken = new Set();
  const { program } = parseSource(text, file);
  const bindings = testBindings(program);
  walk(program, node => {
    if (node.type !== "CallExpression" || !isTestCall(node.callee, bindings)) {
      return;
    }
    for (const argument of node.arguments) {
      const isFunction =
        argument.type === "ArrowFunctionExpression" ||
        argument.type === "FunctionExpression";
      const [fixtures] = isFunction ? argument.params : [];
      if (fixtures) for (const name of fixtureNames(fixtures)) taken.add(name);
    }
  });
  return taken;
}

/**
 * What is wrong with how a spec takes its `test`, or null.
 *
 * @param {string} file the spec's repository path
 * @param {string} text its source
 */
export function testSourceProblem(file, text) {
  const imports = parseSource(text, file).program.body.filter(
    node => node.type === "ImportDeclaration"
  );
  for (const declaration of imports) {
    const reached = playwrightTestReached(declaration);
    if (reached) return reached;
  }
  const expected = expectedTest(file);
  if (expected === null) {
    return "is outside e2e/tests, where no suite `test` is defined for it";
  }
  return takesTestFrom(file, imports, expected)
    ? null
    : `does not take \`test\` from ${expected}`;
}

describe("browser specs take the suite's test", () => {
  const files = specs();

  it("finds the specs it judges", () => {
    // Guards the guard: a lister that matched nothing would pass every check
    // below by having read nothing.
    expect(files.length).toBeGreaterThan(100);
    expect(files.some(file => file.startsWith("e2e/tests/production/"))).toBe(
      true
    );
    for (const allowed of Object.keys(RAW_TEST_ALLOWED)) {
      expect(files, allowed).toContain(allowed);
    }
  });

  it("every spec takes its test from the suite, or is allowed not to", () => {
    const offenders = files
      .filter(file => !(file in RAW_TEST_ALLOWED))
      .map(file => [
        file,
        testSourceProblem(file, readFileSync(resolve(REPO_ROOT, file), "utf8")),
      ])
      .filter(([, problem]) => problem !== null)
      .map(([file, problem]) => `${file} ${problem}`);
    expect(
      offenders,
      "Each of these runs without the visible-only hold. Take `test` from " +
        `${SUITE_TEST} (from ${VISIBLE_TEST} under e2e/tests/production), keeping ` +
        '`expect` and the types from "@playwright/test".'
    ).toEqual([]);
  });

  it("allows only specs that still need it, each with a reason", () => {
    for (const [file, reason] of Object.entries(RAW_TEST_ALLOWED)) {
      expect(reason.trim(), `${file} has no reason`).not.toBe("");
      // A stale entry would quietly allow the next spec written there.
      const problem = testSourceProblem(
        file,
        readFileSync(resolve(REPO_ROOT, file), "utf8")
      );
      expect(problem, `${file} no longer needs its entry`).not.toBeNull();
    }
  });

  it("keeps every allowed spec free of a page", () => {
    // The allowance rests on the spec opening no page: one that starts taking
    // a page, context or browser fixture needs the visible-only hold again.
    const withPage = Object.keys(RAW_TEST_ALLOWED).flatMap(file =>
      [...fixturesTaken(file, readFileSync(resolve(REPO_ROOT, file), "utf8"))]
        .filter(name => name === "*" || PAGE_FIXTURES.has(name))
        .map(name => `${file} takes ${name}`)
    );
    expect(withPage).toEqual([]);
  });

  describe("tells a spec on the suite's test from one on Playwright's", () => {
    const MAIN = "e2e/tests/example.spec.ts";
    const PRODUCTION = "e2e/tests/production/example.spec.ts";

    it.each([
      ['import { expect, test } from "@playwright/test";', "takes `test`"],
      ['import { test as it } from "@playwright/test";', "takes `test`"],
      ['import test from "@playwright/test";', "default export"],
      ['import * as pw from "@playwright/test";', "whole"],
      ['import { expect } from "@playwright/test";', "does not take"],
      ['import { test } from "./support/visible";', "does not take"],
      ['import type { test } from "./support/test";', "does not take"],
      ['import { type test } from "./support/test";', "does not take"],
    ])("refuses %s in the main config", (source, problem) => {
      expect(testSourceProblem(MAIN, source)).toContain(problem);
    });

    it("accepts the suite's test, with expect and types from Playwright", () => {
      const source = [
        'import { expect, type Page } from "@playwright/test";',
        'import type { test as Raw } from "@playwright/test";',
        'import { test } from "./support/test";',
      ].join("\n");
      expect(testSourceProblem(MAIN, source)).toBeNull();
    });

    it("holds the production suite to the visible-only test", () => {
      expect(
        testSourceProblem(
          PRODUCTION,
          'import { test } from "../support/visible";'
        )
      ).toBeNull();
      expect(
        testSourceProblem(PRODUCTION, 'import { test } from "../support/test";')
      ).toContain("does not take");
    });

    it("finds the fixtures a spec's tests and hooks take", () => {
      const withPage = [
        'test("reads", async ({ request }) => {});',
        'test.describe("group", () => {',
        "  test.beforeEach(async ({ context }) => {});",
        '  test("draws", async ({ page, request }) => {});',
        "});",
      ].join("\n");
      expect([...fixturesTaken(MAIN, withPage)].sort()).toEqual([
        "context",
        "page",
        "request",
      ]);
      expect([
        ...fixturesTaken(MAIN, 'test("x", async ({ request }) => {});'),
      ]).toEqual(["request"]);
      expect(fixturesTaken(MAIN, 'test("x", async fixtures => {});')).toContain(
        "*"
      );
      // Through whatever name Playwright's `test` is bound to.
      const aliased = [
        'import { test as it } from "@playwright/test";',
        'it("draws", async ({ page }) => {});',
      ].join("\n");
      expect(fixturesTaken(MAIN, aliased)).toContain("page");
      const namespaced = [
        'import * as pw from "@playwright/test";',
        'pw.test.describe("group", () => {',
        '  pw.test("draws", async ({ context }) => {});',
        "});",
      ].join("\n");
      expect(fixturesTaken(MAIN, namespaced)).toContain("context");
      const byDefault = [
        'import playwrightTest from "@playwright/test";',
        "playwrightTest.beforeAll(async ({ browser }) => {});",
      ].join("\n");
      expect(fixturesTaken(MAIN, byDefault)).toContain("browser");
      expect(
        fixturesTaken(MAIN, 'test("x", async ({ ...rest }) => {});')
      ).toContain("*");
    });

    it("refuses a spec outside e2e/tests unless allowed", () => {
      expect(
        testSourceProblem(
          "e2e/elsewhere/x.spec.ts",
          'import { test } from "../tests/support/test";'
        )
      ).toContain("outside e2e/tests");
    });
  });
});
