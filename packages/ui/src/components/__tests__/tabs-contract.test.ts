/**
 * No call site may repaint the tab indicator.
 *
 * `Tabs` is an underline control: the active state is a 2px bottom border on the
 * trigger, and the trigger is square so that border runs flush to its edges. The
 * primitive already applies the border, both state colours, the hover colour,
 * the focus ring and the disabled treatment — so a call site that restates any
 * of them owns a second copy of one appearance, and the copies drift the moment
 * either changes.
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
 * WHETHER A CLASS OVERRIDES IS NOT DECIDED HERE. It is decided by asking
 * tailwind-merge, the resolver that decides it at runtime: a call site's classes
 * are merged onto the primitive's, and anything the primitive declared that does
 * not survive is an override. Enumerating forbidden utilities instead is the
 * thing this replaced, and it failed the same way four times — `border-b-0` was
 * covered while `border-0`, `border-y-0`, `border-[0px]` and a bare `border-b`
 * all removed the underline and read as clean, as did `rounded`. Each was a
 * patch to a list, and the list can never be finished: Tailwind decides what
 * spells an override, and it adds utilities.
 *
 * Importance needs a second pass, because tailwind-merge groups BY importance:
 * `focus-visible:!ring-0` does not displace `focus-visible:ring-2`, both survive
 * the merge, and CSS then resolves in the caller's favour. So the same question
 * is asked again with importance stripped, which is what makes an important
 * override visible.
 *
 * LAYOUT overrides stay allowed on purpose, and fall out of the same mechanism
 * rather than needing an exception: `w-full`, `px-0`, `justify-start`, `gap-0`
 * and a per-state surface tint displace nothing the primitive owns, so they
 * merge cleanly and are not reported.
 *
 * WHAT THIS CANNOT SEE, stated here because a verdict is read where it is
 * printed and a reader has no other way to learn the scope:
 *
 * - a class arriving through an identifier defined in ANOTHER module; literals
 *   reachable inside a template or a conditional in THIS file are read
 * - a class arriving through `{...props}`
 * - Radix `asChild`, where the slotted child's `className` is merged after the
 *   wrapper's and never appears on a `Tabs*` element at all
 * - a local declaration shadowing an imported tag inside a narrower scope
 *
 * A green run therefore means "no call site was observed repainting the
 * indicator", not "no call site can". The primitive is deliberately left
 * overridable, so completeness was never available.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { Tabs, TabsList, TabsTrigger } from "../tabs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../../../..");

/**
 * Every first-party tree, not only `packages`.
 *
 * `apps/playground` declares `@nextlyhq/ui` as a dependency and `templates` is
 * what a scaffolded project starts from, so a tab call site in either is a
 * first-party consumer. Omitting them would mean reporting repository-wide
 * conformance from a subset of the repository.
 */
const SCAN_ROOTS = ["packages", "apps", "templates"].map(r => resolve(REPO, r));

/** The primitive itself declares the contract; it is not a call site. */
const PRIMITIVE = resolve(REPO, "packages/ui/src/components/tabs.tsx");

/**
 * The modules a call site reaches the primitive through.
 *
 * `@nextlyhq/admin` is here because it re-exports these components verbatim
 * (`src/index.ts`, `src/components/ui/index.ts`), so a consumer importing from
 * it renders exactly this primitive.
 */
const OWNING_MODULES = ["@nextlyhq/ui", "@nextlyhq/admin"];

/** The components whose appearance the primitive owns, by exported name. */
const OWNED_EXPORTS = ["TabsList", "TabsTrigger"];

/**
 * The appearance the primitive declares, taken from what it RENDERS.
 *
 * Rendered rather than read out of the source, because the question is what the
 * component applies — a class sitting in a dead constant or a comment is not
 * appearance, and a witness that greps the file cannot tell the two apart.
 */
function renderedClasses(slot: string): string {
  const html = renderToStaticMarkup(
    createElement(
      Tabs,
      { defaultValue: "a" },
      createElement(
        TabsList,
        null,
        createElement(TabsTrigger, { value: "a" }, "A")
      )
    )
  );
  const element = new RegExp(`data-slot="${slot}"[^>]*`).exec(html)?.[0] ?? "";
  return /class="([^"]*)"/.exec(element)?.[1] ?? "";
}

/**
 * Which of a component's own classes a call site may not displace.
 *
 * The primitive's full class list also carries layout — `inline-flex`, `h-10`,
 * `px-4` — which a surface is entitled to change, so the owned set is the
 * appearance half of it. Selected by concern rather than listed, so a change to
 * the primitive's colours or spacing moves this with it.
 */
