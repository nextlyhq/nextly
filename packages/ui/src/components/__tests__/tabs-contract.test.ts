/**
 * No call site may repaint the tab indicator.
 *
 * `Tabs` is an underline control: the active state is a 2px bottom border on the
 * trigger, and the trigger is square so that border runs flush to its edges. The
 * primitive already applies the border, both state colours, the hover colour and
 * the focus ring — so a call site that restates any of them owns a second copy
 * of one appearance, and the copies drift the moment either changes.
 *
 * Checked rather than declared, and the reason is worth stating: `cn()` merges
 * through tailwind-merge, so a later class legitimately overrides an earlier
 * one. That is what makes the primitive extensible for layout, and it is also
 * what makes the indicator overridable. No type distinguishes a layout class
 * from an indicator class at the call site.
 *
 * The alternative — making the indicator immutable in the primitive, with
 * important markers ordered after `className` — was tried and removed. It stops
 * a call site diverging and it stops a THEME too, which is a different property
 * that looks the same on the day it is written. A check reports disagreement and
 * leaves the value movable; that is the one wanted here.
 *
 * LAYOUT overrides stay allowed on purpose. Nine call sites pass things like
 * `justify-start`, `grid-cols-2`, `h-8`, `overflow-x-auto` and `gap-0`, and they
 * are correct — a tab strip in a dialog is a different shape from one in a
 * sheet. Only the indicator is closed.
 *
 * WHAT THIS CANNOT SEE, stated here because a verdict is read where it is
 * printed and a reader has no other way to learn the scope:
 *
 * - a class arriving through an identifier defined in another module
 *   (`className={imported}`); string literals reachable inside a template or a
 *   conditional ARE read, so only a fully opaque value hides
 * - a class arriving through `{...props}`
 * - Radix `asChild`, where the slotted child's `className` is merged after the
 *   wrapper's and never appears on a `Tabs*` element at all
 *
 * A green run therefore means "no call site was observed repainting the
 * indicator", not "no call site can". The primitive is deliberately left
 * overridable, so completeness was never available; this bounds the shape
 * violations actually take here.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../../../..");
const PACKAGES = resolve(REPO, "packages");

/** The primitive itself declares the contract; it is not a call site. */
const PRIMITIVE = resolve(PACKAGES, "ui/src/components/tabs.tsx");

/** The components whose appearance the primitive owns. */
const OWNED_TAGS = ["TabsList", "TabsTrigger"];

/**
 * What a call site may not put in a `className`.
 *
 * Each pattern is a way of taking the indicator over rather than positioning it.
 * `border-b-*` covers both removing the underline (`border-b-0`) and redrawing
 * it.
 */
const CLASS_RULES: Array<{ pattern: RegExp; why: string }> = [
  {
    pattern: /\bborder-b-[^\s"'`}]+/,
    why: "sets its own bottom border — the underline IS the active state, and the primitive draws it",
  },
  {
    pattern: /\brounded-[^\s"'`}]+/,
    why: "sets a corner — tabs are square so the underline stays flush, pinned by radius-tier-contract",
  },
];

/**
 * Inline declarations the primitive owns, looked for anywhere in a file that
 * renders tabs.
 *
 * Separate from the class rules because a computed underline colour need not sit
 * on the element: the real violation built it in React state several hundred
 * lines away and passed it down.
 */
const OWNED_STYLE_PROPERTIES = [
  "borderBottom",
  "borderBottomColor",
  "borderBottomStyle",
  "borderBottomWidth",
];

/** Every `.tsx` under `packages/`, excluding build output and the primitive. */
function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === ".turbo") {
      continue;
    }
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // `__tests__` is skipped deliberately: a test may construct violating
      // markup on purpose to show a rule fires, and scanning it would report
      // the proof as the problem. No test file renders tabs today, so this
      // bounds a future one rather than an existing exception.
      if (entry !== "__tests__") sourceFiles(full, found);
    } else if (entry.endsWith(".tsx") && full !== PRIMITIVE) {
      found.push(full);
    }
  }
  return found;
}

