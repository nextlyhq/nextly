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
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { __unstable__loadDesignSystem } from "tailwindcss";
import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";

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
  /**
   * The class exactly as written, variants included.
   *
   * Kept because the two questions need different halves of it. Which utility
   * BEATS which is decided on the bare form, since importance and variants are
   * compared separately. Which properties it TOUCHES has to be asked of the
   * whole class: the variant is what carries the selector, and compiling
   * `border-b-0` alone cannot show that `[&>span]:border-b-0` lands on a child.
   */
  full: string;
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
    full: cls,
    // The last segment is the utility; everything before it qualifies it.
    bare: segments[segments.length - 1] ?? "",
    variants: segments.slice(0, -1).filter(Boolean),
  };
}

/**
 * Whether a compiled selector aims its declarations at something other than the
 * element carrying the class.
 *
 * Asked of the SELECTOR Tailwind emitted rather than of the variant that was
 * written, because the variant is a spelling and the selector is the thing
 * itself. A list of pseudo-elements and a pattern over bracketed variants
 * stood here and could not see Tailwind's own child variants: `*:border-b-0`
 * compiles to `:is(& > *)` and `**:rounded-md` to `:is(& *)`, so both read as
 * qualifiers on the tab and their declarations were credited to it. The same
 * blindness covered `divide-y-0`, whose bottom border lands inside
 * `:where(& > :not(:last-child))` and belongs to the children.
 *
 * Three ways a rule leaves the host, and nothing else counts:
 *
 * - a combinator after `&` — `& >`, `& +`, `& ~`
 * - whitespace after `&`, which is a descendant — `& p`, `:is(& *)`
 * - a pseudo-element — `&::before`, `&::placeholder`
 *
 * `&:hover`, `&:focus-visible` and `&[data-state=active]` all still qualify the
 * host and must keep counting, which is why the test is for what FOLLOWS the
 * `&` rather than for punctuation anywhere in the selector.
 */
/**
 * The last compound in a selector: the element the declarations land on.
 *
 * Split at TOP-LEVEL combinators only, so a combinator inside `:is(...)`,
 * `:where(...)` or `:not(...)` does not cut the selector it belongs to.
 */
function subjectOf(selector: string): string {
  let depth = 0;
  let start = 0;
  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index] ?? "";
    if (character === "(" || character === "[") depth += 1;
    else if (character === ")" || character === "]") depth -= 1;
    else if (depth === 0 && /[>+~\s]/.test(character)) start = index + 1;
  }
  return selector.slice(start);
}

function retargets(selector: string): boolean {
  const subject = subjectOf(selector.trim());
  // A pseudo-element is a box the host generates, not the host.
  if (subject.includes("::")) return true;
  // A functional pseudo-class matches whatever is inside it, so the subject is
  // one level down. `:is(& > *)` selects the children, not the tab.
  const inner = /^:(?:is|where|not|has)\((.*)\)$/.exec(subject)?.[1];
  if (inner !== undefined) {
    return inner.split(",").every(branch => retargets(branch.trim()));
  }
  // The host is the subject when the last compound is the `&` itself. This is
  // what keeps `[&+&]:border-b-0` reported: `&+&` puts a combinator after an
  // `&`, but the element receiving the declarations is the RIGHT-hand one,
  // which is the tab. Testing for "any combinator after an `&`" read that as
  // aimed elsewhere and let a sibling rule remove the underline unseen.
  return !subject.includes("&");
}

/**
 * Split a CSS block into its own declarations and the rules nested inside it.
 *
 * Tailwind nests: a variant becomes an inner rule whose selector refines `&`,
 * so the declarations that belong to the host and the declarations that belong
 * to a child sit in one string and are told apart only by which block holds
 * them. Reading the string flat is what credited a child's border to the tab.
 */
interface NestedRule {
  selector: string;
  body: string;
}