const APPEARANCE =
  /(?:^|:)(?:-?mb-|border|rounded)|^(?:data-\[state=|hover:|focus-visible:|disabled:)/;

function ownedClassesOf(slot: string): string[] {
  return renderedClasses(slot)
    .split(/\s+/)
    .filter(Boolean)
    .filter(c => APPEARANCE.test(c));
}

const OWNED_BY_SLOT: Record<string, string[]> = {
  TabsList: ownedClassesOf("tabs-list"),
  TabsTrigger: ownedClassesOf("tabs-trigger"),
};

/** The same class list with every important marker removed. */
function withoutImportance(classes: string): string {
  return classes.replace(/!/g, "");
}

interface Utility {
  /** The variants that qualify it: `data-[state=active]`, `hover`, ... */
  variants: string[];
  /** The utility with variants and importance removed: `border-b-0`. */
  bare: string;
  important: boolean;
}

/**
 * Split a class into the parts that decide whether it beats another.
 *
 * Every colon is judged at bracket depth zero, for both the final separator and
 * the variants before it. A bracketed selector can hold colons of its own —
 * `data-[state=active]`, `[&>span:hover]` — and a plain `split(":")` over the
 * prefix cuts the second of those into `[&>span` and `hover]`. Neither fragment
 * is then recognisable as anything, so a rule aimed at a child reads as a rule
 * aimed at the tab.
 */
function splitAtDepthZero(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const character = text[i];
    if (character === "[") depth += 1;
    else if (character === "]") depth -= 1;
    else if (character === ":" && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function utilityOf(cls: string): Utility {
  const important = cls.includes("!");
  const segments = splitAtDepthZero(withoutImportance(cls));
  return {
    important,
    // The last segment is the utility; everything before it qualifies it.
    bare: segments[segments.length - 1] ?? "",
    variants: segments.slice(0, -1).filter(Boolean),
  };
}

/**
 * Whether a caller's utility takes an owned one over.
 *
 * Two questions, and only the first is tailwind-merge's. It answers whether the
 * two touch the same property, which it does correctly for shorthands and
 * arbitrary values — `border-0` displaces `border-b-2`, and no list of forbidden
 * spellings has to be maintained to know that.
 *
 * It cannot answer the second, because it groups by variant AND by importance:
 * `data-[state=active]:border-b-0` and an unconditional `border-b-2` are
 * different keys, both survive, and CSS then decides. So the comparison is made
 * on the BARE utilities, and which one wins is settled the way the browser
 * settles it:
 *
 * - an important caller utility beats an unimportant owned one outright;
 * - otherwise a caller utility wins only if it is at least as qualified —
 *   its variants must include every variant the owned class carries.
 *
 * That second clause is what keeps a plain `opacity-100` legitimate: the
 * primitive's `disabled:opacity-50` is more specific, so the disabled tab still
 * fades, and reporting it would be a false positive. `!opacity-100` is not
 * legitimate, and the first clause catches it.
 */
/**
 * Whether a variant aims the rule at something other than this element.
 *
 * `[&>span]:border-b-0` styles a CHILD of the trigger and `before:border-b-0`
 * styles its generated content, so neither can repaint the trigger's own
 * underline. Counted as qualifiers they make the specificity test vacuously
 * true against an unqualified owned class, and a legitimate call site fails the
 * repository-wide suite.
 *
 * Two forms, and both are about WHERE the rule lands rather than WHEN:
 *
 * - a combinator after the `&` — `[&>span]`, `[&_p]`, Tailwind spelling a
 *   descendant space as `_`. `[&:hover]` and `[&[data-x]]` still qualify THIS
 *   element and must keep counting.
 * - a pseudo-element — `before`, `after`, `placeholder`, `marker` and the rest
 *   generate or address a box that is not the host.
 */
const PSEUDO_ELEMENTS = new Set([
  "before",
  "after",
  "placeholder",
  "marker",
  "selection",
  "file",
  "first-letter",
  "first-line",
  "backdrop",
]);

function retargets(variant: string): boolean {
  if (PSEUDO_ELEMENTS.has(variant)) return true;
  const selector = /^\[(.*)\]$/.exec(variant)?.[1];
  if (selector === undefined) return false;
  return /&\s*[>+~_]/.test(selector) || /&::/.test(selector);
}

/**
 * Spellings of one state that Tailwind emits at equal specificity.
 *
 * Radix sets both the native attribute and its `data-` twin, so
 * `data-[disabled]` and `disabled` select the same tab. Compared as strings they
 * look like different qualifiers, and a caller's `data-[disabled]:opacity-100`
 * then reads as unrelated to the primitive's `disabled:opacity-50` while
 * overriding it in the browser.
 */
const EQUIVALENT_VARIANTS: Record<string, string> = {
  "data-[disabled]": "disabled",
  "data-[state=checked]": "checked",
  "aria-[disabled=true]": "disabled",
};

function normaliseVariant(variant: string): string {
  return EQUIVALENT_VARIANTS[variant] ?? variant;
}

/**
 * Whether a caller's utility takes an owned one over.
 *
 * Two questions, asked in order.
 *
 * **Do they touch the same CSS property?** Answered by mapping each utility to
 * what it sets, which is the same mapping the inline-style side uses. It
 * replaced a tailwind-merge conflict test, and the reason is worth keeping:
 * tailwind-merge groups `border-b-2` and `border-dashed` separately — width and
 * style are different groups — so it reported no conflict while the underline
 * went from solid to dashed. Conflicting in a merge and painting the same
 * property are different questions, and only the second one is this contract's.
 *
 * **Which of them wins?** A CSS question, settled the way a browser settles it:
 * an important caller utility beats an unimportant owned one, and otherwise the
 * caller must be at least as qualified — carrying every variant the owned class
 * carries, after equivalent spellings are normalised.
 *
 * That second clause is what keeps a plain `opacity-100` legitimate: the
 * primitive's `disabled:opacity-50` out-specifies it, so the disabled tab still
 * fades and reporting it would be a false positive.
 */
function wins(owned: Utility, caller: Utility): boolean {
  if (caller.variants.some(retargets)) return false;
  if (caller.important && !owned.important) return true;
  const callerVariants = new Set(caller.variants.map(normaliseVariant));
  return owned.variants
    .map(normaliseVariant)
    .every(variant => callerVariants.has(variant));
}

function takesOver(owned: Utility, caller: Utility): boolean {
  const ownedProperties = new Set(propertiesOf(owned.bare));
  if (ownedProperties.size === 0) return false;
  const callerProperties = propertiesOf(caller.bare);
  if (!callerProperties.some(property => ownedProperties.has(property))) {
    return false;
  }
  return wins(owned, caller);
}

/** Which of a component's owned classes a caller's `className` takes over. */
function displacedBy(exported: string, classes: string): string[] {
  const owned = OWNED_BY_SLOT[exported] ?? [];
  const callers = classes.split(/\s+/).filter(Boolean);
  const passed = new Set(callers);
  return owned.filter(cls => {
    // A byte-identical restatement takes nothing over, so no comparison can see
    // it — and it is still a second copy of one appearance, which is what
    // drifts when the primitive changes and the call site does not.
    if (passed.has(cls)) return true;
    const ownedUtility = utilityOf(cls);
    return callers.some(caller => takesOver(ownedUtility, utilityOf(caller)));
  });
}

/**
 * The CSS properties behind each appearance the primitive declares.
 *
 * An inline style beats every class, so this is the second half of the same
 * contract — and it failed the same way the class side did, as a list of
 * bottom-edge longhands that `border: "none"` walked past. It is DERIVED now:
 * every owned class is mapped to the properties its utility sets, so the inline
 * side covers exactly what the class side protects and moves when the primitive
 * does. Without that, the geometry was covered and the focus ring, the ink and
 * the disabled treatment were not, though the contract claims all five.
 *
 * `UTILITY_PROPERTIES` is the one place a Tailwind utility is related to CSS by
 * hand, and an owned class matching nothing in it fails the suite rather than
 * quietly reducing coverage.
 */
/** The three longhands that draw one edge. */
const EDGE_PROPERTIES = (side: string): string[] => [
  `border-${side}-width`,
  `border-${side}-style`,
  `border-${side}-color`,
];

/**
 * Which edge a `border-*` utility paints.
 *
 * Side-aware because the primitive owns one edge, not four: `border-t-2` must
 * not read as touching the underline. The segment after `border` is a side only
 * when it spells one — `border-dashed` and `border-transparent` name a value
 * and therefore apply to every edge, the bottom included.
 *
 * Which of the three longhands a utility sets is deliberately not decided.
 * Doing so means knowing Tailwind's scales, and the over-approximation is
 * confined to a single edge the primitive owns entirely — it draws the width,
 * the colour, and by omission the style — so widening within that edge cannot
 * report a caller who left the underline alone.
 */
const SIDES: Record<string, string[]> = {
  t: ["top"],
  r: ["right"],
  b: ["bottom"],
  l: ["left"],
  x: ["left", "right"],
  y: ["top", "bottom"],
  s: ["inline-start"],
  e: ["inline-end"],
};

function borderProperties(bare: string): string[] {
  const rest = bare.slice("border".length).replace(/^-/, "");
  const side = SIDES[rest.split("-")[0] ?? ""];
  // No side named: the utility is a value, and a value applies to all edges.
  return (side ?? ["top", "right", "bottom", "left"]).flatMap(EDGE_PROPERTIES);
}

const UTILITY_PROPERTIES: Array<{ utility: RegExp; properties: string[] }> = [
  { utility: /^rounded(-|$)/, properties: ["border-radius"] },
  { utility: /^-?mb-/, properties: ["margin-bottom"] },
  { utility: /^text-/, properties: ["color"] },
  // The ring is drawn through custom properties that `box-shadow` then reads,
  // so an arbitrary assignment to one of them repaints it without ever naming
  // `box-shadow`. Offset first: `ring-offset-2` also matches the ring pattern.
  {
    utility: /^ring-offset(-|$)/,
    properties: [
      "box-shadow",
      "--tw-ring-offset-width",
      "--tw-ring-offset-color",
      "--tw-ring-offset-shadow",
    ],
  },
  {
    utility: /^ring(-|$)/,
    properties: ["box-shadow", "--tw-ring-color", "--tw-ring-shadow"],
  },
  { utility: /^outline(-|$)/, properties: ["outline"] },
  { utility: /^opacity-/, properties: ["opacity"] },
  { utility: /^cursor-/, properties: ["cursor"] },
  { utility: /^pointer-events-/, properties: ["pointer-events"] },
];

function propertiesOf(bare: string): string[] {
  // `border-*` is parsed rather than matched, because the side decides whether
  // it reaches the underline at all.
  if (/^border(-|$)/.test(bare)) return borderProperties(bare);
  const arbitrary = /^\[([a-zA-Z-]+):[^\]]*\]$/.exec(bare)?.[1];
  if (arbitrary) return expandsTo(arbitrary);
  return (
    UTILITY_PROPERTIES.find(entry => entry.utility.test(bare))?.properties ?? []
  );
}

/**
 * The CSS properties each slot's own appearance reaches, kept apart.
 *
 * A union across both slots forbids on one element what only the other draws:
 * the trigger's focus ring uses `box-shadow`, so a union rejected a shadow on
 * the LIST, which is a different DOM element and cannot replace that ring. The
 * class side was already per slot; this is the same question and gets the same
 * answer.
 */
const OWNED_CSS_PROPERTIES: Record<string, Set<string>> = Object.fromEntries(
  Object.entries(OWNED_BY_SLOT).map(([slot, classes]) => [
    slot,
    new Set(classes.flatMap(cls => propertiesOf(utilityOf(cls).bare))),
  ])
);

/**
 * Which CSS longhands an inline style property sets.
 *
 * The side alternation carries the reasoning rather than a list of names: an
 * omitted side means all four and therefore includes the bottom; `y` and the
 * logical `block` forms include it; `top`, `left`, `right` and `x` do not, and
 * stay a caller's to set. Corners all expand to the radius, because the
 * primitive squares all four.
 */
const BOTTOM_EDGE =
  /^border(-(bottom|block-end|block|y))?(-(width|style|color))?$/;
const ANY_CORNER = /^border(-[a-z]+)*-radius$/;
const BOTTOM_OFFSET = /^margin(-(bottom|block-end|block|y))?$/;

function expandsTo(property: string): string[] {
  const kebab = property.replace(/([A-Z])/g, "-$1").toLowerCase();
  if (BOTTOM_EDGE.test(kebab)) {
    return [
      "border-bottom-width",
      "border-bottom-style",
      "border-bottom-color",
    ];
  }
  if (ANY_CORNER.test(kebab)) return ["border-radius"];
  if (BOTTOM_OFFSET.test(kebab)) return ["margin-bottom"];
  // Everything else stands for itself. `box-shadow` and `outline` are the two
  // that matter beyond geometry, and the owned set names both directly.
  return [kebab];
}

function ownsStyleProperty(slot: string, property: string): boolean {
  const owned = OWNED_CSS_PROPERTIES[slot];
  if (!owned) return false;
  return expandsTo(property).some(p => owned.has(p));
}

/**
 * Every `.tsx` under a scan root, excluding build output and the primitive.
 *
 * Entry types come from the directory listing rather than from a `stat`, which
 * resolves symlinks: a link back to an ancestor would recurse forever, and the
 * failure is a hung suite rather than a red one. In a pnpm workspace that is
 * not hypothetical — the store is full of links — so the traversal only follows
 * real directories.
 */
function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const name = entry.name;
    if (name === "node_modules" || name === "dist" || name === ".turbo") {
      continue;
    }
    const full = join(dir, name);
    if (entry.isDirectory()) {
      // `__tests__` is skipped deliberately: a test may construct violating
      // markup on purpose to show a rule fires, and scanning it would report
      // the proof as the problem.
      if (name !== "__tests__") sourceFiles(full, found);
    } else if (entry.isFile() && name.endsWith(".tsx") && full !== PRIMITIVE) {
      found.push(full);
    }
  }
  return found;
}

