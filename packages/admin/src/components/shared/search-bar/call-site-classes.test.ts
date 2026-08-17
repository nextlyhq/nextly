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

import { inertClassesFor } from "./inert-classes";

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
 * The modules that export THIS `SearchBar`.
 *
 * A name is not an identity. Some other module exporting something called
 * `SearchBar` would otherwise have this component's wrapper rules applied to
 * it, and would fail on classes that are perfectly valid for whatever it is —
 * a check firing on correct code, in a file its author never touched.
 *
 * A short list rather than an open rule, because following re-exports in
 * general means resolving the whole module graph. Each entry is verified
 * against its own source by the test below, so one that stops exporting the
 * component fails rather than quietly widening what counts.
 */
const EXPORTING_MODULES = new Map<string, string>([
  [
    "packages/admin/src/components/shared/search-bar",
    "the component's own module",
  ],
  [
    "packages/admin/src/components/shared",
    "the shared barrel, which re-exports it",
  ],
]);

/**
 * An import specifier as a repository-relative module path, or null when it
 * names something outside this package and so cannot be the component.
 */
function resolveSpecifier(specifier: string, fromFile: string): string | null {
  let absolute: string;
  if (specifier.startsWith("@admin/")) {
    absolute = resolve(adminSrc, specifier.slice("@admin/".length));
  } else if (specifier.startsWith(".")) {
    absolute = resolve(dirname(fromFile), specifier);
  } else {
    return null;
  }
  // A directory and its `index` are the same module, and both spellings occur.
  return relative(repo, absolute).replace(/\/index$/, "");
}

function fromExportingModule(
  statement: ts.ImportDeclaration,
  fromFile: string
): boolean {
  const specifier = statement.moduleSpecifier;
  if (!ts.isStringLiteral(specifier)) return false;
  const resolved = resolveSpecifier(specifier.text, fromFile);
  return resolved !== null && EXPORTING_MODULES.has(resolved);
}

/**
 * The local names bound to `SearchBar` in a file, including through a namespace.
 *
 * A JSX tag is a BINDING, not a spelling: `import { SearchBar as SearchField }`
 * renders `<SearchField>` and `import * as S` renders `<S.SearchBar>`. Matching
 * the tag text found neither, and the count assertions stayed green because the
 * other twenty call sites were still there — a threshold cannot see one missing
 * member of a population.
 *
 * The binding must also come FROM this component's module. Otherwise a file
 * importing an unrelated `SearchBar` has these rules applied to it.
 */
function localTagNames(file: ts.SourceFile, fromFile: string): Set<string> {
  const names = new Set<string>();
  let importsTheName = false;
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const clause = statement.importClause;
    if (!clause) continue;
    const isOurs = fromExportingModule(statement, fromFile);
    // A DEFAULT import has no named bindings, so a loop that reads only those
    // skips it entirely -- and the bare-name fallback below then claims
    // `import SearchBar from "@vendor/search-kit"` as ours. This module has no
    // default export, so such a binding is never ours; it only has to suppress
    // the fallback.
    if (clause.name?.text === COMPONENT) importsTheName = true;
    const bindings = clause.namedBindings;
    if (!bindings) continue;
    if (ts.isNamespaceImport(bindings)) {
      if (isOurs) names.add(`${bindings.name.text}.${COMPONENT}`);
      continue;
    }
    for (const element of bindings.elements) {
      // `propertyName` is set only when the import is aliased, and then holds
      // the EXPORTED name while `name` holds the local one.
      if ((element.propertyName ?? element.name).text === COMPONENT && isOurs) {
        names.add(element.name.text);
      }
      // Tracked whatever the module, so an unrelated import of the same name
      // suppresses the bare-name fallback below instead of being re-admitted
      // by it.
      if (element.name.text === COMPONENT) importsTheName = true;
    }
  }
  // The component's own module declares rather than imports it, and a control
  // fixture may have no imports, so the bare name counts unless something has
  // bound that name to some other export.
  //
  // What this deliberately does NOT cover: a file that binds `SearchBar`
  // locally without importing it — a `const`, a function declaration. Such a
  // name is matched. Excluding it would mean tracking every binding form in
  // the language, which is the surface this file gave up covering; and a local
  // component of that name inside admin is a collision worth a warning anyway.
  if (!importsTheName) names.add(COMPONENT);
  return names;
}