/**
 * Parse as TSX rather than matching element text with a regular expression.
 *
 * Two failures made this necessary and both were found by review rather than by
 * the suite, which is the argument for a parser over another pattern. A regex
 * bounded by the next `>` truncates at the arrow in
 * `onClick={() => {}} className="border-b-0"`, so the forbidden class sat past
 * the end of the match and a real override read as conforming. And matching from
 * `<TabsTrigger` onwards begins after any comment marker, so a JSX example
 * inside a docblock looked like a live call site. A parser gets both right for
 * the same reason: it is reading the grammar instead of a proxy for it.
 */
function parse(file: string, source: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX
  );
}

/**
 * The local names that refer to an owned component in this file.
 *
 * An import alias (`import { TabsTrigger as Trigger }`) and a re-binding
 * (`const Trigger = TabsTrigger`) both render the same component under a
 * different tag, which a check keyed on the exported name cannot see. Resolved
 * within the file only: a name assigned in another module stays opaque, and the
 * docblock says so.
 */
function ownedTagNames(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set(OWNED_TAGS);
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportSpecifier(node) &&
      node.propertyName &&
      OWNED_TAGS.includes(node.propertyName.text)
    ) {
      names.add(node.name.text);
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isIdentifier(node.initializer) &&
      names.has(node.initializer.text)
    ) {
      names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return names;
}

/**
 * Every string literal reachable inside an attribute value.
 *
 * A template's spans and a conditional's branches are read, so
 * `` className={`h-8 ${x}`} `` and `className={a ? "border-b-0" : ""}` are both
 * covered. A bare identifier contributes nothing, which is the documented hole
 * rather than a silent one.
 */
function literalStrings(node: ts.Node, found: string[] = []): string[] {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    found.push(node.text);
  } else if (ts.isTemplateExpression(node)) {
    found.push(node.head.text);
    for (const span of node.templateSpans) {
      found.push(span.literal.text);
      literalStrings(span.expression, found);
    }
    return found;
  }
  // The braces matter. `ts.forEachChild` stops at the first callback that
  // returns something truthy, so a concise arrow returning the accumulator
  // visits one child and reports the rest as absent.
  ts.forEachChild(node, child => {
    literalStrings(child, found);
  });
  return found;
}

interface Violation {
  file: string;
  line: number;
  why: string;
}

