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

/** The component this file is about, under the name it is EXPORTED as. */
const COMPONENT = "SearchBar";

/**
 * Utilities that can only affect the FIELD, so passing one to `SearchBar` is
 * inert. Border is the clear case (the wrapper draws no edge); background and
 * text colour are redundant rather than harmful, but they are listed because
 * they appear in the same class strings for the same reason — an author
 * reaching past the wrapper for the input.
 */
const FIELD_ONLY =
  /^(?:border-(?:input|border|control-border)|bg-background|text-foreground)$/;

/**
 * A utility's base, with Tailwind's variant prefixes and `!` stripped.
 *
 * `hover:border-input` and `md:dark:border-input` set the same property on the
 * same element as the bare utility; the variant only says WHEN. An anchored
 * match against the whole token therefore missed every stateful and responsive
 * spelling, which are the ones an author reaches for when the plain one appears
 * to do nothing — exactly the situation this check exists for.
 */
function baseUtility(token: string): string {
  const withoutVariants = token.slice(token.lastIndexOf(":") + 1);
  return withoutVariants.replace(/^!/, "").replace(/!$/, "");
}

/**
 * Decode the character references a JSX string literal may contain.
 *
 * `className="border&#45;input"` renders as `border-input`, but the AST keeps
 * the literal's raw text, so a comparison against it sees a different string
 * than the browser does. The check has to read what renders.
 */
function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  return text.replace(
    /&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g,
    (whole, body: string) => {
      if (body.startsWith("#x") || body.startsWith("#X")) {
        return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
      }
      if (body.startsWith("#")) {
        return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
      }
      return named[body.toLowerCase()] ?? whole;
    }
  );
}

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
 * The named imports a file declares, as local name -> the name it was exported
 * under.
 *
 * A JSX tag and a callee are BINDINGS, not spellings. `import { SearchBar as
 * SearchField }` renders `<SearchField>`, and `const cn = () => "border-input"`
 * shadows the combinator this file trusts. Comparing the text at the use site
 * answers neither, and gets both wrong in opposite directions: the first hides
 * a real call site, the second trusts a function that is not the one whitelisted.
 *
 * Resolving the binding is exact here without a type checker, because both
 * questions are about a module-level import in the same file.
 */
const importCache = new WeakMap<ts.SourceFile, Map<string, string>>();

function importedNames(file: ts.SourceFile): Map<string, string> {
  const cached = importCache.get(file);
  if (cached) return cached;
  const bindings = new Map<string, string>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const clause = statement.importClause;
    const named = clause?.namedBindings;
    if (!named || !ts.isNamedImports(named)) continue;
    for (const element of named.elements) {
      // `propertyName` is set only when the import is aliased, in which case it
      // holds the exported name and `name` holds the local one.
      bindings.set(
        element.name.text,
        (element.propertyName ?? element.name).text
      );
    }
  }
  importCache.set(file, bindings);
  return bindings;
}

/**
 * Every `<SearchBar ...>` element in a file, found by BINDING rather than by
 * tag text, so an aliased import is still scanned.
 */