/** Every `<SearchBar ...>` element in a file, found by binding rather than text. */
function searchBarTags(
  file: ts.SourceFile,
  fromFile = file.fileName
): (ts.JsxOpeningElement | ts.JsxSelfClosingElement)[] {
  const names = localTagNames(file, fromFile);
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

    /*
     * MEMBERSHIP before count. A threshold is the same substitution one level
     * up: it passes on any set of the right size, so a scan that lost the
     * surfaces it cares about and gained unrelated ones reads as healthy. It
     * also rots — the number was 10 while lists composed their own toolbars,
     * and it broke when they stopped, which says nothing about whether the scan
     * still works.
     *
     * These two are named because they are the call sites that must exist for
     * this file to mean anything: the shared toolbar, which is now the only
     * place a list renders the field, and the media picker, which renders it
     * with no list at all.
     */
    const scanned = sources.map(path => path.replace(/^.*\/src\//, "src/"));
    expect(scanned).toContain(
      "src/components/ui/table/list-view/ListToolbar.tsx"
    );
    expect(
      scanned.some(p => p.includes("media-library/MediaPickerDialog"))
    ).toBe(true);
    expect(elements.length).toBeGreaterThan(3);
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

    const barrel = parse(
      "barrel.tsx",
      'import { SearchBar } from "@admin/components/shared";\n' +
        'const x = <SearchBar className="w-full" />;'
    );
    expect(searchBarTags(barrel), "barrel import").toHaveLength(1);

    const relativeImport = parse(
      resolve(adminSrc, "components/shared/other/thing.tsx"),
      'import { SearchBar } from "../search-bar";\n' +
        'const x = <SearchBar className="w-full" />;'
    );
    expect(searchBarTags(relativeImport), "relative import").toHaveLength(1);
  });

  it("leaves a different component of the same name alone", () => {
    // A name is not an identity. Applying this component's wrapper rules to
    // somebody else's `SearchBar` would fail on classes that are valid for it,
    // in a file whose author never touched this one -- a check firing on
    // correct code, which is the failure that gets a check deleted.
    const unrelated = parse(
      "unrelated.tsx",
      'import { SearchBar } from "@vendor/search-kit";\n' +
        'const x = <SearchBar className="border-input bg-background" />;'
    );
    expect(searchBarTags(unrelated), "unrelated module").toHaveLength(0);

    const unrelatedNamespace = parse(
      "unrelated-namespace.tsx",
      'import * as Kit from "@vendor/search-kit";\n' +
        'const x = <Kit.SearchBar className="border-input" />;'
    );
    expect(
      searchBarTags(unrelatedNamespace),
      "unrelated namespace"
    ).toHaveLength(0);

    // The foreign import must also suppress the bare-name fallback, or the
    // fallback re-admits exactly what the module check just excluded. Asserted
    // through the same path as the case above rather than separately, because
    // that is the order the two rules run in.
    const shadowedThenUsed = parse(
      "shadowed.tsx",
      'import { SearchBar } from "@vendor/search-kit";\n' +
        'const a = <SearchBar className="border-input" />;\n' +
        'const b = <SearchBar className="bg-background" />;'
    );
    expect(
      searchBarTags(shadowedThenUsed),
      "every use of a foreign binding"
    ).toHaveLength(0);

    // A DEFAULT import has no named bindings at all, so a reader inspecting
    // only those skips the statement and the bare-name fallback claims the tag.
    // This module exports no default, so such a binding is never ours.
    const defaultImport = parse(
      "default.tsx",
      'import SearchBar from "@vendor/search-kit";\n' +
        'const x = <SearchBar className="border-input" />;'
    );
    expect(searchBarTags(defaultImport), "foreign default import").toHaveLength(
      0
    );

    // The same shape naming OUR module must not match either, for the same
    // reason: there is no default export for it to bind.
    const defaultFromUs = parse(
      "default-ours.tsx",
      'import SearchBar from "@admin/components/shared/search-bar";\n' +
        'const x = <SearchBar className="border-input" />;'
    );
    expect(
      searchBarTags(defaultFromUs),
      "default import of our module"
    ).toHaveLength(0);
  });

  it("keeps the exporting-module list honest", () => {
    // An entry that no longer exports the component would go on widening what
    // these rules apply to, silently. Checked against each module's own source.
    for (const [module, reason] of EXPORTING_MODULES) {
      const candidates = [
        resolve(repo, `${module}.tsx`),
        resolve(repo, `${module}.ts`),
        resolve(repo, module, "index.tsx"),
        resolve(repo, module, "index.ts"),
      ];
      const found = candidates.find(path => {
        try {
          return statSync(path).isFile();
        } catch {
          return false;
        }
      });
      expect(
        found,
        `${module} does not resolve to a module file`
      ).toBeDefined();
      expect(
        readFileSync(found ?? "", "utf8").includes(COMPONENT),
        `${module} no longer mentions ${COMPONENT} (${reason})`
      ).toBe(true);
    }
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
        // Judged on the merged string, exactly as the component judges it, so
        // the two halves cannot disagree about a class `cn` discarded.
        const dead = inertClassesFor(className);
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