function partition(block: string): {
  declarations: string;
  rules: NestedRule[];
} {
  const rules: NestedRule[] = [];
  let declarations = "";
  let buffer = "";
  let index = 0;
  while (index < block.length) {
    const character = block[index];
    if (character === "{") {
      const selector = buffer.trim();
      buffer = "";
      let depth = 1;
      const start = index + 1;
      index += 1;
      while (index < block.length && depth > 0) {
        if (block[index] === "{") depth += 1;
        else if (block[index] === "}") depth -= 1;
        index += 1;
      }
      rules.push({ selector, body: block.slice(start, index - 1) });
      continue;
    }
    buffer += character;
    if (character === ";") {
      declarations += buffer;
      buffer = "";
    }
    index += 1;
  }
  return { declarations: `${declarations}${buffer}`, rules };
}

/**
 * The part of a compiled utility that applies to the element wearing the class.
 *
 * Everything a retargeting rule contains is dropped along with it, at any depth,
 * so a declaration inside `:is(& > *)` never reaches the property comparison and
 * a caller styling its children is not reported for styling the tab.
 */
function hostCss(block: string): string {
  const { declarations, rules } = partition(block);
  return (
    rules
      // A selector that never mentions `&` is not a refinement of the host: it is
      // the utility's own class rule at the top, or an at-rule wrapping it. Only
      // selectors that reposition `&` can move the declarations off the element.
      .filter(rule => !rule.selector.includes("&") || !retargets(rule.selector))
      .reduce((text, rule) => text + hostCss(rule.body), declarations)
  );
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
  if (caller.important && !owned.important) return true;
  // The mirror of the clause above, and it has to be stated rather than left to
  // the variant test: an important owned declaration beats an unimportant caller
  // whatever the caller's variants say. tailwind-merge keeps both — it groups by
  // importance — so without this the specificity comparison decides a question
  // CSS has already settled, and a call site that cannot repaint the indicator
  // is reported for trying.
  if (owned.important && !caller.important) return false;
  const callerVariants = new Set(caller.variants.map(normaliseVariant));
  const asQualified = owned.variants
    .map(normaliseVariant)
    .every(variant => callerVariants.has(variant));
  // Carrying every variant the owned class carries is SUFFICIENT, not
  // necessary, which is why the cascade is asked as well rather than instead.
  return asQualified || outranks(owned, caller);
}

/**
 * A selector's specificity, as the three counts the cascade compares.
 *
 * `&` stands for the utility's own class, so it counts as one class. Ids are
 * counted for completeness; Tailwind emits none.
 */
function specificityOf(selector: string): [number, number, number] {
  const ids = selector.match(/#[\w-]+/g)?.length ?? 0;
  const classes =
    (selector.match(/&/g)?.length ?? 0) +
    (selector.match(/\.[\w-]+/g)?.length ?? 0) +
    (selector.match(/\[[^\]]*\]/g)?.length ?? 0) +
    (selector.match(/(?<!:):[\w-]+/g)?.length ?? 0);
  const elements = selector.match(/::[\w-]+/g)?.length ?? 0;
  return [ids, classes, elements];
}