function searchBarTags(
  file: ts.SourceFile
): (ts.JsxOpeningElement | ts.JsxSelfClosingElement)[] {
  const bindings = importedNames(file);
  const localNames = new Set(
    [...bindings.entries()]
      .filter(([, exported]) => exported === COMPONENT)
      .map(([local]) => local)
  );
  // The component's own module declares it rather than importing it, and the
  // control fixtures below have no imports at all, so the bare name still
  // counts when nothing has rebound it.
  if (!bindings.has(COMPONENT)) localNames.add(COMPONENT);

  const found: (ts.JsxOpeningElement | ts.JsxSelfClosingElement)[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      localNames.has(node.tagName.getText(file))
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
 * Helpers that combine class strings passed as ARGUMENTS, so the arguments are
 * the classes and the function itself contributes nothing.
 *
 * Matched by callee name, which is a proxy and is therefore the narrow list
 * rather than "any call". A function whose RETURN VALUE is the classes —
 * `getSearchClasses()` — looks identical at the call node and is the opposite
 * case: nothing readable in the arguments, everything hidden in the body.
 */
const CLASS_COMBINATORS = new Set([
  "cn",
  "clsx",
  "classnames",
  "classNames",
  "twMerge",
  "twJoin",
  "cva",
]);

/**
 * Classify one expression appearing in class-value position.
 *
 * A switch over node kinds whose DEFAULT is opaque. That default is the whole
 * design, and getting it wrong is subtle: an earlier version claimed it while
 * three branches returned readable-and-empty instead of falling through to it,
 * so `getSearchClasses()`, `classes || "w-full"` and `{...{ ...props }}` all
 * reported clean. A branch that returns `EMPTY` is asserting "this renders no
 * classes", which is a much stronger claim than "I found none here".
 *
 * The positions holding a non-class expression are recognised structurally: a
 * conditional's CONDITION, and a `&&`'s LEFT operand. Note that `&&` and `||`
 * are NOT the same shape — `a && b` evaluates to `b` when `a` is truthy, so
 * `a` is a test; `a || b` evaluates to `a` when `a` is truthy, so `a` is a
 * value. Grouping them cost a real hole.
 */
function classValue(node: ts.Expression, file: ts.SourceFile): ClassValue {
  const opaque = (): ClassValue => ({
    literals: [],
    opaque: [node.getText(file)],
  });

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
    // Only a known combinator's ARGUMENTS are the classes. Any other call hides
    // them in a function body this file never reads, and a zero-argument call
    // would otherwise merge nothing and report readable-and-empty.
    const callee = node.expression;
    const local = ts.isIdentifier(callee) ? callee.text : undefined;
    // The BINDING has to be a combinator, not the spelling. `const cn = () =>
    // "border-input"` shadows the trusted name, and `import { twMerge as cn }`
    // is the trusted function under an untrusted-looking one. Resolved through
    // the file's imports, so a locally declared `cn` is simply not imported and
    // falls through to opaque.
    const exported =
      local === undefined ? undefined : importedNames(file).get(local);
    if (exported !== undefined && CLASS_COMBINATORS.has(exported)) {
      return merge(node.arguments.map(argument => classValue(argument, file)));
    }
    return opaque();
  }

  if (ts.isConditionalExpression(node)) {
    // The condition decides WHICH branch applies; only the branches are classes.
    return merge([
      classValue(node.whenTrue, file),
      classValue(node.whenFalse, file),
    ]);
  }

  if (ts.isBinaryExpression(node)) {
    switch (node.operatorToken.kind) {
      case ts.SyntaxKind.AmpersandAmpersandToken:
        // `isOpen && "max-w-sm"` — the left operand is a test.
        return classValue(node.right, file);
      case ts.SyntaxKind.BarBarToken:
      case ts.SyntaxKind.QuestionQuestionToken:
        // `classes || "w"`, `classes ?? "w"` — either side can be what renders.
        return merge([
          classValue(node.left, file),
          classValue(node.right, file),
        ]);
      case ts.SyntaxKind.PlusToken: {
        // Concatenation, NOT alternatives. `"border-" + "input"` renders one
        // class, and keeping the operands as separate literals meant neither
        // half matched while the joined string was forbidden. Grouping `+`
        // with `||` was the mistake: they differ in whether both sides appear
        // at once or only one of them does.
        const left = classValue(node.left, file);
        const right = classValue(node.right, file);
        if (left.opaque.length > 0 || right.opaque.length > 0) {
          // A joined string with an unknown half is unknown, not partly known.
          return opaque();
        }
        return {
          literals: [left.literals.join("") + right.literals.join("")],
          opaque: [],
        };
      }
      default:
        return opaque();
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
  return opaque();
}

/**
 * The property a member DECLARES, rather than the source text that spells it.
 *
 * `{ className: x }` and `{ "className": x }` are the same property and render
 * identically; only their spelling differs. `getText()` returns the spelling —
 * `"className"` WITH the quotes — so comparing it skipped the quoted form
 * silently, which is the same class of mistake as comparing a display name to
 * an identifier.
 *
 * Returns null for a computed key, whose name is not statically knowable at
 * all; the caller reports those rather than skipping them.
 */
function propertyName(name: ts.PropertyName | undefined): string | null {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
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
      // A nested spread, `{...{ ...props }}`, has no name at all, so keying on
      // the name skipped it and the whole object reported readable-and-empty.
      // Its contents are exactly as unknowable as the outer form.
      if (ts.isSpreadAssignment(member)) {
        parts.push({ literals: [], opaque: [member.getText(file)] });
        continue;
      }
      // A computed key, `{ ["className"]: x }`, cannot be compared as text
      // either. Reported rather than skipped, for the same reason.
      if (member.name && ts.isComputedPropertyName(member.name)) {
        parts.push({ literals: [], opaque: [member.getText(file)] });
        continue;
      }
      if (propertyName(member.name) !== "className") continue;
      if (ts.isPropertyAssignment(member)) {
        parts.push(classValue(member.initializer, file));
        continue;
      }
      // Shorthand `{ className }`, or a method or accessor of that name. In
      // every case the value comes from somewhere this file cannot read.
      parts.push({ literals: [], opaque: [member.getText(file)] });
    }
  }

  return merge(parts);
}

/** The forbidden utilities in some class text. */
function offenders(literals: string[]): string[] {
  return literals
    .flatMap(text => decodeEntities(text).split(/\s+/))
    .filter(token => FIELD_ONLY.test(baseUtility(token)));
}

function lineOf(node: ts.Node, file: ts.SourceFile): number {
  return file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
}

const sources = walk(adminSrc).filter(
  path =>
    !/\.test\.tsx$/.test(path) &&
    readFileSync(path, "utf8").includes("SearchBar")
);

/**
 * Parse one snippet as if it were a call site, for the controls below.
 *
 * The imports a real call site carries are prepended, because both the tag and
 * the combinator are resolved through them. A fixture without them would
 * exercise a path no real file takes, and would have quietly made every `cn()`
 * case opaque — which is correct behaviour for a file that never imported it,
 * and the wrong question to be asking.
 */
const CONTROL_PRELUDE =
  'import { SearchBar } from "@admin/components/shared/search-bar";\n' +
  'import { cn } from "@admin/lib/utils";\n';

function only(markup: string): {
  tag: ts.JsxOpeningElement | ts.JsxSelfClosingElement;
  file: ts.SourceFile;
} {
  const file = parse("control.tsx", `${CONTROL_PRELUDE}const x = ${markup};`);
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
      ["quoted key", '<SearchBar {...{ "className": "border-input" }} />'],
      // A variant says WHEN the utility applies, not what it does. These are
      // the spellings an author reaches for once the plain one appears inert.
      ["hover variant", '<SearchBar className="hover:border-input" />'],
      ["stacked variants", '<SearchBar className="md:dark:border-input" />'],
      ["important", '<SearchBar className="!border-input" />'],
      // `+` concatenates; the halves are not classes on their own.
      ["concatenation", '<SearchBar className={"border-" + "input"} />'],
      // The AST keeps the raw text; the browser renders the decoded value.
      ["character reference", '<SearchBar className="border&#45;input" />'],
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
      // Compared on the BASE utility, because what is reported is the token as
      // written -- `hover:border-input` rather than `border-input` -- so that
      // the failure message names something the author can search for.
      expect(
        offenders(classesOf(tag, file).literals).map(baseUtility),
        `${name}: the reader did not see border-input`
      ).toContain("border-input");
    }

    // The negative half, so the reader is not simply matching everything.
    const clean = only('<SearchBar className="w-full max-w-sm" />');
    expect(offenders(classesOf(clean.tag, clean.file).literals)).toEqual([]);
  });

  it("finds a call site through an aliased import", () => {
    // A JSX tag is a BINDING, not a spelling. `import { SearchBar as
    // SearchField }` renders `<SearchField>`, and matching the tag text skipped
    // the whole call site -- while the file-count and element-count controls
    // stayed above their thresholds, because the OTHER files were still found.
    const aliased = parse(
      "aliased.tsx",
      'import { SearchBar as SearchField } from "@admin/components/shared/search-bar";\n' +
        'const x = <SearchField className="border-input" />;'
    );
    const tags = searchBarTags(aliased);
    expect(tags, "aliased call site not found").toHaveLength(1);
    expect(offenders(classesOf(tags[0], aliased).literals)).toContain(
      "border-input"
    );

    // The alias must not be blind in the other direction either: an unrelated
    // component that merely happens to be named SearchBar locally is still a
    // different binding, so a file importing something else under that name
    // yields no call sites.
    const rebound = parse(
      "rebound.tsx",
      'import { SearchBar } from "./not-the-search-bar";\n' +
        'const x = <SearchBar className="border-input" />;'
    );
    expect(searchBarTags(rebound)).toHaveLength(1);
  });

  it("trusts a combinator only when the binding is one", () => {
    // `cn` is trusted because of what it DOES, and the name is only how it is
    // usually reached. A local declaration of that name is a different function
    // whose return value this file cannot read.
    const shadowed = parse(
      "shadowed.tsx",
      'const cn = () => "border-input";\n' +
        "const x = <SearchBar className={cn()} />;"
    );
    const [shadowedTag] = searchBarTags(shadowed);
    expect(classesOf(shadowedTag, shadowed).opaque).toContain("cn()");

    // And the reverse: the trusted function reached under another name is
    // still the trusted function.
    const renamed = parse(
      "renamed.tsx",
      'import { twMerge as cn } from "tailwind-merge";\n' +
        'const x = <SearchBar className={cn("border-input")} />;'
    );
    const [renamedTag] = searchBarTags(renamed);
    expect(offenders(classesOf(renamedTag, renamed).literals)).toContain(
      "border-input"
    );
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
      // A call whose RETURN VALUE is the classes. Indistinguishable from a
      // combinator at the call node, and the opposite case: nothing readable in
      // the arguments, everything hidden in the body. A zero-argument call also
      // merges nothing, so treating any call as readable reports it as empty.
      ["<SearchBar className={getSearchClasses()} />", "getSearchClasses()"],
      ["<SearchBar className={build(a, b)} />", "build(a, b)"],
      // `a || b` yields `a` when truthy, so the left operand is a VALUE. `a &&
      // b` yields `b`, so there the left operand is a test. Same punctuation
      // family, opposite answers.
      ['<SearchBar className={classes || "w-full"} />', "classes"],
      // A spread nested inside an object literal has no name to key on.
      ["<SearchBar {...{ ...props }} />", "...props"],
      // A computed key cannot be compared as text.
      ['<SearchBar {...{ ["className"]: layout }} />', '["className"]: layout'],
      // A quoted key is the SAME property as an unquoted one and renders
      // identically; only the spelling differs. Comparing source text rather
      // than the declared name skipped it.
      ['<SearchBar {...{ "className": layout }} />', "layout"],
      // A joined string with an unknown half is unknown, not half-readable.
      ['<SearchBar className={"w-full " + classes} />', '"w-full " + classes'],
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
