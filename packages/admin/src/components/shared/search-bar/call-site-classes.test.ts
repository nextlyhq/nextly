/**
 * No call site passes `SearchBar` a class that only its input could use.
 *
 * Why such a class is dead, and which ones they are, is in `inert-classes.ts`.
 * This file is one of TWO things that ask that module the same question. The
 * other is the component, which warns at runtime. They are split by what each
 * can see:
 *
 * - **The component** has the FINAL class string, so no spelling can hide from
 *   it — an aliased import, a template, a concatenation, a character reference,
 *   a helper's return value. It is complete, and it only fires on a screen
 *   somebody opens.
 * - **This test** sees every call site whether or not anything renders it, and
 *   can only read what is written literally in the source.
 *
 * That division is the point. An earlier version of this file tried to be
 * complete on its own by predicting the rendered string from the AST, and took
 * thirteen review rounds finding valid spellings it read wrongly: aliases,
 * namespace imports, `{...{ className }}`, computed and quoted keys, `||`
 * mistaken for `&&`, `+` concatenation, template interpolation, character
 * references, variant prefixes, a shadowed `cn`. Every fix was correct and
 * every one was followed by another, because the surface it was covering is the
 * whole language.
 *
 * The runtime warning removes that surface rather than patching it: it does not
 * predict the string, it has it. So this side stops guessing. A `className`
 * that is not a plain string literal is NOT analysed here, and is not reported
 * as a problem either — it is the other half's job. That is stated so the
 * silence is a documented division of labour rather than a gap.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { inertClassesIn } from "./inert-classes";

const here = dirname(fileURLToPath(import.meta.url));
const adminSrc = resolve(here, "../../..");
const repo = resolve(adminSrc, "../../..");

/** The component this file is about, under the name it is EXPORTED as. */
const COMPONENT = "SearchBar";

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, found);
    else if (extname(full) === ".tsx") found.push(full);
  }
  return found;
}

function parse(path: string, source: string): ts.SourceFile {
  return ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX
  );
}

/**
 * The local names bound to `SearchBar` in a file, including through a namespace.
 *
 * A JSX tag is a BINDING, not a spelling: `import { SearchBar as SearchField }`
 * renders `<SearchField>` and `import * as S` renders `<S.SearchBar>`. Matching
 * the tag text found neither, and the count assertions stayed green because the
 * other twenty call sites were still there — a threshold cannot see one missing
 * member of a population.
 */
function localTagNames(file: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  let rebound = false;
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings) continue;
    if (ts.isNamespaceImport(bindings)) {
      names.add(`${bindings.name.text}.${COMPONENT}`);
      continue;
    }
    for (const element of bindings.elements) {
      // `propertyName` is set only when the import is aliased, and then holds
      // the EXPORTED name while `name` holds the local one.
      if ((element.propertyName ?? element.name).text === COMPONENT) {
        names.add(element.name.text);
      }
      if (element.name.text === COMPONENT) rebound = true;
    }
  }
  // The component's own module declares rather than imports it, and a control
  // fixture may have no imports, so the bare name counts unless something has
  // bound that name to a different export.
  if (!rebound) names.add(COMPONENT);
  return names;
}