/** Every owned element in a file, with its attributes. */
function ownedElements(
  sourceFile: ts.SourceFile
): Array<ts.JsxOpeningElement | ts.JsxSelfClosingElement> {
  const names = ownedTagNames(sourceFile);
  const found: Array<ts.JsxOpeningElement | ts.JsxSelfClosingElement> = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      ts.isIdentifier(node.tagName) &&
      names.has(node.tagName.text)
    ) {
      found.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function violationsIn(file: string, source: string): Violation[] {
  const sourceFile = parse(file, source);
  const found: Violation[] = [];
  const at = (node: ts.Node): number =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line +
    1;

  for (const element of ownedElements(sourceFile)) {
    for (const attribute of element.attributes.properties) {
      if (!ts.isJsxAttribute(attribute)) continue;
      const name = attribute.name.getText(sourceFile);
      if (name === "style") {
        found.push({
          file,
          line: at(attribute),
          why: "styles the tab inline — use spacing and sizing utilities, which a theme can move",
        });
        continue;
      }
      if (name !== "className" || !attribute.initializer) continue;
      const classes = literalStrings(attribute.initializer).join(" ");
      for (const { pattern, why } of CLASS_RULES) {
        if (pattern.test(classes))
          found.push({ file, line: at(attribute), why });
      }
    }
  }

  // Only meaningful in a file that renders tabs at all — `borderBottomColor` on
  // an unrelated element is not this contract's business.
  if (found.length > 0 || ownedElements(sourceFile).length > 0) {
    const visit = (node: ts.Node): void => {
      if (
        ts.isPropertyAssignment(node) &&
        OWNED_STYLE_PROPERTIES.includes(node.name.getText(sourceFile))
      ) {
        found.push({
          file,
          line: at(node),
          why: "drives the underline from JS instead of the primitive's data-[state=active]",
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return found;
}

function violations(): Violation[] {
  const found: Violation[] = [];
  for (const file of sourceFiles(PACKAGES)) {
    const source = readFileSync(file, "utf8");
    // Cheap reject first: most files never mention tabs at all. Keyed on the
    // imported names rather than on tag text, so an aliased render is not
    // skipped before it is parsed.
    if (!OWNED_TAGS.some(tag => source.includes(tag))) continue;
    found.push(
      ...violationsIn(file.replace(`${REPO}/`, ""), source).map(v => ({
        ...v,
        file: v.file,
      }))
    );
  }
  return found;
}

describe("the tab indicator contract", () => {
  it("still has a contract to enforce", () => {
    // The structural witness. This check exists only because the primitive owns
    // the indicator; if it stops drawing one, the check is not merely unscoped,
    // it is meaningless — so its absence must go red rather than green.
    //
    // Asserted on the underline itself rather than on a named constant: the
    // primitive is free to be reorganised, and a check tied to an identifier
    // would report a rename as a lost contract.
    const primitive = readFileSync(PRIMITIVE, "utf8");
    expect(primitive).toMatch(/\bborder-b-2\b/);
    expect(primitive).toMatch(/data-\[state=active\]:border-b-/);
  });

  it("finds files to check, so a clean result means conforming and not unscanned", () => {
    // The instrument control. Every assertion below is "nothing was found",
    // which a broken path, a wrong extension or an over-eager skip would also
    // produce — and it would read as compliance.
    const scanned = sourceFiles(PACKAGES).filter(file =>
      OWNED_TAGS.some(tag => readFileSync(file, "utf8").includes(tag))
    );
    expect(scanned.length).toBeGreaterThan(5);
  });

  it.each([
    [
      "a forbidden class after an arrow-function prop",
      '<TabsTrigger onClick={() => {}} className="border-b-0">x</TabsTrigger>',
    ],
    [
      "a forbidden class in a self-closing element",
      '<TabsList className="rounded-md" />',
    ],
    [
      "a forbidden class inside a template literal",
      "<TabsTrigger className={`shrink-0 ${x} border-b-4`}>x</TabsTrigger>",
    ],
    [
      "a forbidden class in one branch of a conditional",
      '<TabsTrigger className={on ? "border-b-2 border-primary" : "x"}>x</TabsTrigger>',
    ],
    ["an inline style", "<TabsList style={{ width: 320 }} />"],
    [
      "an underline colour computed in JS",
      "const s = { borderBottomColor: c };\n<TabsList />",
    ],
    [
      "a violation on a locally aliased tag",
      'const Trigger = TabsTrigger;\n<Trigger className="border-b-0" />',
    ],
    [
      "a violation on an import alias",
      'import { TabsTrigger as Trigger } from "x";\n<Trigger className="rounded-md" />',
    ],
  ])("catches %s", (_label, source) => {
    // The positive controls. Each is a shape the previous regex-based scan
    // returned clean on, or a shape no version of it could read. Without these
    // a rule that can never match anything passes the suite while checking
    // nothing.
    expect(violationsIn("probe.tsx", source)).not.toEqual([]);
  });

  it.each([
    [
      "a JSX example inside a docblock",
      '/**\n * <TabsTrigger className="border-b-0" />\n */\nexport const x = 1;',
    ],
    [
      "a JSX example inside a line comment",
      '// <TabsList className="rounded-md" />\nexport const x = 1;',
    ],
    [
      "layout classes a surface legitimately owns",
      '<TabsList className="justify-start gap-0 overflow-x-auto h-8" />',
    ],
    [
      "an unrelated element carrying a corner",
      '<div className="rounded-md" />\n<TabsList />',
    ],
  ])("does not report %s", (_label, source) => {
    // The complement, and the reason this is a contract rather than a ban. A
    // check that flags a documented example or a legitimate layout class gets
    // switched off, and then it enforces nothing at all.
    expect(violationsIn("probe.tsx", source)).toEqual([]);
  });

  it("no call site overrides the tab indicator", () => {
    const found = violations();
    expect(
      found.map(v => `${v.file}:${v.line} — ${v.why}`),
      "these call sites take over the tab indicator instead of letting the " +
        "primitive draw it. Pass layout classes only; if a surface genuinely " +
        "needs a different indicator, change `packages/ui/src/components/tabs.tsx` " +
        "so every surface changes with it."
    ).toEqual([]);
  });
});
