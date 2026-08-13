/**
 * `SearchBar`'s `className` lands on its WRAPPER, not on the input.
 *
 * That is the right place for it — every call site uses it for layout (`w-full`,
 * `max-w-sm`, `flex-1`) and layout belongs to the element that owns the box.
 * But it means a class aimed at the FIELD does nothing, and does nothing
 * silently: the wrapper has no border-width, so `border-input` sets a colour on
 * an edge that is never drawn.
 *
 * That is not hypothetical. Eighteen call sites carried `border-input`,
 * `border-border`, `bg-background` or `text-foreground`, in three different
 * spellings — which reads as people trying tokens until one worked, and none
 * ever did. The field's appearance comes from `Input`, which `SearchBar` now
 * composes, so there is nothing left for a call site to restyle.
 *
 * A type cannot express this: `className` is a legitimate string prop and the
 * dead values are ordinary utilities. The property is about which utilities
 * make sense on which element, so it is asserted over the source.
 *
 * ## Why this parses rather than scans
 *
 * Earlier versions of this file matched JSX with regular expressions, and each
 * was found to miss a spelling that renders perfectly well: `[^>]*?` truncating
 * at the `>` inside an arrow-function prop; the `className={...}` expression
 * form; a spread of an object literal; a spread of a variable; a template
 * literal's interpolation; a shorthand property; and whitespace around the `=`.
 * Every one was fixed by widening the pattern, and every fix was followed by
 * another spelling.
 *
 * That is the signature of the wrong kind of check rather than of a careless
 * pattern. A scan over syntax has an unbounded surface — the grammar keeps
 * offering forms the author did not anticipate — so it can only ever be
 * patched. This walks the real AST from the TypeScript compiler instead.
 * Whitespace, formatting and exotic-but-valid spellings stop being cases to
 * enumerate, because the parser has already handled them; what remains is a
 * question about NODE KINDS, which is finite.
 *
 * The classification is therefore total and defaults to OPAQUE. An expression
 * form nobody considered is reported rather than assumed harmless, which is the
 * safe direction: a false report costs an author one message telling them to
 * pass a literal, and a false pass ships a dead class with the suite green.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const adminSrc = resolve(here, "../../..");
const repo = resolve(adminSrc, "../../..");

/**
 * Utilities that can only affect the FIELD, so passing one to `SearchBar` is
 * inert. Border is the clear case (the wrapper draws no edge); background and
 * text colour are redundant rather than harmful, but they are listed because
 * they appear in the same class strings for the same reason — an author
 * reaching past the wrapper for the input.
 */
const FIELD_ONLY =
  /^(?:border-(?:input|border|control-border)|bg-background|text-foreground)$/;

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