/**
 * Parse as TSX rather than matching element text with a regular expression.
 *
 * A pattern bounded by the next `>` cannot delimit a JSX element: the `>` in
 * `onClick={() => {}} className="border-b-0"` closes the match, leaving the
 * class outside it. A pattern beginning at `<TabsTrigger` cannot see a comment
 * marker either, since the marker sits before the match starts. Both follow
 * from the delimiters of a JSX element being grammatical, so no character-class
 * approximation of them holds.
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

/** A specifier that reaches this primitive: the owning packages, or `./tabs`. */
function reachesThePrimitive(specifier: string): boolean {
  if (OWNING_MODULES.includes(specifier)) return true;
  // Relative only. `some-other-library/tabs` also ends in `tabs` and is a
  // different component entirely, so a bare suffix test claims files this
  // primitive has nothing to do with.
  return specifier.startsWith(".") && /(^|\/)tabs$/.test(specifier);
}

interface Ownership {
  /** Tags written plainly: `TabsTrigger`, or an alias of it. */
  names: Set<string>;
  /** Namespaces whose qualified tags are owned: `UI` in `<UI.TabsTrigger>`. */
  namespaces: Set<string>;
}

/**
 * Which tags in this file render an owned component, and under what exported
 * name.
 *
 * Resolved from the IMPORT rather than from the spelling. A name is a claim
 * made by whoever wrote the file, and two files can spell the same identifier
 * for different components: one defining its own `TabsList`, or importing that
 * name from another library, would otherwise be held to this contract and fail
 * for a corner it is entitled to.
 */