/** Every `<SearchBar ...>` element in a file, found by binding rather than text. */
function searchBarTags(
  file: ts.SourceFile
): (ts.JsxOpeningElement | ts.JsxSelfClosingElement)[] {
  const names = localTagNames(file);
  const found: (ts.JsxOpeningElement | ts.JsxSelfClosingElement)[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      names.has(node.tagName.getText(file))
    ) {
      found.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/**
 * The tag's `className`, when it is a plain string literal.
 *
 * Null for every other form, including a spread. Predicting the value of an
 * expression is exactly what the runtime warning does without predicting
 * anything, so it is not attempted here.
 */
function literalClassName(
  tag: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  file: ts.SourceFile
): string | null {
  for (const property of tag.attributes.properties) {
    if (!ts.isJsxAttribute(property)) continue;
    if (property.name.getText(file) !== "className") continue;
    const initializer = property.initializer;
    if (!initializer) return null;
    if (ts.isStringLiteral(initializer)) return initializer.text;
    if (
      ts.isJsxExpression(initializer) &&
      initializer.expression &&
      ts.isStringLiteral(initializer.expression)
    ) {
      return initializer.expression.text;
    }
    return null;
  }
  return null;
}

function lineOf(node: ts.Node, file: ts.SourceFile): number {
  return file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
}

const sources = walk(adminSrc).filter(
  path =>
    !/\.test\.tsx$/.test(path) && readFileSync(path, "utf8").includes(COMPONENT)
);

describe("SearchBar call sites", () => {
  it("finds the call sites at all", () => {
    // The enforcement assertion is vacuously true over an empty scan, so a
    // renamed directory or a changed element spelling has to fail here first
    // rather than reporting a clean run.
    const elements = sources.flatMap(path =>
      searchBarTags(parse(path, readFileSync(path, "utf8")))
    );
    expect(sources.length).toBeGreaterThan(10);
    expect(elements.length).toBeGreaterThan(10);
  });

  it("finds a call site however the component is bound", () => {
    // A count threshold cannot see ONE call site going missing, so each binding
    // form is exercised directly. The first two were live defects: the matcher
    // compared tag text, so an alias and a namespace access were invisible.
    const aliased = parse(
      "aliased.tsx",
      'import { SearchBar as SearchField } from "@admin/components/shared/search-bar";\n' +
        'const x = <SearchField className="border-input" />;'
    );
    expect(searchBarTags(aliased), "aliased import").toHaveLength(1);

    const namespaced = parse(
      "namespaced.tsx",
      'import * as Search from "@admin/components/shared/search-bar";\n' +
        'const x = <Search.SearchBar className="border-input" />;'
    );
    expect(searchBarTags(namespaced), "namespace import").toHaveLength(1);

    const plain = parse(
      "plain.tsx",
      'import { SearchBar } from "@admin/components/shared/search-bar";\n' +
        'const x = <SearchBar className="w-full" />;'
    );
    expect(searchBarTags(plain), "plain import").toHaveLength(1);
  });

  it("reads a literal className, and declines to guess at anything else", () => {
    // The enforcement assertion can only ever report ZERO, and a reader that
    // reads nothing reports zero too. So the reader is exercised on a known
    // offender in both literal spellings.
    const attribute = parse(
      "a.tsx",
      'const x = <SearchBar className="w-full border-input" />;'
    );
    const [attributeTag] = searchBarTags(attribute);
    expect(literalClassName(attributeTag, attribute)).toBe(
      "w-full border-input"
    );

    const braced = parse(
      "b.tsx",
      'const x = <SearchBar className={"border-input"} />;'
    );
    const [bracedTag] = searchBarTags(braced);
    expect(literalClassName(bracedTag, braced)).toBe("border-input");

    // Computed forms return null rather than a guess. This is the boundary
    // between the two halves, so it is asserted rather than assumed.
    for (const markup of [
      "const x = <SearchBar className={cn(a, b)} />;",
      "const x = <SearchBar className={classes} />;",
      "const x = <SearchBar className={`w-full ${x}`} />;",
      "const x = <SearchBar {...{ className: layout }} />;",
    ]) {
      const file = parse("c.tsx", markup);
      const [tag] = searchBarTags(file);
      expect(literalClassName(tag, file), markup).toBeNull();
    }
  });

  it("passes no literal class that only the field could use", () => {
    const inert: string[] = [];
    for (const path of sources) {
      const file = parse(path, readFileSync(path, "utf8"));
      for (const tag of searchBarTags(file)) {
        const className = literalClassName(tag, file);
        if (className === null) continue;
        const dead = inertClassesIn(className);
        if (dead.length === 0) continue;
        inert.push(
          `${relative(repo, path)}:${lineOf(tag, file)} — ${dead.join(" ")}`
        );
      }
    }

    expect(
      inert.sort(),
      `These classes are passed to SearchBar but reach its wrapper, not its ` +
        `input, so they do nothing. Use className for LAYOUT only (w-full, ` +
        `max-w-sm, flex-1). If the field itself needs to change, change Input ` +
        `or the token it reads:\n${inert.join("\n")}`
    ).toEqual([]);
  });
});