function compare(
  a: [number, number, number],
  b: [number, number, number]
): number {
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** The selector of a compiled utility's host rule, as Tailwind wrote it. */
function hostSelectorOf(cls: string): string {
  const css = compiled(cls);
  if (css == null) return "";
  const nested = (block: string): string[] => {
    const { rules } = partition(block);
    return rules.flatMap(rule =>
      rule.selector.includes("&")
        ? [rule.selector, ...nested(rule.body)]
        : nested(rule.body)
    );
  };
  return nested(css.replace(AT_PROPERTY, "")).join("");
}

/** Every declaration a utility makes on the host, as property to value. */
function declarationsOf(cls: string): Map<string, string> {
  const css = compiled(cls);
  if (css == null) return new Map();
  const body = `;${hostCss(css.replace(AT_PROPERTY, ""))}`;
  const found = new Map<string, string>();
  for (const match of body.matchAll(
    /[{;]\s*(--[a-zA-Z0-9-]+|[a-z-]+)\s*:([^;}]*)/g
  )) {
    found.set((match[1] ?? "").trim(), (match[2] ?? "").trim());
  }
  return found;
}

/**
 * Whether two utilities actually declare anything differently.
 *
 * Tailwind composes several appearances into ONE property whose value is a list
 * of variables — `box-shadow` reads the ring, the inset ring and the plain
 * shadow together — so two utilities can both write `box-shadow` with a
 * byte-identical value and contribute through different variables. `shadow-sm`
 * beside `focus-visible:ring-2` is exactly that: whichever rule the cascade
 * picks, the declaration is the same text and the ring survives inside it.
 *
 * So a cascade win means nothing unless the two disagree about SOMETHING. Asked
 * only of the cascade path; a merge displacement removes the owned class
 * outright and needs no such test.
 */
function disagree(owned: string, caller: string): boolean {
  const ownedDeclarations = declarationsOf(owned);
  const callerDeclarations = declarationsOf(caller);
  for (const [property, value] of callerDeclarations) {
    const existing = ownedDeclarations.get(property);
    if (existing !== undefined && existing !== value) return true;
  }
  return false;
}

/**
 * Whether Tailwind writes the caller's rule after the owned one.
 *
 * Asked of the design system rather than inferred, because the order is
 * Tailwind's own and depends on how it sorts variants and utilities. A class it
 * cannot place answers `null`, and an unplaceable rule is not evidence that the
 * caller wins.
 */
function emittedAfter(owned: string, caller: string): boolean {
  const order = new Map(
    designSystem.getClassOrder([owned, caller]).map(([cls, at]) => [cls, at])
  );
  const ownedAt = order.get(owned);
  const callerAt = order.get(caller);
  if (ownedAt == null || callerAt == null) return false;
  return callerAt > ownedAt;
}

/**
 * Whether a caller's rule beats an owned one through the cascade alone.
 *
 * The variant comparison above answers the common case — a caller qualified the
 * same way, or more — but it is not the only way to win, and reading it as one
 * missed a whole class of override. `aria-[controls]:ring-0` shares no variant
 * with `focus-visible:ring-2`, yet every Radix trigger carries `aria-controls`,
 * both selectors are one class plus one qualifier, and Tailwind emits the aria
 * rule LAST. Equal specificity, later in the sheet: it removes the focus ring.
 *
 * Asked only as an ADDITIONAL way to win. A caller that loses here may still
 * have displaced the owned class in the merge, which is a different mechanism
 * and one the source order cannot see — `border-b-0` is emitted BEFORE
 * `border-b-2` and still wins, because tailwind-merge removes the loser from
 * the class list before the browser ever sees it.
 */
function outranks(owned: Utility, caller: Utility): boolean {
  const ownedSelector = hostSelectorOf(owned.full);
  const callerSelector = hostSelectorOf(caller.full);
  if (!ownedSelector || !callerSelector) return false;
  if (!disagree(owned.full, caller.full)) return false;
  const ranking = compare(
    specificityOf(callerSelector),
    specificityOf(ownedSelector)
  );
  if (ranking !== 0) return ranking > 0;
  return emittedAfter(owned.full, caller.full);
}

function takesOver(owned: Utility, caller: Utility): boolean {
  const ownedProperties = new Set(reachedBy(owned.full));
  if (ownedProperties.size === 0) return false;
  const callerProperties = propertiesOf(caller.full);
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
 * does.
 *
 * WHICH PROPERTIES A UTILITY SETS IS NOT DECIDED HERE. Tailwind compiles the
 * candidate and the declarations it emits are read back, for the same reason
 * tailwind-merge decides the override question: a hand-written table is a second
 * implementation of something Tailwind already owns, and it was wrong three
 * times running. `text-*` was recorded as `color`, so a caller's `text-xs` —
 * font-size and line-height, no ink at all — read as repainting the active tab;
 * `ring-*` named two custom properties and omitted a third, so a caller could
 * move the focus ring inside the trigger unseen. Neither was a gap in the table
 * so much as evidence that the table cannot be finished, because Tailwind
 * decides what a utility means and keeps adding utilities.
 */

/**
 * The compiled design system, loaded once.
 *
 * Built from this package's real stylesheet rather than a bare
 * `@import "tailwindcss"`, because the primitive's appearance is written in
 * theme tokens: against stock Tailwind, `text-primary` and `border-b-primary`
 * compile to nothing at all and every owned colour would silently claim no
 * properties. The resolution guard in the suite turns that into a red run
 * rather than a quiet loss of coverage.
 */
let designSystem: {
  candidatesToCss(list: string[]): (string | null)[];
  getClassOrder(list: string[]): Array<[string, bigint | null]>;
};

async function loadDesignSystem(): Promise<typeof designSystem> {
  const entry = resolve(REPO, "packages/ui/src/styles/index.css");
  return __unstable__loadDesignSystem(readFileSync(entry, "utf8"), {
    base: dirname(entry),
    loadStylesheet: async (id: string, base: string) => {
      const path = id.startsWith(".")
        ? resolve(base, id)
        : createRequire(`${base}/`).resolve(
            id === "tailwindcss" ? "tailwindcss/index.css" : id
          );
      return { base: dirname(path), path, content: readFileSync(path, "utf8") };
    },
  });
}

/**
 * `@property` blocks declare a custom property's type; they paint nothing.
 *
 * Tailwind emits one beside any utility that uses a registered custom property,
 * and its body is `syntax`, `inherits` and `initial-value` — declarations by
 * grammar and appearance by no reading at all. Left in, every utility touching
 * a `--tw-*` variable would collide with every other one through `syntax`.
 */
const AT_PROPERTY = /@property[^{]*\{[^}]*\}/g;

/**
 * The properties a compiled utility SETS.
 *
 * The caller's side of the comparison: what a class actually writes.
 */
function setBy(css: string): string[] {
  // The leading `;` is what makes the FIRST declaration of a block matchable:
  // `hostCss` returns declarations without the brace that used to open them, so
  // a pattern anchored on `{` or `;` would skip whichever came first in each
  // rule — and for a single-declaration utility that is the whole utility.
  const body = `;${hostCss(css.replace(AT_PROPERTY, ""))}`;
  return [...body.matchAll(/[{;]\s*(--[a-zA-Z0-9-]+|[a-z-]+)\s*:/g)].map(
    match => match[1] ?? ""
  );
}

/**
 * The `--tw-*` variables a compiled utility READS.
 *
 * Tailwind builds several appearances out of variables rather than out of the
 * property directly: `ring-2` sets `box-shadow` through `var(--tw-ring-inset,)`,
 * so a caller assigning `--tw-ring-inset` moves the focus ring inside the
 * trigger while never naming `box-shadow`.
 *
 * Only Tailwind's own namespace is read. A theme variable such as
 * `--nx-primary` is read by every utility drawing in that colour, so counting it
 * would make `border-b-primary` collide with `text-primary` for sharing a token
 * rather than a property.
 */
function readBy(css: string): string[] {
  const body = hostCss(css.replace(AT_PROPERTY, ""));
  return [...body.matchAll(/var\(\s*(--tw-[a-zA-Z0-9-]+)/g)].map(
    match => match[1] ?? ""
  );
}

function compiled(bare: string): string | null {
  return designSystem.candidatesToCss([bare])[0] ?? null;
}

/**
 * What a caller's utility writes, shorthands expanded.
 *
 * Routed through the same `expandsTo` the inline-style side uses, so both halves
 * of the contract answer one question with one implementation. That is what
 * keeps `border-dashed` — which Tailwind emits as the `border-style` shorthand —
 * comparable with the primitive's `border-bottom-style`.
 */
function propertiesOf(bare: string): string[] {
  const css = compiled(bare);
  if (css == null) return [];
  return [...new Set(setBy(css).flatMap(expandsTo))];
}

/**
 * What an OWNED utility's appearance depends on: what it writes, plus the
 * variables it reads.
 *
 * The asymmetry against {@link propertiesOf} is the point, and it is what stops
 * the reads over-reporting. Writing a variable another rule reads changes that
 * rule's output; reading the same variable does not. `border-t-2` and
 * `border-b-2` both read `--tw-border-style`, and treating a shared read as a
 * collision reported an edge the indicator does not use — while a caller's
 * `border-dashed`, which writes that variable AND the `border-style` shorthand,
 * is still caught through the properties it sets.
 */
function reachedBy(bare: string): string[] {
  const css = compiled(bare);
  if (css == null) return [];
  return [...new Set([...setBy(css), ...readBy(css)].flatMap(expandsTo))];
}

/**
 * The CSS properties each slot's own appearance reaches, kept apart.
 *
 * A union across both slots forbids on one element what only the other draws:
 * the trigger's focus ring uses `box-shadow`, so a union rejected a shadow on
 * the LIST, which is a different DOM element and cannot replace that ring. The
 * class side was already per slot; this is the same question and gets the same
 * answer.
 *
 * Computed on first use rather than at module load: the properties come from a
 * design system that has to be compiled, and compiling it is asynchronous.
 */
let ownedProperties: Record<string, Set<string>> | undefined;

function ownedCssProperties(): Record<string, Set<string>> {
  ownedProperties ??= Object.fromEntries(
    Object.entries(OWNED_BY_SLOT).map(([slot, classes]) => [
      slot,
      new Set(classes.flatMap(cls => reachedBy(cls))),
    ])
  );
  return ownedProperties;
}

/**
 * Which CSS longhands an inline style property sets.
 *
 * The side alternation carries the reasoning rather than a list of names: an
 * omitted side means all four and therefore includes the bottom; `y` and the
 * logical `block` forms include it; `top`, `left`, `right` and `x` do not, and
 * stay a caller's to set. Corners all expand to the radius, because the
 * primitive squares all four.
 */
/**
 * A border property, split into the edge it names and the aspect it sets.
 *
 * Both parts are optional, and which are present is what decides whether the
 * property is a shorthand: `border` names neither and sets all twelve
 * longhands, `border-color` names an aspect and sets it on four edges,
 * `border-bottom` names an edge and sets three aspects on it, and
 * `border-bottom-color` names both and is already a longhand.
 */
const BORDER_PROPERTY =
  /^border(?:-(bottom|block-end|block|y|top|block-start|left|right|x|inline-start|inline-end))?(?:-(width|style|color))?$/;

/** The edges that include the bottom, plus the absent edge, which means all. */
const REACHES_BOTTOM = new Set([
  undefined,
  "bottom",
  "block-end",
  "block",
  "y",
]);

const BORDER_ASPECTS = ["width", "style", "color"];
const ANY_CORNER = /^border(-[a-z]+)*-radius$/;
const BOTTOM_OFFSET = /^margin(-(bottom|block-end|block|y))?$/;

function expandsTo(property: string): string[] {
  const kebab = property.replace(/([A-Z])/g, "-$1").toLowerCase();
  const border = BORDER_PROPERTY.exec(kebab);
  if (border) {
    const [, edge, aspect] = border;
    // An edge the primitive does not draw is the caller's to set, and naming it
    // explicitly is what keeps `border-t-2` out of the underline's business.
    if (!REACHES_BOTTOM.has(edge)) return [kebab];
    // Only the aspects the property actually sets. Expanding a longhand into
    // all three recorded `border-b-2` — a WIDTH utility — as owning the colour
    // too, and an unqualified `border-b-destructive` then read as displacing a
    // width it never touches.
    const aspects = aspect === undefined ? BORDER_ASPECTS : [aspect];
    return aspects.map(each => `border-bottom-${each}`);
  }
  if (ANY_CORNER.test(kebab)) return ["border-radius"];
  if (BOTTOM_OFFSET.test(kebab)) return ["margin-bottom"];
  // `outline` is a shorthand like `border`, and the primitive suppresses the
  // focus outline through the longhand Tailwind emits (`outline-style`). Without
  // this an inline `outline: "1px solid red"` names a property the owned set
  // never holds, and restoring the outline the primitive removed reads as clean.
  if (kebab === "outline") {
    return ["outline-width", "outline-style", "outline-color"];
  }
  // Everything else stands for itself. `box-shadow` and `outline` are the two
  // that matter beyond geometry, and the owned set names both directly.
  return [kebab];
}

function ownsStyleProperty(slot: string, property: string): boolean {
  const owned = ownedCssProperties()[slot];
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

/**
 * Whether an import specifier reaches THIS primitive.
 *
 * A bare specifier is matched against the packages that re-export it. A relative
 * one is RESOLVED against the importing file and compared with the primitive's
 * path, rather than tested for ending in `tabs`: the repository already holds a
 * second `tabs.tsx` (`plugin-page-builder/src/render/blocks`), and a sibling
 * importing `./tabs` there renders a different component entirely. Matched by
 * spelling, its own legitimate appearance classes failed this contract — a file
 * this primitive has nothing to do with, held to it because the last segment
 * agreed.
 */
function reachesThePrimitive(specifier: string, importer: string): boolean {
  if (OWNING_MODULES.includes(specifier)) return true;
  if (!specifier.startsWith(".")) return false;
  const target = resolve(dirname(resolve(REPO, importer)), specifier);
  // A module specifier carries no extension; the primitive is a `.tsx` file.
  return `${target}.tsx` === PRIMITIVE || target === PRIMITIVE;
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
      reachesThePrimitive(node.moduleSpecifier.text, sourceFile.fileName)
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
 * Every object an element's `style` prop can resolve to here.
 *
 * A LIST rather than one object, because a style prop routinely selects between
 * shapes: `style={active ? { borderBottomColor: c } : undefined}` sets the
 * declaration whenever the condition holds, and a resolver that accepted only a
 * top-level object literal or identifier read neither branch and returned clean.
 * Every branch a conditional can take is a shape the element can render, so each
 * one is checked.
 *
 * An identifier is followed to a variable declared in the same file, because the
 * real violation built its value away from the element. Scanning every property
 * assignment in the file instead would fail a surface for an unrelated
 * `const dividerStyle = { borderBottomColor }` that never reaches a tab.
 */
function styleObjectsFor(
  attribute: ts.JsxAttribute,
  sourceFile: ts.SourceFile
): ts.ObjectLiteralExpression[] {
  const initializer = attribute.initializer;
  if (!initializer || !ts.isJsxExpression(initializer)) return [];
  const root = initializer.expression;
  if (!root) return [];

  // Resolved by walking OUT from the element, innermost scope first, rather
  // than by searching the file for the name. A whole-file search takes whichever
  // matching declaration is visited last, so an unrelated `const s` in a later
  // function both hides a real violation and, in the other order, invents one.
  // Which declaration a name refers to is a lexical question, and the answer is
  // the nearest enclosing one.
  const initializerOf = (name: string): ts.Expression | undefined => {
    const declared = (scope: ts.Node): ts.Expression | undefined => {
      let found: ts.Expression | undefined;
      // Only the scope's OWN statements, so a declaration nested inside a
      // sibling function is not mistaken for one in this scope.
      ts.forEachChild(scope, statement => {
        if (!ts.isVariableStatement(statement)) return;
        for (const declaration of statement.declarationList.declarations) {
          if (
            ts.isIdentifier(declaration.name) &&
            declaration.name.text === name &&
            declaration.initializer
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
      if (
        ts.isBlock(scope) ||
        ts.isSourceFile(scope) ||
        ts.isCaseClause(scope)
      ) {
        const found = declared(scope);
        if (found) return found;
      }
    }
    return undefined;
  };

  const objects: ts.ObjectLiteralExpression[] = [];
  // Bounded so a `const a = b, b = a` cycle cannot loop forever, and so one
  // identifier is not expanded twice through two paths.
  const seen = new Set<ts.Node>();

  const walk = (node: ts.Expression | undefined): void => {
    if (!node || seen.has(node)) return;
    seen.add(node);
    if (ts.isObjectLiteralExpression(node)) {
      objects.push(node);
      // A spread inside the object can carry a declaration of its own.
      for (const property of node.properties) {
        if (ts.isSpreadAssignment(property)) walk(property.expression);
      }
      return;
    }
    if (ts.isParenthesizedExpression(node)) return walk(node.expression);
    // `as CSSProperties` and `satisfies` wrap the value without changing it.
    if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) {
      return walk(node.expression);
    }
    if (ts.isConditionalExpression(node)) {
      walk(node.whenTrue);
      walk(node.whenFalse);
      return;
    }
    // `&&`, `||` and `??` each choose between their operands at runtime, so both
    // sides are shapes the element can render.
    if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
    ) {
      walk(node.left);
      walk(node.right);
      return;
    }
    if (ts.isIdentifier(node)) walk(initializerOf(node.text));
  };

  walk(root);
  return objects;
}

/**
 * The property a key names, when it is written as a constant.
 *
 * `.text` rather than `getText()`: the latter includes the quotes of a
 * `{ "borderBottomColor": c }` key, so a quoted property would compare unequal
 * to every owned name and pass.
 *
 * A computed key is read too when its expression is a literal string.
 * `{ ["borderBottomColor"]: c }` is a different node kind with identical
 * meaning, and a visitor keyed on identifiers and string literals alone walks
 * past it — the same shape as the shorthand entry beside it. A computed key
 * built from a variable is not decidable here and is left alone.
 */
function propertyNameOf(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name)) {
    const key = name.expression;
    if (ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key)) {
      return key.text;
    }
  }
  return undefined;
}

/**
 * Whether an initializer can only ever be absent.
 *
 * Deliberately narrow: it answers "is this written as nothing", not "could this
 * be nullish at runtime". A variable that happens to hold `undefined` is not
 * decidable here and must keep being reported, because the same variable holds a
 * colour on the next render — which is exactly how the violation that motivated
 * the inline half was written.
 */
function isDefinitelyNothing(initializer: ts.Expression): boolean {
  if (ts.isIdentifier(initializer)) return initializer.text === "undefined";
  if (initializer.kind === ts.SyntaxKind.NullKeyword) return true;
  // `void 0` is the other spelling of the same intent.
  return ts.isVoidExpression(initializer);
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
      ? propertyNameOf(node.name)
      : ts.isShorthandPropertyAssignment(node)
        ? node.name.text
        : undefined;
    // A property React cannot emit is not a declaration. `{ borderBottomColor:
    // undefined }` is what a typed style object looks like when it deliberately
    // leaves an owned property alone, and reporting it rejects the very shape a
    // call site should be using to opt out.
    const emitted =
      !ts.isPropertyAssignment(node) || !isDefinitelyNothing(node.initializer);
    if (name && emitted && ownsStyleProperty(slot, name)) found ??= name;
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
            const property = styleObjectsFor(attribute, sourceFile)
              .map(object => ownedStyleProperty(exported, object))
              .find(Boolean);
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
  beforeAll(async () => {
    designSystem = await loadDesignSystem();
  });

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
      .filter(cls => reachedBy(cls).length === 0);
    expect(unmapped).toEqual([]);
    // ...and the derived set is not empty, which an over-eager filter would
    // also produce while every assertion above stayed green.
    const owned = ownedCssProperties();
    for (const [slot, properties] of Object.entries(owned)) {
      expect(properties.size, slot).toBeGreaterThan(0);
    }
    // The trigger draws more than the strip does, and a union would hide that
    // the two are kept apart at all.
    expect(owned.TabsTrigger.size).toBeGreaterThan(owned.TabsList.size);
  });

  it("decides ownership by where a relative import resolves, not by its spelling", () => {
    // The repository holds a second `tabs.tsx`, in
    // `plugin-page-builder/src/render/blocks`. A sibling importing `./tabs`
    // there renders a different component, and matching the specifier's last
    // segment held it to this primitive's contract: its own legitimate
    // appearance classes failed the repository-wide suite.
    const body = '<TabsTrigger className="data-[state=active]:text-primary" />';

    const unrelated = `import { TabsTrigger } from "./tabs";\n${body}`;
    expect(
      violationsIn(
        "packages/plugin-page-builder/src/render/blocks/probe.tsx",
        unrelated
      )
    ).toEqual([]);

    // The positive control, and it is what makes the assertion above mean
    // "resolved elsewhere" rather than "relative imports are ignored now". Same
    // specifier in both, and only the importer's directory differs: from
    // `components/probe/` it resolves onto the primitive, from `components/` it
    // lands on a path that holds no tabs at all.
    const real = `import { TabsTrigger } from "../tabs";\n${body}`;
    expect(
      violationsIn("packages/ui/src/components/probe/probe.tsx", real)
    ).not.toEqual([]);
    expect(violationsIn("packages/ui/src/components/probe.tsx", real)).toEqual(
      []
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
    // Variables the primitive's own appearance is built out of. Tailwind draws
    // the focus ring through `var(--tw-ring-inset,)`, so assigning that variable
    // moves the ring inside the trigger without ever naming `box-shadow`.
    [
      "an arbitrary assignment to a ring variable the primitive reads",
      '<TabsTrigger className="focus-visible:![--tw-ring-inset:inset]" />',
    ],
    // A style prop that picks between shapes still renders the shape it picks.
    [
      "an inline declaration in the true branch of a conditional",
      "<TabsTrigger style={active ? { borderBottomColor: c } : undefined} />",
    ],
    [
      "an inline declaration in the false branch of a conditional",
      "<TabsTrigger style={active ? undefined : { borderBottomColor: c }} />",
    ],
    [
      "an inline declaration behind a logical guard",
      "<TabsTrigger style={active && { borderBottomColor: c }} />",
    ],
    // The controls for the three exclusions above. Each is one property away
    // from a case that must stay clean, so together they pin a boundary rather
    // than a blanket "borders and inline styles are ignored now".
    [
      "an IMPORTANT caller against an important owned colour",
      '<TabsTrigger className="data-[state=active]:!border-b-destructive" />',
    ],
    [
      "a bottom-border WIDTH, which the primitive does draw",
      '<TabsTrigger className="border-b-4" />',
    ],
    [
      "an inline property whose value is a variable rather than nothing",
      "<TabsTrigger style={{ borderBottomColor: c }} />",
    ],
    // The controls for the child variants above: the same utilities aimed at
    // the tab itself are still reported, so the exclusion is about WHERE the
    // declaration lands rather than about which utility was written.
    [
      "the same border utility aimed at the tab rather than its children",
      '<TabsTrigger className="border-b-0" />',
    ],
    [
      "the same corner utility aimed at the tab rather than its descendants",
      '<TabsTrigger className="rounded-md" />',
    ],
    // A computed key is a different node kind with identical meaning.
    [
      "an inline property written as a computed constant key",
      'const c = "red";\n<TabsTrigger style={{ ["borderBottomColor"]: c }} />',
    ],
    // `&+&` puts a combinator after an `&`, but the element receiving the
    // declarations is the RIGHT-hand one, which is the tab itself.
    [
      "a sibling rule whose subject is the tab",
      '<TabsTrigger className="[&+&]:border-b-0" />',
    ],
    // Shares no variant with the focus ring, and beats it anyway: every Radix
    // trigger carries `aria-controls`, the selectors are equally specific, and
    // Tailwind emits this one last.
    [
      "an equally specific variant emitted after the focus ring",
      '<TabsTrigger className="aria-[controls]:ring-0" />',
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
    // Typography is not ink. `text-*` covers font-size, alignment and wrapping
    // as well as colour, and only the colour half is the primitive's.
    [
      "a state-qualified type size, which sets no colour",
      '<TabsTrigger className="data-[state=active]:text-xs" />',
    ],
    ["a type size on hover", '<TabsTrigger className="hover:text-sm" />'],
    ["text alignment", '<TabsTrigger className="text-center" />'],
    // An important owned declaration wins in CSS whatever the caller qualifies
    // on, so a caller that cannot repaint the indicator must not be reported.
    [
      "an unimportant caller against an important owned colour",
      '<TabsTrigger className="data-[state=active]:border-b-destructive" />',
    ],
    // `border-b-2` is a WIDTH utility. Expanding it into every bottom longhand
    // made it claim the colour too, and an unqualified colour then read as
    // displacing a width it never touches.
    [
      "a bottom-border colour against the width the primitive draws",
      '<TabsTrigger className="border-b-destructive" />',
    ],
    // React emits nothing for these, so there is no declaration to beat a class.
    [
      "an inline property explicitly left unset",
      "<TabsTrigger style={{ borderBottomColor: undefined }} />",
    ],
    [
      "an inline property set to null",
      "<TabsTrigger style={{ borderBottomColor: null }} />",
    ],
    // Tailwind's own child variants. `*` compiles to `:is(& > *)` and `**` to
    // `:is(& *)`, so both land on children and neither can repaint the tab.
    [
      "a child variant removing a border from the tab's children",
      '<TabsTrigger className="*:border-b-0" />',
    ],
    [
      "a descendant variant rounding the tab's descendants",
      '<TabsTrigger className="**:rounded-md" />',
    ],
    // `divide-*` draws BETWEEN children: its bottom border is emitted inside
    // `:where(& > :not(:last-child))` and never applies to the host.
    [
      "a divide utility, whose border belongs to the children",
      '<TabsTrigger className="divide-y-0" />',
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