function ownershipIn(sourceFile: ts.SourceFile): {
  ownership: Ownership;
  exportedNameOf: Map<string, string>;
} {
  const names = new Set<string>();
  const namespaces = new Set<string>();
  const exportedNameOf = new Map<string, string>();

  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      reachesThePrimitive(node.moduleSpecifier.text)
    ) {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const specifier of bindings.elements) {
          // `propertyName` holds the exported name when the import is aliased,
          // and is absent otherwise.
          const exported = (specifier.propertyName ?? specifier.name).text;
          if (OWNED_EXPORTS.includes(exported)) {
            names.add(specifier.name.text);
            exportedNameOf.set(specifier.name.text, exported);
          }
        }
      }
      if (bindings && ts.isNamespaceImport(bindings)) {
        namespaces.add(bindings.name.text);
      }
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isIdentifier(node.initializer) &&
      names.has(node.initializer.text)
    ) {
      names.add(node.name.text);
      const exported = exportedNameOf.get(node.initializer.text);
      if (exported) exportedNameOf.set(node.name.text, exported);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { ownership: { names, namespaces }, exportedNameOf };
}

/** The exported name an element's tag renders, or undefined if not owned. */
function exportedTagOf(
  tag: ts.JsxTagNameExpression,
  ownership: Ownership,
  exportedNameOf: Map<string, string>
): string | undefined {
  if (ts.isIdentifier(tag)) return exportedNameOf.get(tag.text);
  // `<UI.TabsTrigger>` is a property access, not an identifier, so a traversal
  // testing only for identifiers walks straight past a namespace import.
  if (
    ts.isPropertyAccessExpression(tag) &&
    ts.isIdentifier(tag.expression) &&
    ownership.namespaces.has(tag.expression.text) &&
    OWNED_EXPORTS.includes(tag.name.text)
  ) {
    return tag.name.text;
  }
  return undefined;
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

/**
 * The object an element's `style` prop resolves to, if it can be read here.
 *
 * Followed to a variable declared in the same file, because the real violation
 * built its value away from the element. Scanning every property assignment in
 * the file instead would fail a surface for an unrelated
 * `const dividerStyle = { borderBottomColor }` that never reaches a tab.
 */
function styleObjectFor(
  attribute: ts.JsxAttribute,
  sourceFile: ts.SourceFile
): ts.ObjectLiteralExpression | undefined {
  const initializer = attribute.initializer;
  if (!initializer || !ts.isJsxExpression(initializer)) return undefined;
  const expression = initializer.expression;
  if (!expression) return undefined;
  if (ts.isObjectLiteralExpression(expression)) return expression;
  if (!ts.isIdentifier(expression)) return undefined;

  // Resolved by walking OUT from the element, innermost scope first, rather
  // than by searching the file for the name. A whole-file search takes whichever
  // matching declaration is visited last, so an unrelated `const s` in a later
  // function both hides a real violation and, in the other order, invents one.
  // Which declaration a name refers to is a lexical question, and the answer is
  // the nearest enclosing one.
  const declared = (scope: ts.Node): ts.ObjectLiteralExpression | undefined => {
    let found: ts.ObjectLiteralExpression | undefined;
    // Only the scope's OWN statements, so a declaration nested inside a
    // sibling function is not mistaken for one in this scope.
    ts.forEachChild(scope, statement => {
      if (!ts.isVariableStatement(statement)) return;
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === expression.text &&
          declaration.initializer &&
          ts.isObjectLiteralExpression(declaration.initializer)
        ) {
          found = declaration.initializer;
        }
      }
    });
    return found;
  };

  for (
    let scope: ts.Node | undefined = attribute;
    scope;
    scope = scope.parent
  ) {
    if (ts.isBlock(scope) || ts.isSourceFile(scope) || ts.isCaseClause(scope)) {
      const found = declared(scope);
      if (found) return found;
    }
  }
  return undefined;
}