/** Every `<SearchBar ...>` element in a file, opening tag or self-closing. */
function searchBarTags(
  file: ts.SourceFile
): (ts.JsxOpeningElement | ts.JsxSelfClosingElement)[] {
  const found: (ts.JsxOpeningElement | ts.JsxSelfClosingElement)[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(file) === "SearchBar"
    ) {
      found.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** What a class-valued expression contributes: text we can read, or names we cannot. */
interface ClassValue {
  /** Class text the source determines. */
  literals: string[];
  /** Expressions whose runtime value this file cannot know. */
  opaque: string[];
}

const EMPTY: ClassValue = { literals: [], opaque: [] };

function merge(parts: ClassValue[]): ClassValue {
  return {
    literals: parts.flatMap(part => part.literals),
    opaque: parts.flatMap(part => part.opaque),
  };
}

/**
 * Classify one expression appearing in class-value position.
 *
 * Deliberately a switch over node kinds with an opaque default. The positions
 * that hold a non-class expression are recognised structurally rather than by
 * punctuation: a call's EXPRESSION (`cn` in `cn(...)`) is a callee, and a
 * conditional's CONDITION or a `&&`'s LEFT operand is a test. `??` is not in
 * that group — in `classes ?? "w-full"` the left operand IS a value.
 */
function classValue(node: ts.Expression, file: ts.SourceFile): ClassValue {
  if (ts.isParenthesizedExpression(node)) {
    return classValue(node.expression, file);
  }

  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return { literals: [node.text], opaque: [] };
  }

  if (ts.isTemplateExpression(node)) {
    // The literal chunks are class text; each interpolation is its own question.
    return merge([
      { literals: [node.head.text], opaque: [] },
      ...node.templateSpans.map(span =>
        merge([
          classValue(span.expression, file),
          { literals: [span.literal.text], opaque: [] },
        ])
      ),
    ]);
  }

  if (ts.isCallExpression(node)) {
    // `cn("a", x)` — the callee contributes nothing, every argument is a value.
    return merge(node.arguments.map(argument => classValue(argument, file)));
  }

  if (ts.isConditionalExpression(node)) {
    // The condition decides WHICH branch applies; only the branches are classes.
    return merge([
      classValue(node.whenTrue, file),
      classValue(node.whenFalse, file),
    ]);
  }

  if (ts.isBinaryExpression(node)) {
    const operator = node.operatorToken.kind;
    if (
      operator === ts.SyntaxKind.AmpersandAmpersandToken ||
      operator === ts.SyntaxKind.BarBarToken
    ) {
      // `isOpen && "max-w-sm"` — the left operand is a test.
      return classValue(node.right, file);
    }
    if (
      operator === ts.SyntaxKind.QuestionQuestionToken ||
      operator === ts.SyntaxKind.PlusToken
    ) {
      // `classes ?? "w-full"`, `a + b` — both sides can be what renders.
      return merge([classValue(node.left, file), classValue(node.right, file)]);
    }
  }

  if (
    node.kind === ts.SyntaxKind.NullKeyword ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    (ts.isIdentifier(node) && node.text === "undefined")
  ) {
    return EMPTY;
  }

  // Everything else — an identifier, a property access, anything unforeseen —
  // is a value this file cannot read.
  return { literals: [], opaque: [node.getText(file)] };
}

/** What one `<SearchBar>` tag passes as class text, and what it hides. */
function classesOf(
  tag: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  file: ts.SourceFile
): ClassValue {
  const parts: ClassValue[] = [];

  for (const property of tag.attributes.properties) {
    if (ts.isJsxAttribute(property)) {
      if (property.name.getText(file) !== "className") continue;
      const initializer = property.initializer;
      if (initializer === undefined) continue;
      if (ts.isStringLiteral(initializer)) {
        parts.push({ literals: [initializer.text], opaque: [] });
        continue;
      }
      if (ts.isJsxExpression(initializer) && initializer.expression) {
        parts.push(classValue(initializer.expression, file));
      }
      continue;
    }

    // A spread. An object literal can be read; anything else cannot.
    const spread = property.expression;
    if (!ts.isObjectLiteralExpression(spread)) {
      parts.push({ literals: [], opaque: [spread.getText(file)] });
      continue;
    }
    for (const member of spread.properties) {
      if (member.name?.getText(file) !== "className") continue;
      if (ts.isPropertyAssignment(member)) {
        parts.push(classValue(member.initializer, file));
      } else {
        // Shorthand: `{ className }`. The value is a variable of that name, so
        // there is nothing in the source to read.
        parts.push({ literals: [], opaque: [member.getText(file)] });
      }
    }
  }

  return merge(parts);
}

/** The forbidden utilities in some class text. */
function offenders(literals: string[]): string[] {
  return literals
    .flatMap(text => text.split(/\s+/))
    .filter(token => FIELD_ONLY.test(token));
}

function lineOf(node: ts.Node, file: ts.SourceFile): number {
  return file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
}

const sources = walk(adminSrc).filter(
  path =>
    !/\.test\.tsx$/.test(path) &&
    readFileSync(path, "utf8").includes("SearchBar")
);

/** Parse one snippet as if it were a call site, for the controls below. */
function only(markup: string): {
  tag: ts.JsxOpeningElement | ts.JsxSelfClosingElement;
  file: ts.SourceFile;
} {
  const file = parse("control.tsx", `const x = ${markup};`);
  const [tag] = searchBarTags(file);
  if (!tag) throw new Error(`no SearchBar element parsed from: ${markup}`);
  return { tag, file };
}

describe("SearchBar call sites", () => {
  it("finds the call sites at all", () => {
    // Every assertion below is vacuously true over an empty scan, so a renamed
    // directory or a changed element spelling has to fail here first rather
    // than reporting a clean run.
    const elements = sources.flatMap(path =>
      searchBarTags(parse(path, readFileSync(path, "utf8")))
    );
    expect(sources.length).toBeGreaterThan(10);
    expect(elements.length).toBeGreaterThan(10);
  });

  it("reads a forbidden class in every spelling that renders", () => {
    // The enforcement assertions can only ever report ZERO, and a reader that
    // reads nothing reports zero too. So the reader is exercised on a known
    // offender in each form. Most of these were live defects found one at a
    // time against the earlier regex versions; the last, whitespace around `=`,
    // is what made it clear the design rather than the pattern was wrong.
    const cases = [
      ["literal", '<SearchBar className="w-full border-input" />'],
      ["braced", '<SearchBar className={"border-input"} />'],
      ["cn() call", '<SearchBar className={cn("w-full", "border-input")} />'],
      ["object spread", '<SearchBar {...{ className: "border-input" }} />'],
      ["template", "<SearchBar className={`w-full border-input`} />"],
      [
        "template with a hole",
        "<SearchBar className={`w-full ${x} border-input`} />",
      ],
      ["spaced equals", '<SearchBar className = {"border-input"} />'],
      [
        "newline before value",
        '<SearchBar\n  className=\n  "border-input"\n/>',
      ],
      ["guarded", '<SearchBar className={cond && "border-input"} />'],
      [
        "ternary branch",
        '<SearchBar className={cond ? "a" : "border-input"} />',
      ],
      // An arrow function in an earlier prop contains a `>`, which truncated
      // the very first version of this check.
      [
        "after an arrow prop",
        '<SearchBar onChange={v => set(v)} className="border-input" />',
      ],
    ] as const;

    for (const [name, markup] of cases) {
      const { tag, file } = only(markup);
      expect(
        offenders(classesOf(tag, file).literals),
        `${name}: the reader did not see border-input`
      ).toContain("border-input");
    }

    // The negative half, so the reader is not simply matching everything.
    const clean = only('<SearchBar className="w-full max-w-sm" />');
    expect(offenders(classesOf(clean.tag, clean.file).literals)).toEqual([]);
  });

  it("separates what it can read from what it cannot", () => {
    const readable = [
      '<SearchBar className="w-full" />',
      '<SearchBar className={"w-full"} />',
      '<SearchBar className={cn("w-full", "max-w-sm")} />',
      '<SearchBar className={cn(isOpen && "max-w-sm")} />',
      '<SearchBar className={x ? "a" : "b"} />',
      '<SearchBar {...{ className: "w-full" }} />',
      "<SearchBar className={`w-full max-w-sm`} />",
      '<SearchBar className={`${cn("w-full")}`} />',
      // Not a class value at all, so nothing to report.
      "<SearchBar className={undefined} />",
    ];
    for (const markup of readable) {
      const { tag, file } = only(markup);
      expect(
        classesOf(tag, file).opaque,
        `reported unreadable: ${markup}`
      ).toEqual([]);
    }

    const opaque = [
      ["<SearchBar className={classes} />", "classes"],
      ["<SearchBar className={cn(layout)} />", "layout"],
      ["<SearchBar className={styles.bar} />", "styles.bar"],
      // `a ?? b` uses the identifier as a VALUE, unlike `a ? x : y` where it is
      // the test. One character apart, opposite answers.
      ['<SearchBar className={classes ?? "w"} />', "classes"],
      ["<SearchBar {...props} />", "props"],
      ["<SearchBar {...{ className: layout }} />", "layout"],
      ["<SearchBar {...{ className }} />", "className"],
      ["<SearchBar className={`w-full ${classes}`} />", "classes"],
      ["<SearchBar className = {classes} />", "classes"],
    ] as const;

    for (const [markup, expected] of opaque) {
      const { tag, file } = only(markup);
      expect(classesOf(tag, file).opaque, `not reported: ${markup}`).toContain(
        expected
      );
    }
  });

  it("passes SearchBar nothing the scan cannot read", () => {
    const hidden: string[] = [];
    for (const path of sources) {
      const file = parse(path, readFileSync(path, "utf8"));
      for (const tag of searchBarTags(file)) {
        const { opaque } = classesOf(tag, file);
        if (opaque.length === 0) continue;
        hidden.push(
          `${relative(repo, path)}:${lineOf(tag, file)} — ${opaque.join(" ")}`
        );
      }
    }

    expect(
      hidden.sort(),
      `These pass classes to SearchBar through a variable or a spread, so the ` +
        `check below cannot see whether a field-only class is among them. Pass ` +
        `the classes as literals:\n${hidden.join("\n")}`
    ).toEqual([]);
  });

  it("passes no class that only the field could use", () => {
    const inert: string[] = [];
    for (const path of sources) {
      const file = parse(path, readFileSync(path, "utf8"));
      for (const tag of searchBarTags(file)) {
        const dead = offenders(classesOf(tag, file).literals);
        if (dead.length === 0) continue;
        inert.push(
          `${relative(repo, path)}:${lineOf(tag, file)} — ${dead.join(" ")}`
        );
      }
    }

    expect(
      inert.sort(),
      `These classes are passed to SearchBar but reach its wrapper, not its ` +
        `input, so they do nothing. The field is an Input and takes its ` +
        `appearance from the design system; use className for LAYOUT only ` +
        `(w-full, max-w-sm, flex-1). If the field itself needs to change, ` +
        `change Input or the token it reads:\n${inert.join("\n")}`
    ).toEqual([]);
  });
});