/** An owned inline property declared anywhere inside an object literal. */
function ownedStyleProperty(
  slot: string,
  object: ts.ObjectLiteralExpression
): string | undefined {
  let found: string | undefined;
  const visit = (node: ts.Node): void => {
    // A shorthand entry is a different node kind with the same effect:
    // `{ borderBottomColor }` sets the property just as `{ borderBottomColor: c }`
    // does, and a visitor keyed on `PropertyAssignment` alone walks past it.
    const name = ts.isPropertyAssignment(node)
      ? // `.text` rather than `getText()`: the latter includes the quotes of a
        // `{ "borderBottomColor": c }` key, so a quoted property compares
        // unequal to every name in the list and passes.
        ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)
        ? node.name.text
        : undefined
      : ts.isShorthandPropertyAssignment(node)
        ? node.name.text
        : undefined;
    if (name && ownsStyleProperty(slot, name)) found ??= name;
    ts.forEachChild(node, visit);
  };
  visit(object);
  return found;
}

interface Violation {
  file: string;
  line: number;
  why: string;
}

function violationsIn(file: string, source: string): Violation[] {
  const sourceFile = parse(file, source);
  const { ownership, exportedNameOf } = ownershipIn(sourceFile);
  const found: Violation[] = [];
  const at = (node: ts.Node): number =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line +
    1;

  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const exported = exportedTagOf(node.tagName, ownership, exportedNameOf);
      if (exported) {
        for (const attribute of node.attributes.properties) {
          if (!ts.isJsxAttribute(attribute)) continue;
          const name = attribute.name.getText(sourceFile);
          if (name === "style") {
            const object = styleObjectFor(attribute, sourceFile);
            const property = object && ownedStyleProperty(exported, object);
            if (property) {
              found.push({
                file,
                line: at(attribute),
                why: `sets \`${property}\` inline, which beats every class the primitive applies`,
              });
            }
            continue;
          }
          if (name !== "className" || !attribute.initializer) continue;
          const classes = literalStrings(attribute.initializer).join(" ");
          const displaced = displacedBy(exported, classes);
          if (displaced.length > 0) {
            found.push({
              file,
              line: at(attribute),
              why: `displaces ${displaced.join(", ")} — the primitive owns that appearance, and every surface should change with it`,
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function scanned(): string[] {
  return SCAN_ROOTS.flatMap(root => sourceFiles(root));
}

function violations(): Violation[] {
  const found: Violation[] = [];
  for (const file of scanned()) {
    const source = readFileSync(file, "utf8");
    // Cheap reject: most files never mention tabs at all.
    if (!OWNED_EXPORTS.some(tag => source.includes(tag))) continue;
    found.push(...violationsIn(file.replace(`${REPO}/`, ""), source));
  }
  return found;
}

describe("the tab indicator contract", () => {
  it("still has an indicator to protect", () => {
    // The structural witness. This check exists only because the primitive
    // draws an indicator; if it stops, the check is not merely unscoped, it is
    // meaningless, so its absence must go red rather than green.
    //
    // Read from the RENDERED element rather than from the file's text. A
    // constant left behind by a refactor, or an example in a docblock, keeps a
    // grep of the source satisfied while the trigger renders nothing — and the
    // suite would go on forbidding call sites from supplying an indicator the
    // primitive no longer has.
    const trigger = OWNED_BY_SLOT.TabsTrigger;
    expect(trigger).toContain("border-b-2");
    expect(trigger.some(c => /^data-\[state=active\]:/.test(c))).toBe(true);
    expect(OWNED_BY_SLOT.TabsList).toContain("rounded-none");
  });

  it("maps every owned class to the CSS it sets", () => {
    // The instrument control for the inline half. The style oracle is derived
    // from these mappings, so an owned class matching none of them silently
    // narrows what an inline style is checked against — the geometry stayed
    // covered that way while the focus ring, the ink and the disabled
    // treatment were not, though the contract claims all five.
    const unmapped = Object.values(OWNED_BY_SLOT)
      .flat()
      .filter(cls => propertiesOf(utilityOf(cls).bare).length === 0);
    expect(unmapped).toEqual([]);
    // ...and the derived set is not empty, which an over-eager filter would
    // also produce while every assertion above stayed green.
    for (const [slot, properties] of Object.entries(OWNED_CSS_PROPERTIES)) {
      expect(properties.size, slot).toBeGreaterThan(0);
    }
    // The trigger draws more than the strip does, and a union would hide that
    // the two are kept apart at all.
    expect(OWNED_CSS_PROPERTIES.TabsTrigger.size).toBeGreaterThan(
      OWNED_CSS_PROPERTIES.TabsList.size
    );
  });

  it("finds files to check, so a clean result means conforming and not unscanned", () => {
    // The instrument control. Every assertion below is "nothing was found",
    // which a broken path, a wrong extension or an over-eager skip would also
    // produce, and it would read as compliance.
    const rendering = scanned().filter(file =>
      OWNED_EXPORTS.some(tag => readFileSync(file, "utf8").includes(tag))
    );
    expect(rendering.length).toBeGreaterThan(5);
  });

  /** Every probe imports the way a real call site does, so tags resolve. */
  const IMPORT = `import { TabsList, TabsTrigger } from "@nextlyhq/ui";\n`;

  it.each([
    // The shapes a pattern-based scan returned clean on. Each removes the
    // underline or the corner outright.
    ["a zero border shorthand", '<TabsTrigger className="border-0" />'],
    ["an axis border shorthand", '<TabsTrigger className="border-y-0" />'],
    ["an arbitrary border width", '<TabsTrigger className="border-[0px]" />'],
    ["a bare border-b", '<TabsTrigger className="border-b" />'],
    ["a bare rounded", '<TabsList className="rounded" />'],
    ["an explicit border-b-0", '<TabsTrigger className="border-b-0" />'],
    ["a corner", '<TabsList className="rounded-md" />'],
    // Important variants. tailwind-merge keeps these beside the primitive's
    // unimportant declaration, so they survive the merge and win in CSS.
    [
      "an important focus ring",
      '<TabsTrigger className="focus-visible:!ring-0" />',
    ],
    [
      "an important state ink",
      '<TabsTrigger className="data-[state=active]:!text-destructive" />',
    ],
    // Categories the primitive declares.
    [
      "a state ink override",
      '<TabsTrigger className="data-[state=active]:text-destructive" />',
    ],
    ["a hover override", '<TabsTrigger className="hover:text-foreground" />'],
    ["a disabled override", '<TabsTrigger className="disabled:opacity-100" />'],
    // Shapes the grammar hides from a pattern.
    [
      "a forbidden class after an arrow-function prop",
      '<TabsTrigger onClick={() => {}} className="border-b-0">x</TabsTrigger>',
    ],
    [
      "a forbidden class inside a template literal",
      "<TabsTrigger className={`shrink-0 ${x} border-b-4`} />",
    ],
    [
      "a forbidden class in one branch of a conditional",
      '<TabsTrigger className={on ? "border-b-2 border-primary" : "x"} />',
    ],
    // State-qualified overrides. tailwind-merge keys by variant as well as by
    // property, so these survive beside the primitive's unconditional
    // declaration and then win in CSS for the state they name.
    [
      "a state-qualified zero border",
      '<TabsTrigger className="data-[state=active]:border-b-0" />',
    ],
    [
      "an important state-qualified zero border",
      '<TabsTrigger className="data-[state=active]:!border-b-0" />',
    ],
    [
      "a state-qualified corner",
      '<TabsList className="data-[state=inactive]:rounded-md" />',
    ],
    // Inline styles, including the shorthands that expand onto the bottom edge
    // and the quoted-key spelling.
    [
      "an inline underline colour",
      "<TabsTrigger style={{ borderBottomColor: c }} />",
    ],
    [
      "an inline border shorthand",
      '<TabsTrigger style={{ border: "none" }} />',
    ],
    ["an inline border width", "<TabsTrigger style={{ borderWidth: 0 }} />"],
    ["an inline axis border", '<TabsTrigger style={{ borderY: "0" }} />'],
    [
      "an inline logical bottom border",
      '<TabsTrigger style={{ borderBlockEnd: "none" }} />',
    ],
    ["an inline corner", "<TabsList style={{ borderRadius: 8 }} />"],
    [
      "an inline box-shadow, which erases the focus ring",
      '<TabsTrigger style={{ boxShadow: "none" }} />',
    ],
    [
      "an inline outline, which the primitive removes for focus-visible",
      '<TabsTrigger style={{ outline: "1px solid red" }} />',
    ],
    [
      "an inline opacity, which the disabled state sets",
      "<TabsTrigger style={{ opacity: 1 }} />",
    ],
    [
      "an unqualified important utility beating a variant-qualified owned one",
      '<TabsTrigger className="!opacity-100" />',
    ],
    ["an unqualified important ring", '<TabsTrigger className="!ring-0" />'],
    // Same property, different tailwind-merge group. Width and style are
    // separate groups, so a merge test reported no conflict while the underline
    // went from solid to dashed.
    [
      "a border style on the active state",
      '<TabsTrigger className="data-[state=active]:border-dashed" />',
    ],
    // Radix sets the native attribute and its `data-` twin together, so these
    // select the same tab at equal specificity.
    [
      "a state spelled as its data- equivalent",
      '<TabsTrigger className="data-[disabled]:opacity-100" />',
    ],
    // Arbitrary properties: a declaration wearing a class's clothes.
    // tailwind-merge deliberately does not reconcile these with predefined
    // utilities, so both survive and Tailwind emits the arbitrary rule later.
    [
      "an arbitrary bottom-border width",
      '<TabsTrigger className="[border-bottom-width:0]" />',
    ],
    ["an arbitrary corner", '<TabsList className="[border-radius:8px]" />'],
    [
      "an arbitrary assignment to the ring's own custom property",
      '<TabsTrigger className="focus-visible:![--tw-ring-color:red]" />',
    ],
    [
      "an arbitrary box-shadow qualified the way the ring is",
      '<TabsTrigger className="focus-visible:[box-shadow:none]" />',
    ],
    [
      "a quoted inline underline colour",
      '<TabsTrigger style={{ "borderBottomColor": c }} />',
    ],
    [
      "an inline style built away from the element",
      "const s = { borderBottomColor: c };\n<TabsTrigger style={s} />",
    ],
    [
      "a shorthand inline property",
      "const borderBottomColor = c;\n<TabsTrigger style={{ borderBottomColor }} />",
    ],
    // Bindings.
    [
      "a violation on a locally aliased tag",
      'const Trigger = TabsTrigger;\n<Trigger className="border-b-0" />',
    ],
  ])("catches %s", (_label, body) => {
    // The positive controls. Each is a shape an earlier version returned clean
    // on, or a category it never read. Without these, a check that can never
    // report anything passes the suite while checking nothing.
    expect(violationsIn("probe.tsx", IMPORT + body)).not.toEqual([]);
  });

  it("catches a violation reached through an import alias", () => {
    const source = `import { TabsTrigger as Trigger } from "@nextlyhq/ui";\n<Trigger className="rounded-md" />`;
    expect(violationsIn("probe.tsx", source)).not.toEqual([]);
  });

  it("catches a violation reached through a namespace import", () => {
    const source = `import * as UI from "@nextlyhq/ui";\n<UI.TabsTrigger className="border-b-0" />`;
    expect(violationsIn("probe.tsx", source)).not.toEqual([]);
  });

  it("catches a violation reached through the admin re-export", () => {
    // `@nextlyhq/admin` re-exports these components verbatim, so a consumer
    // importing from it renders exactly this primitive.
    const source = `import { TabsTrigger } from "@nextlyhq/admin";\n<TabsTrigger className="border-b-0" />`;
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
      "sizing and padding on a trigger",
      '<TabsTrigger className="w-full px-0 shrink-0 whitespace-nowrap" />',
    ],
    [
      "a per-state surface tint, which the surface owns",
      '<TabsTrigger className="w-full data-[state=active]:bg-background/50" />',
    ],
    [
      "a hairline offset on the strip, which owns no bottom margin",
      '<TabsList className="-mb-px" />',
    ],
    [
      "an unrelated inline style on a tab",
      "<TabsList style={{ width: 320 }} />",
    ],
    [
      "an inline edge the indicator does not use",
      '<TabsList style={{ borderTop: "1px solid red", marginTop: 4 }} />',
    ],
    [
      "a state-qualified utility that touches nothing owned",
      '<TabsTrigger className="data-[state=active]:shadow-sm" />',
    ],
    [
      "an unqualified plain utility a variant out-specifies",
      '<TabsTrigger className="opacity-100" />',
    ],
    [
      "an arbitrary property the primitive does not set",
      '<TabsTrigger className="[width:20rem]" />',
    ],
    // Aimed elsewhere. A pseudo-element and a descendant are different boxes,
    // so neither can repaint the host's underline however it is qualified.
    [
      "a rule on generated content before the tab",
      '<TabsTrigger className="before:border-b-0" />',
    ],
    [
      "a rule on generated content after the tab",
      '<TabsTrigger className="after:rounded-md" />',
    ],
    [
      "a descendant selector carrying a colon of its own",
      '<TabsTrigger className="[&>span:hover]:border-b-0" />',
    ],
    // Side-aware: the primitive owns one edge, not four.
    [
      "a border on an edge the indicator does not use",
      '<TabsTrigger className="border-t-2 border-t-primary" />',
    ],
    [
      "a rule aimed at a child of the trigger",
      '<TabsTrigger className="[&>span]:border-b-0" />',
    ],
    [
      "a descendant rule written with Tailwind's space",
      '<TabsTrigger className="[&_p]:rounded-md" />',
    ],
    [
      "a shadow on the strip, which draws no ring",
      '<TabsList style={{ boxShadow: "0 1px 2px black" }} />',
    ],
    [
      // The ring is declared under `focus-visible`, so an unqualified rule
      // loses to it on specificity and the ring still draws when focused. The
      // INLINE form of the same declaration does win, and is reported — the
      // two are not interchangeable, and this pins the difference.
      "an unqualified arbitrary box-shadow a variant out-specifies",
      '<TabsTrigger className="[box-shadow:none]" />',
    ],
    [
      "an unrelated element carrying a corner",
      '<div className="rounded-md" />\n<TabsList />',
    ],
  ])("does not report %s", (_label, body) => {
    // The complement, and the reason this is a contract rather than a ban. A
    // check that flags a documented example or a legitimate layout class gets
    // switched off, and then it enforces nothing at all. Several of these are
    // load-bearing: real call sites depend on them.
    expect(violationsIn("probe.tsx", IMPORT + body)).toEqual([]);
  });

  it("resolves a style identifier in its own scope, not by name", () => {
    // A whole-file name search takes whichever declaration is visited last, so
    // an unrelated `const s` in a LATER function hid this violation. Both
    // orders are asserted, because the defect is symmetric: the other order
    // invents a violation on a tab whose own style is harmless.
    const hidden = `${IMPORT}function a() { const s = { borderBottomColor: c }; return <TabsTrigger style={s} />; }
function b() { const s = { width: 2 }; return <div style={s} />; }`;
    expect(violationsIn("probe.tsx", hidden)).not.toEqual([]);

    const invented = `${IMPORT}function a() { const s = { width: 2 }; return <TabsTrigger style={s} />; }
function b() { const s = { borderBottomColor: c }; return <div style={s} />; }`;
    expect(violationsIn("probe.tsx", invented)).toEqual([]);
  });

  it("still reads a style declared beside the element", () => {
    // The complement, and the reason the walk starts at the element rather
    // than at the file: the real violation built its value away from the tag.
    const source = `${IMPORT}const s = { borderBottomColor: c };\n<TabsTrigger style={s} />`;
    expect(violationsIn("probe.tsx", source)).not.toEqual([]);
  });

  it("does not report an unrelated style defined in a file that renders tabs", () => {
    // The value never reaches a tab. Walking every property assignment in the
    // file would fail the whole UI suite over a divider elsewhere on the page.
    const source = `${IMPORT}const dividerStyle = { borderBottomColor: c };\n<div style={dividerStyle} />\n<TabsList />`;
    expect(violationsIn("probe.tsx", source)).toEqual([]);
  });

  it.each([
    [
      "a same-named component from another library",
      'import { TabsList } from "some-other-library";\n<TabsList className="rounded-md border-b-0" />',
    ],
    [
      "a same-named component from a non-relative tabs path",
      'import { TabsList } from "some-other-library/tabs";\n<TabsList className="rounded-md" />',
    ],
    [
      "a locally declared component of the same name",
      'function TabsList() { return null; }\n<TabsList className="rounded-md" />',
    ],
  ])("does not claim %s", (_label, source) => {
    // Ownership follows the import, not the spelling. Holding an unrelated
    // component to this contract would fail the whole UI suite over something
    // this primitive has nothing to do with, and that is how a check gets
    // switched off.
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
