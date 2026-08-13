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

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
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
const SCAN_ROOT_NAMES = ["packages", "apps", "templates"] as const;

const SCAN_ROOTS = SCAN_ROOT_NAMES.map(r => resolve(REPO, r));

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
/**
 * Whether a selector actually refers to its parent.
 *
 * Tailwind escapes the candidate into the class name it generates, so
 * `[&>span]:border-b-0` becomes a rule whose SELECTOR contains `\&` — a literal
 * ampersand in an identifier, not a parent reference. Testing for the character
 * alone read that top-level class rule as a nested refinement and folded its
 * name into the selector being measured, which inflated the specificity of
 * every arbitrary-variant class.
 */
function referencesParent(selector: string): boolean {
  return /(^|[^\\])&/.test(selector);
}

function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] ?? "";
    if (character === "(" || character === "[") depth += 1;
    else if (character === ")" || character === "]") depth -= 1;
    else if (depth === 0 && character === separator) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

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
  // A selector LIST is one rule with several subjects, and the declarations
  // land on all of them. `&,&>span` puts the tab itself first, so scanning the
  // unsplit string took `span` as the only subject and discarded a rule that
  // does remove the underline. Retargeting therefore has to hold for EVERY
  // branch before the rule can be dropped.
  const branches = splitTopLevel(selector, ",");
  if (branches.length > 1) {
    return branches.every(branch => retargets(branch.trim()));
  }
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
  return !referencesParent(subject);
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
      .filter(
        rule => !referencesParent(rule.selector) || !retargets(rule.selector)
      )
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
  // Restating the appearance is a third route: it wins nothing today and holds
  // the same appearance anyway, so it survives a change to the primitive that
  // the call site never hears about.
  return asQualified || outranks(owned, caller) || restates(owned, caller);
}

/**
 * A selector's specificity, as the three counts the cascade compares.
 *
 * `&` stands for the utility's own class, so it counts as one class. Ids are
 * counted for completeness; Tailwind emits none.
 */
type Specificity = [number, number, number];

const ZERO: Specificity = [0, 0, 0];

function add(a: Specificity, b: Specificity): Specificity {
  return [
    (a[0] ?? 0) + (b[0] ?? 0),
    (a[1] ?? 0) + (b[1] ?? 0),
    (a[2] ?? 0) + (b[2] ?? 0),
  ];
}

/**
 * A selector's specificity, as the three counts the cascade compares.
 *
 * `&` stands for the utility's own class, so it counts as one class.
 *
 * The functional pseudo-classes are the part that cannot be counted by pattern.
 * `:where()` contributes NOTHING however complex its argument, and `:is()`,
 * `:not()` and `:has()` contribute the specificity of their most specific
 * branch rather than of all of them. Counting their contents as ordinary text
 * ranked `[&:where(:focus-visible)]:ring-0` above the primitive's own
 * `focus-visible` rule, and reported a call site that cannot outrank it.
 */
const FUNCTIONAL = /:(where|is|not|has)\(/;

function specificityOf(selector: string): Specificity {
  const functional = FUNCTIONAL.exec(selector);
  if (functional) {
    const open = functional.index + functional[0].length;
    let depth = 1;
    let close = open;
    while (close < selector.length && depth > 0) {
      if (selector[close] === "(") depth += 1;
      else if (selector[close] === ")") depth -= 1;
      close += 1;
    }
    const inside = selector.slice(open, close - 1);
    const rest = selector.slice(0, functional.index) + selector.slice(close);
    // `:where()` adds nothing; the others add their most specific branch.
    const contribution =
      functional[1] === "where"
        ? ZERO
        : splitTopLevel(inside, ",")
            .map(branch => specificityOf(branch.trim()))
            .reduce((best, one) => (compare(one, best) > 0 ? one : best), ZERO);
    return add(contribution, specificityOf(rest));
  }
  // An attribute selector counts as ONE, and what it holds is data: a `#` or a
  // `.` inside `[data-foo="#bar"]` is a character in a value, not an id or a
  // class. Counted verbatim it inflated the caller's rank and overrode a
  // source-order result that had already decided the question.
  const attributes = selector.match(/\[[^\]]*\]/g)?.length ?? 0;
  const structure = selector.replace(/\[[^\]]*\]/g, "");
  const ids = structure.match(/#[\w-]+/g)?.length ?? 0;
  const classes =
    (structure.match(/(?<!\\\\)&/g)?.length ?? 0) +
    (structure.match(/\.[\w-]+/g)?.length ?? 0) +
    attributes +
    (structure.match(/(?<!:):[\w-]+/g)?.length ?? 0);
  const elements = structure.match(/::[\w-]+/g)?.length ?? 0;
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
function hostSelectorOfUncached(cls: string): string {
  const css = compiled(cls);
  if (css == null) return "";
  const nested = (block: string): string[] => {
    const { rules } = partition(block);
    return rules.flatMap(rule =>
      referencesParent(rule.selector)
        ? [rule.selector, ...nested(rule.body)]
        : nested(rule.body)
    );
  };
  return nested(css.replace(AT_PROPERTY, "")).join("");
}

const hostSelectorOf = perClass(hostSelectorOfUncached);

/** Every declaration a utility makes on the host, as property to value. */
function declarationsOfUncached(cls: string): Map<string, string> {
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

const declarationsOf = perClass(declarationsOfUncached);

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
  const ownedDeclarations = expandDeclarations(declarationsOf(owned));
  for (const [property, value] of expandDeclarations(declarationsOf(caller))) {
    const existing = ownedDeclarations.get(property);
    if (existing !== undefined && existing !== value) return true;
  }
  return false;
}

/**
 * Declarations restated at every granularity they can be compared at.
 *
 * A caller's `outline` shorthand and the primitive's `outline-style` are the
 * same declaration seen at two granularities, and compared as raw names they
 * never met — so a rule that replaces the owned outline read as agreeing with
 * it.
 */
function expandDeclarations(
  declarations: Map<string, string>
): Map<string, string> {
  const flat = new Map<string, string>();
  for (const [property, value] of declarations) {
    // The value decides ownership for some properties, so it is passed rather
    // than only recorded — a `border-image-source: none` names the property
    // while supplying no image at all.
    for (const longhand of expandsTo(property, value))
      flat.set(longhand, value);
  }
  return flat;
}

/**
 * Whether a value is a composition whose other slots belong to someone else.
 *
 * Tailwind uses one property as a shared canvas: `box-shadow` is a list of
 * `var()` slots, and a ring utility fills `--tw-ring-shadow` while leaving
 * `--tw-shadow` for whoever else is on the element. A value containing a slot
 * the utility fills ITSELF is such a canvas, so what it holds is a composition
 * rather than an appearance of its own.
 */
function fillsSharedCanvas(value: string, own: Set<string>): boolean {
  return [...value.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)].some(match =>
    own.has(match[1] ?? "")
  );
}

/**
 * The declarations a utility makes exclusively its own.
 *
 * The shared canvas is excluded, and that exclusion is what makes an equality
 * comparison meaningful at all: `shadow-sm` and `focus-visible:ring-2` both
 * write `box-shadow` with byte-identical text while contributing through
 * different variables, so on the raw declarations every ring and every shadow
 * in the repository would read as restating each other.
 */
function exclusiveDeclarationsUncached(cls: string): Map<string, string> {
  const declarations = declarationsOf(cls);
  const own = new Set(declarations.keys());
  const exclusive = new Map<string, string>();
  for (const [property, value] of declarations) {
    if (fillsSharedCanvas(value, own)) continue;
    exclusive.set(property, value);
  }
  return exclusive;
}

const exclusiveDeclarationsOf = perClass(exclusiveDeclarationsUncached);

/**
 * Whether a caller declares an owned appearance AGAIN, with the same value.
 *
 * Nothing is displaced and nothing conflicts, so neither the merge nor the
 * cascade comparison can see it: `aria-[controls]:outline-none` beside the
 * primitive's `focus-visible:outline-none` shares no variant, and the values
 * are equal so `disagree` correctly reports no override. It is still a second
 * copy of one appearance, and the copy is what survives when the primitive
 * changes — the day the outline becomes a visible ring, this rule goes on
 * suppressing it from a call site that never mentioned the change.
 *
 * Asked as an ADDITIONAL way to hold owned appearance, never by weakening
 * `disagree`: that function's rejection branch is load-bearing, and stubbing it
 * to always return true reports a state-qualified utility that touches nothing
 * the primitive draws.
 */
function restates(owned: Utility, caller: Utility): boolean {
  const ownedDeclarations = expandDeclarations(
    exclusiveDeclarationsOf(owned.full)
  );
  for (const [property, value] of expandDeclarations(
    exclusiveDeclarationsOf(caller.full)
  )) {
    if (ownedDeclarations.get(property) === value) return true;
  }
  return false;
}

/**
 * Whether two selectors can never match the tab at the same moment.
 *
 * Ranking them is only meaningful if both can apply at once. `:not(:focus-visible)`
 * and `:focus-visible` select disjoint states, so the caller's rule is never in
 * the cascade alongside the owned one and cannot displace it however it ranks —
 * reported as removing the focus ring purely on specificity and source order.
 *
 * Deliberately narrow: it recognises a qualifier NEGATED by one side and
 * required by the other, which is the form Tailwind emits for a `not-*` variant
 * and for an arbitrary `[&:not(...)]`. Selectors can be disjoint in ways this
 * does not see, and the consequence of missing one is a report rather than a
 * silence, which is the safer direction for a check whose findings are read.
 */
/**
 * A selector with the parts that qualify an ANCESTOR removed.
 *
 * A qualifier only contradicts another when both constrain the same element.
 * Tailwind's `group-*` variants compile to a functional group holding a
 * descendant combinator — `group-not-disabled:` becomes
 * `&:is(:where(.group):not(*:disabled) *)` — where the negation describes the
 * GROUP and the subject is the trailing `*`. Read whole, that negation looks
 * like a contradiction of the tab's own `:disabled`, and a caller that really
 * can apply to a disabled tab inside an enabled group was excluded from every
 * comparison.
 *
 * Distinct from `subjectOf`, which picks the last compound after a TOP-LEVEL
 * combinator: the combinator here sits inside the parentheses, where that scan
 * cannot see it. This runs first so the two compose rather than overlap.
 *
 * Dropping the whole group rather than parsing out its subject is deliberate:
 * what remains is a selector with FEWER requirements, so it excludes less and
 * compares more, and comparing is the reporting side.
 */
function withoutAncestorQualifiers(selector: string): string {
  let out = "";
  let at = 0;
  while (at < selector.length) {
    const functional = /^:(is|where|has|not)\(/.exec(selector.slice(at));
    if (!functional) {
      out += selector[at];
      at += 1;
      continue;
    }
    const open = at + functional[0].length;
    let depth = 1;
    let end = open;
    while (end < selector.length && depth > 0) {
      if (selector[end] === "(") depth += 1;
      else if (selector[end] === ")") depth -= 1;
      end += 1;
    }
    const inner = selector.slice(open, end - 1);
    // A combinator at the group's own level means it relates two elements, so
    // what it requires is not a requirement on the subject.
    const describesAncestor =
      splitTopLevel(inner, " ").length > 1 ||
      splitTopLevel(inner, ">").length > 1;
    if (!describesAncestor) out += selector.slice(at, end);
    at = end;
  }
  return out;
}

function excludeEachOther(whole: string, other: string): boolean {
  const a = withoutAncestorQualifiers(whole);
  const b = withoutAncestorQualifiers(other);
  const negatedIn = (selector: string): string[] =>
    [...selector.matchAll(/:not\(([^)]*)\)/g)].map(match =>
      // A leading `*` is the universal selector Tailwind writes inside the
      // negation — `not-disabled:` compiles to `&:not(*:disabled)` while the
      // required side is a bare `&:disabled`. Compared verbatim the two never
      // met, so the clearest disjoint pair in the vocabulary read as coexisting.
      (match[1] ?? "").trim().replace(/^\*/, "")
    );
  const requires = (selector: string, qualifier: string): boolean =>
    qualifier.length > 0 &&
    selector.replace(/:not\([^)]*\)/g, "").includes(qualifier);
  if (
    negatedIn(a).some(qualifier => requires(b, qualifier)) ||
    negatedIn(b).some(qualifier => requires(a, qualifier))
  ) {
    return true;
  }
  if (attributesConflict(a, b)) return true;
  return complementaryStates(a, b);
}

/**
 * Pseudo-classes that describe the two sides of one state.
 *
 * An element is on exactly one side of each, so a rule qualified by one can
 * never apply beside a rule qualified by the other. Written positively, which
 * is why neither the negation test nor the attribute test above sees them:
 * `enabled:` and `disabled:` contradict each other without a `:not()` or an
 * attribute value anywhere in either selector.
 */
const COMPLEMENTARY_STATES = [
  [":enabled", ":disabled"],
  [":read-only", ":read-write"],
  [":required", ":optional"],
  [":valid", ":invalid"],
  [":in-range", ":out-of-range"],
];

function complementaryStates(a: string, b: string): boolean {
  // Matched on a boundary so `:enabled` is not found inside a longer name, and
  // read outside any negation, which the test above already compares.
  const has = (selector: string, state: string): boolean =>
    new RegExp(`${state}(?![a-z-])`).test(
      selector
        // A quoted attribute value is DATA. `data-[foo=:enabled]:` compiles to
        // `&[data-foo=":enabled"]`, which says nothing about the element's
        // state, and matching the text inside it invented a contradiction.
        .replace(/"[^"]*"|'[^']*'/g, '""')
        .replace(/:not\([^)]*\)/g, "")
    );
  return COMPLEMENTARY_STATES.some(
    ([one, other]) =>
      (has(a, one ?? "") && has(b, other ?? "")) ||
      (has(a, other ?? "") && has(b, one ?? ""))
  );
}

/**
 * Whether two selectors demand different values of the SAME attribute.
 *
 * An element has one value per attribute, so `[data-state="active"]` and
 * `[data-state="inactive"]` never match together — the form the primitive's own
 * active and inactive rules are written in, and one no negation appears in.
 *
 * Read outside any `:not()`, because a negated attribute states the opposite
 * requirement and the negation is already compared above.
 */
function attributesConflict(a: string, b: string): boolean {
  const required = (selector: string): Map<string, Set<string>> => {
    const found = new Map<string, Set<string>>();
    for (const match of selector
      .replace(/:not\([^)]*\)/g, "")
      .matchAll(/\[([a-zA-Z0-9_-]+)\s*=\s*"([^"]*)"\]/g)) {
      const name = match[1] ?? "";
      const values = found.get(name) ?? new Set<string>();
      values.add(match[2] ?? "");
      found.set(name, values);
    }
    return found;
  };
  const other = required(b);
  for (const [name, values] of required(a)) {
    const theirs = other.get(name);
    if (theirs && ![...values].some(value => theirs.has(value))) return true;
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
  // Asked before anything else, because a rule that can never apply alongside
  // the owned one cannot displace it by ANY route — not by ranking, and not by
  // writing a variable the owned rule reads. Gating only the cascade left
  // `focus-visible:[&:not(:focus-visible)]:ring-0` reported through variant
  // inclusion, on a selector that contradicts itself.
  const ownedWhere = hostSelectorOf(owned.full);
  const callerWhere = hostSelectorOf(caller.full);
  if (ownedWhere && callerWhere && excludeEachOther(ownedWhere, callerWhere)) {
    return false;
  }
  const ownedProperties = new Set(reachedBy(owned.full));
  if (ownedProperties.size === 0) return false;
  const callerProperties = propertiesOf(caller.full);
  // `all` names no property and reaches all of them, so it cannot be compared
  // by intersection; it takes over whatever the primitive draws.
  if (!callerProperties.includes(RESETS_EVERYTHING)) {
    if (!callerProperties.some(property => ownedProperties.has(property))) {
      return false;
    }
  }
  // Assigning a variable the owned rule READS is a takeover on its own, with no
  // cascade question to ask. A custom property set on the tab applies to the tab
  // unconditionally, so the owned rule resolves the caller's value whenever it
  // applies at all — `[--tw-ring-inset:inset]` moves the focus ring inside from
  // an unqualified class that out-specifies nothing. Routing it through the
  // comparison below found nothing to compare: the owned rule never declares the
  // property it depends on.
  const dependencies = new Set(dependenciesOf(owned.full));
  if (callerProperties.some(property => dependencies.has(property)))
    return true;
  return wins(owned, caller);
}

/**
 * The custom properties an owned utility's own appearance is built out of.
 *
 * Narrower than everything it reads, because Tailwind uses one property as a
 * shared canvas: `box-shadow` is a list of `var()` slots, and a ring utility
 * fills `--tw-ring-shadow` while leaving `--tw-shadow` and the inset slots for
 * whoever else is on the element. Those peers are read by the ring's own
 * declaration and are not its dependencies — writing `--tw-shadow` ADDS a
 * shadow beside the ring rather than changing it, which is why `shadow-sm` is
 * a legitimate class on a tab.
 *
 * The tell is structural: when a value already contains a slot the utility
 * fills itself, the value is a composition and its other slots belong to
 * someone else. When it does not — `color: var(--nx-primary)`, or
 * `--tw-ring-shadow: var(--tw-ring-inset,) ...` — every variable in it is an
 * input the appearance depends on.
 */
function dependenciesOfUncached(cls: string): string[] {
  const css = compiled(cls);
  if (css == null) return [];
  const declarations = declarationsOf(cls);
  const own = new Set(declarations.keys());
  const found = new Set<string>();
  for (const value of declarations.values()) {
    // A value carrying one of this utility's own slots is a shared canvas, and
    // the same test decides which declarations are exclusively its own.
    if (fillsSharedCanvas(value, own)) continue;
    for (const match of value.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)) {
      found.add(match[1] ?? "");
    }
  }
  return [...found];
}

const dependenciesOf = perClass(dependenciesOfUncached);

/**
 * The attributes a JSX spread carries, when they can be read here.
 *
 * Only an object literal is read, for the same reason a style prop is: knowing
 * what a name holds means tracing it. `readable` false means the spread may
 * carry anything, which includes the two props this contract owns.
 */
function spreadAttributes(
  attribute: ts.JsxSpreadAttribute,
  checker: ts.TypeChecker
): {
  attributes: Array<{ name: string; value: ts.Expression }>;
  readable: boolean;
} {
  const { objects, readable } = styleResolver(checker).objectsFrom(
    attribute.expression
  );
  if (!readable) return { attributes: [], readable: false };
  const attributes: Array<{ name: string; value: ts.Expression }> = [];
  for (const object of objects) {
    for (const property of object.properties) {
      if (!ts.isPropertyAssignment(property)) {
        // A shorthand or a spread inside the spread is a value this does not
        // read, and the props it carries are unknown rather than absent.
        return { attributes: [], readable: false };
      }
      const name = property.name;
      if (!ts.isIdentifier(name) && !ts.isStringLiteral(name)) {
        return { attributes: [], readable: false };
      }
      attributes.push({ name: name.text, value: property.initializer });
    }
  }
  return { attributes, readable: true };
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
 * EVERY custom property, not only Tailwind's own namespace. A theme variable is
 * read the same way: the primitive's active ink and its underline both resolve
 * `var(--nx-primary)`, so a caller assigning `[--nx-primary:red]` on the tab
 * repaints both without naming `color` or `border-bottom-color` at all.
 *
 * Reading a token cannot make two utilities collide, because this side is only
 * ever compared against what a CALLER WRITES — `border-b-primary` and
 * `text-primary` both read `--nx-primary` and neither assigns it, so they stay
 * unrelated. That asymmetry is what makes recording the reads safe.
 */
function readBy(css: string): string[] {
  const body = hostCss(css.replace(AT_PROPERTY, ""));
  return [...body.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)].map(
    match => match[1] ?? ""
  );
}

/**
 * Memoise a pure function of a class string.
 *
 * Every question below is asked repeatedly for the same handful of classes —
 * each owned class against each caller class, at every call site in the
 * repository — and each one re-parses compiled CSS. The design system is
 * immutable once loaded, so the answers cannot change within a run.
 */
function perClass<T>(answer: (cls: string) => T): (cls: string) => T {
  const cache = new Map<string, T>();
  return cls => {
    if (cache.has(cls)) return cache.get(cls) as T;
    const value = answer(cls);
    cache.set(cls, value);
    return value;
  };
}

/**
 * Compiling a candidate is the expensive step, and the same handful of classes
 * are asked about repeatedly: every owned class against every caller class, at
 * every call site in the repository, through four separate questions. Cached
 * because the design system is immutable once loaded, so the answer cannot
 * change within a run — uncached, the scan starved a neighbouring suite of its
 * timeout.
 */
const compiledCache = new Map<string, string | null>();

function compiled(bare: string): string | null {
  const cached = compiledCache.get(bare);
  if (cached !== undefined) return cached;
  const css = designSystem.candidatesToCss([bare])[0] ?? null;
  compiledCache.set(bare, css);
  return css;
}

/**
 * What a caller's utility writes, shorthands expanded.
 *
 * Routed through the same `expandsTo` the inline-style side uses, so both halves
 * of the contract answer one question with one implementation. That is what
 * keeps `border-dashed` — which Tailwind emits as the `border-style` shorthand —
 * comparable with the primitive's `border-bottom-style`.
 */
function propertiesOfUncached(cls: string): string[] {
  const css = compiled(cls);
  if (css == null) return [];
  return [...new Set(setBy(css).flatMap(property => expandsTo(property)))];
}

const propertiesOf = perClass(propertiesOfUncached);

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
function reachedByUncached(cls: string): string[] {
  const css = compiled(cls);
  if (css == null) return [];
  return [
    ...new Set(
      [...setBy(css), ...readBy(css)].flatMap(property => expandsTo(property))
    ),
  ];
}

const reachedBy = perClass(reachedByUncached);

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

/**
 * The border-image properties that can put an image over the border.
 *
 * Only the shorthand and `-source`, because only they can supply one. While
 * `border-image-source` is its initial `none` there is no image to draw, so
 * `-slice`, `-width`, `-outset` and `-repeat` change nothing on screen and the
 * primitive's own bottom border renders exactly as it did. Owning all five
 * reported those four as repainting an underline they cannot reach; they fall
 * through to standing for themselves, and intersect nothing the primitive owns.
 */
const BORDER_IMAGE = /^border-image(?:-source)?$/;
const ANY_CORNER = /^border(-[a-z]+)*-radius$/;
const BOTTOM_OFFSET = /^margin(-(bottom|block-end|block|y))?$/;

function expandsTo(property: string, value?: string): string[] {
  const kebab = property.replace(/([A-Z])/g, "-$1").toLowerCase();
  // A border IMAGE replaces what the border draws, on every edge it covers.
  // Checked before the shorthand split because it is not one: `border-image`
  // names no edge and no aspect, so the pattern below does not match it and it
  // stood for itself — a name that intersects nothing the primitive owns, while
  // a gradient painted straight over the underline on every tab.
  if (BORDER_IMAGE.test(kebab)) {
    // `none` is the initial value: it supplies no image, so the primitive's
    // ordinary border renders exactly as it did. Owning the property whatever
    // it holds reported the spelling that explicitly draws NOTHING.
    if (value !== undefined && value.trim().toLowerCase() === "none") {
      return [kebab];
    }
    return BORDER_ASPECTS.map(aspect => `border-bottom-${aspect}`);
  }
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

/**
 * `all` is the CSS-wide shorthand: it resets every property that accepts a
 * reset, which is every appearance the primitive draws at once.
 *
 * It cannot be expanded through the usual mapping because it names no property
 * in particular — recorded literally, `all` intersected nothing and
 * `[all:unset]` read as touching none of the tab.
 */
const RESETS_EVERYTHING = "all";

function ownsStyleProperty(
  slot: string,
  property: string,
  value?: string
): boolean {
  const owned = ownedCssProperties()[slot];
  if (!owned) return false;
  const kebab = property.replace(/([A-Z])/g, "-$1").toLowerCase();
  if (kebab === RESETS_EVERYTHING) return owned.size > 0;
  return expandsTo(property, value).some(p => owned.has(p));
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
/**
 * Whether a file can hold a JSX call site.
 *
 * Every extension in which JSX is legal, which is the three below and not only
 * the TypeScript ones: a JavaScript Next.js app writes JSX in `.js` and `.jsx`
 * routinely, so `app/page.js` is an ordinary place for a call site to live.
 * `.ts` is excluded because an element cannot appear there at all.
 *
 * Named once because the Turbo input globs must cover exactly these. An
 * extension the scan reads but the hash does not cover is a file that can
 * change while a cached result is replayed, and a replayed pass is
 * indistinguishable from one that ran. `turbo.json` is static JSON and cannot
 * import this list, so a contract test below asserts the two agree.
 */
const CALL_SITE_EXTENSIONS = [".tsx", ".jsx", ".js"] as const;

/**
 * Directories whose contents are generated rather than written.
 *
 * `.next` is the one that makes this load-bearing rather than tidy: a
 * contributor who has run the playground dev server has thousands of generated
 * `.js` chunks under it, and a scan that reads JavaScript would parse every one
 * of them. That is slow, and worse, it makes the result depend on whether
 * somebody happened to build locally — a suite that reads generated output is
 * reading a different repository on each machine.
 *
 * Every name here is one that ONLY ever denotes generated output, and the list
 * is short for that reason rather than by oversight. `build`, `out` and
 * `coverage` are deliberately absent: they are output conventions at particular
 * project locations, but they are also ordinary Next.js route segments, so
 * `app/build/page.js` is a real call site. Pruning by BASENAME anywhere in the
 * tree would drop it before the extension check ran — a false green produced by
 * the very list meant to keep the scan honest.
 */
const GENERATED_DIRECTORIES = new Set(["node_modules", ".turbo", ".next"]);

/**
 * `dist` is pruned only where it is a package's build output.
 *
 * It does not belong in the list above, by that list's own rule: `dist` is an
 * output convention at a particular location AND an ordinary Next.js route
 * segment, so `app/dist/page.js` is a real call site and pruning by basename
 * dropped it before the extension check ever ran — the same failure the list
 * documents for `app/build/page.js`.
 *
 * What separates the two is not the name but the position: a build directory
 * sits beside the `package.json` of the package it was built from.
 */
function isBuildOutput(directory: string, parent: string): boolean {
  return directory === "dist" && existsSync(join(parent, "package.json"));
}

function isCallSite(name: string): boolean {
  return CALL_SITE_EXTENSIONS.some(extension => name.endsWith(extension));
}

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const name = entry.name;
    if (GENERATED_DIRECTORIES.has(name) || isBuildOutput(name, dir)) continue;
    const full = join(dir, name);
    if (entry.isDirectory()) {
      // `__tests__` is skipped deliberately: a test may construct violating
      // markup on purpose to show a rule fires, and scanning it would report
      // the proof as the problem.
      if (name !== "__tests__") sourceFiles(full, found);
      // `.jsx` as well as `.tsx`. JSX is a supported source form here —
      // `create-nextly-app` scaffolds JavaScript projects — and an extension
      // this scan does not name is a call site it never reads. That failure is
      // silent in the worst way: the file-count control still passes, because
      // the `.tsx` files it counts are all still there.
    } else if (entry.isFile() && isCallSite(name) && full !== PRIMITIVE) {
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
/**
 * The compiler options the binder runs under.
 *
 * `noLib` is load-bearing rather than a saving. It is what makes an unshadowed
 * `undefined` resolve to NO symbol, which is how a local `const undefined` is
 * told apart from the global one; with a lib loaded both would resolve to a
 * declaration and the two cases would read alike. `noResolve` keeps the program
 * to the single file: nothing here reads a type or follows an import, so
 * resolving the module graph would buy nothing and cost the whole workspace.
 */
const BINDER_OPTIONS: ts.CompilerOptions = {
  noResolve: true,
  noLib: true,
  allowJs: true,
  jsx: ts.JsxEmit.Preserve,
  types: [],
};

/**
 * Parse as TSX, and BIND, so names resolve the way the language resolves them.
 *
 * The binder rather than a scope walk written here, because every lexical form
 * that declares a name is a form the walk has to know about: a parameter, a
 * catch binding, an import, a function declaration, a loop variable. A hand
 * written resolver is a list of the ones remembered, and the ones forgotten
 * fail SILENTLY — the search continues outward and finds a different binding of
 * the same name, which reads as a confident answer about the wrong declaration.
 * `getSymbolAtLocation` answers from the same tables the compiler itself uses,
 * so shadowing, parameters and alias identity are correct by construction
 * rather than by enumeration.
 *
 * One program per file keeps `violationsIn` a pure function of its source,
 * which is what lets every case below state a whole file and read the result.
 */
function parse(
  file: string,
  source: string
): { sourceFile: ts.SourceFile; checker: ts.TypeChecker } {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX
  );
  const host: ts.CompilerHost = {
    getSourceFile: name => (name === file ? sourceFile : undefined),
    getDefaultLibFileName: () => "lib.d.ts",
    writeFile: () => {},
    getCurrentDirectory: () => REPO,
    getCanonicalFileName: name => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: name => name === file,
    readFile: name => (name === file ? source : undefined),
  };
  const checker = ts
    .createProgram([file], BINDER_OPTIONS, host)
    .getTypeChecker();
  return { sourceFile, checker };
}

/**
 * The declaration a name refers to HERE, or undefined when it refers to none.
 *
 * Undefined has two meanings that callers must keep apart: a global (there is
 * no declaration in this file) and a name the binder could not resolve. Both
 * say "not a local binding", which is all any caller here asks.
 *
 * A shorthand needs its own question. In `{ borderBottomColor }` the identifier
 * is both the property name and the value, and `getSymbolAtLocation` answers
 * with the PROPERTY — a member of the object literal, whose declaration is the
 * shorthand itself. Following that resolves the value to the entry that holds
 * it, so a shorthand bound to `undefined` looked like a colour and was
 * reported. The value binding is a separate lookup.
 */
function declarationOf(
  identifier: ts.Identifier,
  checker: ts.TypeChecker
): ts.Declaration | undefined {
  const parent = identifier.parent;
  const symbol =
    ts.isShorthandPropertyAssignment(parent) && parent.name === identifier
      ? checker.getShorthandAssignmentValueSymbol(parent)
      : checker.getSymbolAtLocation(identifier);
  return symbol?.valueDeclaration;
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
  owning: Map<ts.Node, string>;
  owningNamespaces: Set<ts.Declaration>;
} {
  const names = new Set<string>();
  const namespaces = new Set<string>();
  const exportedNameOf = new Map<string, string>();
  // Keyed on the NAME NODE each owning binding declares, so a tag can be
  // matched by which declaration it resolves to rather than by how it is
  // spelled. A local component may legitimately reuse an imported name, and
  // holding it to this contract failed a component entitled to its own classes.
  const owning = new Map<ts.Node, string>();
  // The DECLARATIONS that bind an owned namespace, in either spelling. A name
  // set cannot answer this: `import * as UI` and `const UI = require(...)`
  // resolve to different node kinds, and testing for one of them silently
  // dropped the other.
  const owningNamespaces = new Set<ts.Declaration>();

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
            owning.set(specifier.name, exported);
          }
        }
      }
      if (bindings && ts.isNamespaceImport(bindings)) {
        namespaces.add(bindings.name.text);
        owningNamespaces.add(bindings);
      }
    }
    // `require` is the same two imports in JavaScript's other spelling, and
    // `.js`/`.jsx` call sites are scanned, so a CommonJS consumer reaches this
    // primitive exactly as an ESM one does.
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const required = requiredModuleOf(node.initializer);
      if (
        required !== undefined &&
        reachesThePrimitive(required, sourceFile.fileName)
      ) {
        if (ts.isIdentifier(node.name)) {
          namespaces.add(node.name.text);
          owningNamespaces.add(node);
        }
        if (ts.isObjectBindingPattern(node.name)) {
          for (const element of node.name.elements) {
            const source = element.propertyName ?? element.name;
            if (
              ts.isIdentifier(source) &&
              ts.isIdentifier(element.name) &&
              OWNED_EXPORTS.includes(source.text)
            ) {
              names.add(element.name.text);
              exportedNameOf.set(element.name.text, source.text);
              owning.set(element.name, source.text);
            }
          }
        }
      }
    }
    // An alias carries ownership forward, and it can be written three ways.
    // Only the first was read, so composing two separately covered forms —
    // `import * as UI` then `const Trigger = UI.TabsTrigger` — walked through
    // the contract untouched.
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const exported = exportedFrom(
        node.initializer,
        names,
        namespaces,
        exportedNameOf
      );
      if (exported && ts.isIdentifier(node.name)) {
        names.add(node.name.text);
        exportedNameOf.set(node.name.text, exported);
        owning.set(node.name, exported);
      }
      // `const { TabsTrigger: Trigger } = UI` names the same component again.
      if (
        ts.isObjectBindingPattern(node.name) &&
        ts.isIdentifier(node.initializer) &&
        namespaces.has(node.initializer.text)
      ) {
        for (const element of node.name.elements) {
          const source = element.propertyName ?? element.name;
          if (
            ts.isIdentifier(source) &&
            ts.isIdentifier(element.name) &&
            OWNED_EXPORTS.includes(source.text)
          ) {
            names.add(element.name.text);
            exportedNameOf.set(element.name.text, source.text);
            owning.set(element.name, source.text);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return {
    ownership: { names, namespaces },
    exportedNameOf,
    owning,
    owningNamespaces,
  };
}

/**
 * The module a `require(...)` call names, when the initializer is one.
 *
 * Both spellings reach the same place: `require("x")` and a member access on
 * it, so `const UI = require("x")` and `const { TabsTrigger } = require("x")`
 * are the CommonJS forms of the two imports read above.
 */
function requiredModuleOf(initializer: ts.Expression): string | undefined {
  const call = withoutTypeWrappers(initializer);
  if (
    ts.isCallExpression(call) &&
    ts.isIdentifier(call.expression) &&
    call.expression.text === "require" &&
    call.arguments.length === 1
  ) {
    const first = call.arguments[0];
    if (first && ts.isStringLiteral(first)) return first.text;
  }
  return undefined;
}

/**
 * The exported name an initializer resolves to, if it names an owned component.
 *
 * Covers a plain alias of an already-known name and a member of a namespace
 * import. Ownership is a property of what the expression REFERS to, so both
 * spellings have to be read here rather than only at the JSX tag.
 */
function exportedFrom(
  initializer: ts.Expression,
  names: Set<string>,
  namespaces: Set<string>,
  exportedNameOf: Map<string, string>
): string | undefined {
  if (ts.isIdentifier(initializer) && names.has(initializer.text)) {
    return exportedNameOf.get(initializer.text);
  }
  if (
    ts.isPropertyAccessExpression(initializer) &&
    ts.isIdentifier(initializer.expression) &&
    namespaces.has(initializer.expression.text) &&
    OWNED_EXPORTS.includes(initializer.name.text)
  ) {
    return initializer.name.text;
  }
  return undefined;
}

/** The exported name an element's tag renders, or undefined if not owned. */
function exportedTagOf(
  tag: ts.JsxTagNameExpression,
  ownership: Ownership,
  exportedNameOf: Map<string, string>,
  owning: Map<ts.Node, string>,
  owningNamespaces: Set<ts.Declaration>,
  checker: ts.TypeChecker
): string | undefined {
  if (ts.isIdentifier(tag)) {
    // Which binding the tag REFERS to, not how it is spelled. An imported name
    // can be shadowed by a local component, and reading the text alone held
    // that component to a contract about a different one entirely.
    const declaration = declarationOf(tag, checker);
    if (!declaration) return exportedNameOf.get(tag.text);
    const declared = (declaration as { name?: ts.Node }).name;
    // A resolved declaration answers on its own; falling back to the text here
    // would restore exactly the shadowing this replaces.
    return declared ? owning.get(declared) : undefined;
  }
  // `<UI.TabsTrigger>` is a property access, not an identifier, so a traversal
  // testing only for identifiers walks straight past a namespace import.
  if (
    ts.isPropertyAccessExpression(tag) &&
    ts.isIdentifier(tag.expression) &&
    OWNED_EXPORTS.includes(tag.name.text)
  ) {
    // The namespace is a binding too, and a local object can shadow the import
    // exactly as a local component can shadow a named one. Resolved the same
    // way, so both spellings answer from the binder rather than from a
    // file-wide set of names.
    const declaration = declarationOf(tag.expression, checker);
    if (declaration) {
      return owningNamespaces.has(declaration) ? tag.name.text : undefined;
    }
    if (ownership.namespaces.has(tag.expression.text)) return tag.name.text;
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
/**
 * The operand a LITERAL condition selects, when the condition decides it.
 *
 * `undefined` when the condition is not written as a literal, which means both
 * operands stay in play — anything depending on state can be taken.
 *
 * One implementation for both halves of the contract. The class side resolved
 * these and the style side did not, so `true ? {} : { borderBottomColor: "red" }`
 * was reported for a branch the condition can never reach, while the same
 * condition around a class was correctly ignored.
 */
function selectedByLiteralCondition(
  node: ts.Expression
): ts.Expression | undefined {
  if (ts.isConditionalExpression(node)) {
    const decided = staticTruthiness(node.condition);
    if (decided === undefined) return undefined;
    return decided ? node.whenTrue : node.whenFalse;
  }
  if (!ts.isBinaryExpression(node)) return undefined;
  const operator = node.operatorToken.kind;
  // `??` chooses on presence rather than on truth, so it is asked separately.
  if (operator === ts.SyntaxKind.QuestionQuestionToken) {
    return isDefinitelyPresent(node.left) ? node.left : undefined;
  }
  if (
    operator !== ts.SyntaxKind.AmpersandAmpersandToken &&
    operator !== ts.SyntaxKind.BarBarToken
  ) {
    return undefined;
  }
  // The operand each operator YIELDS, not merely the one it evaluates: `0 && x`
  // is the value `0`, which names no class and is no style object. Asked of the
  // one truthiness evaluator, so `false`, `0`, `null` and `""` are decided the
  // same way rather than only the boolean spelling — and so a name holding a
  // known value is decided at all.
  const decided = staticTruthiness(node.left);
  if (decided === undefined) return undefined;
  if (operator === ts.SyntaxKind.AmpersandAmpersandToken) {
    return decided ? node.right : node.left;
  }
  return decided ? node.left : node.right;
}

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
  // A branch that can never be taken contributes no class. `cn("w-full", false &&
  // "border-b-0")` is the ordinary conditional-class form, and `cn` never
  // receives the second string — collecting it reported a call site for a class
  // it does not apply.
  if (ts.isExpression(node)) {
    const selected = selectedByLiteralCondition(node);
    if (selected) return literalStrings(selected, found);
  }
  // `cn({ "border-b-0": false })` applies nothing. In this form the KEY is the
  // class and the VALUE is the condition, so walking the object as plain text
  // collected a class the caller switched off — and collected an unrelated
  // key's value as though it were a class name too.
  if (ts.isObjectLiteralExpression(node)) {
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      if (staticTruthiness(property.initializer) === false) continue;
      const name = property.name;
      if (ts.isStringLiteral(name) || ts.isIdentifier(name))
        found.push(name.text);
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
 * Resolve the objects a `style` prop can hand React, and what they end up
 * declaring.
 *
 * Two questions live together here because they share one piece of machinery:
 * resolving an identifier to the object it names. That is done by walking OUT
 * from the element, innermost scope first, rather than by searching the file —
 * a whole-file search takes whichever matching declaration is visited last, so
 * an unrelated `const s` in a later function both hides a real violation and,
 * in the other order, invents one. Which declaration a name refers to is a
 * lexical question, and the answer is the nearest enclosing one.
 */
/**
 * Resolve the objects a `style` prop can hand React, and what they declare.
 *
 * An inline style on an owned element must be written where it can be READ:
 * an object literal, or a choice between object literals. Anything that has to
 * be traced to know its value — a name, a call, a member access — is reported
 * as unresolvable rather than analysed.
 *
 * That is a deliberate limit, and the reason is worth stating because the
 * alternative was tried at length. Answering "what does this variable hold at
 * this point" is reaching-definitions analysis: assignments, branches, loops,
 * closures, aliases and in-place mutation, each interacting with the others.
 * Written by hand it grew to roughly seven hundred lines and kept producing
 * defects of a kind no test here could see, because a wrong answer looks
 * exactly like a right one. The compiler does not expose that analysis, and a
 * test file is the wrong place to reimplement it.
 *
 * The narrower question this asks instead is decidable by construction: the
 * expression either IS a literal, or it is not. What it costs is that a
 * computed style must be written inline or moved to a class, which is a rule a
 * reader can follow. What it buys is that "no violation" means the scan read
 * the value, rather than that it failed to find one.
 *
 * Property VALUES inside the literal are still followed through a `const`
 * binding, because that is a single lookup with no flow to model, and the
 * binder resolves shadowing correctly on its own. A `let` is not followed: its
 * value depends on what ran, which is the question this stops asking.
 */
function styleResolver(checker: ts.TypeChecker): {
  objectsFrom(expression: ts.Expression | undefined): {
    objects: ts.ObjectLiteralExpression[];
    /** False when the expression has to be traced to know what it holds. */
    readable: boolean;
  };
  valueOf(identifier: ts.Identifier): ts.Expression | undefined;
  declarationOf(identifier: ts.Identifier): ts.Declaration | undefined;
} {
  /**
   * What a `const` holds, for a name the binder resolves to one here.
   *
   * `undefined` for anything else — a `let`, a parameter, an import — because
   * each can hold a different value by the time the element renders.
   */
  const valueOf = (identifier: ts.Identifier): ts.Expression | undefined => {
    const declaration = declarationOf(identifier, checker);
    if (!declaration || !ts.isVariableDeclaration(declaration))
      return undefined;
    const list = declaration.parent;
    const isConst =
      ts.isVariableDeclarationList(list) &&
      (list.flags & ts.NodeFlags.Const) !== 0;
    return isConst ? declaration.initializer : undefined;
  };

  const objectsFrom = (
    root: ts.Expression | undefined
  ): { objects: ts.ObjectLiteralExpression[]; readable: boolean } => {
    const objects: ts.ObjectLiteralExpression[] = [];
    const seen = new Set<ts.Node>();
    let readable = true;
    const walk = (node: ts.Expression | undefined): void => {
      if (!node) {
        readable = false;
        return;
      }
      if (seen.has(node)) return;
      seen.add(node);
      // Parentheses, `as`, `satisfies` and `!` are erased before the code runs,
      // so what they wrap is what React receives.
      const unwrapped = withoutTypeWrappers(node);
      if (unwrapped !== node) return walk(unwrapped);
      if (ts.isObjectLiteralExpression(node)) {
        objects.push(node);
        return;
      }
      // A literal condition decides its branch, and the branch it excludes is
      // one React never receives. Asked through the same helper the class half
      // uses, so one spelling of "this cannot be taken" is not resolved on one
      // side of the contract and reported on the other.
      const selected = selectedByLiteralCondition(node);
      if (selected) return walk(selected);
      // A choice between shapes is still readable: every branch is written
      // here, so each is a style the element can render and all are checked.
      if (ts.isConditionalExpression(node)) {
        walk(node.whenTrue);
        walk(node.whenFalse);
        return;
      }
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
      // A name, a call, a member access, a spread of one: knowing what this
      // holds means tracing it, which is the analysis this deliberately does
      // not do. Reported as unreadable rather than assumed empty — an empty
      // object list reports nothing, which is the silent direction.
      readable = false;
    };
    walk(root);
    return { objects, readable };
  };

  return {
    objectsFrom,
    valueOf,
    declarationOf: identifier => declarationOf(identifier, checker),
  };
}

/** The objects an element's `style` prop can resolve to here. */
function styleObjectsFor(
  attribute: ts.JsxAttribute,
  checker: ts.TypeChecker
): {
  objects: ts.ObjectLiteralExpression[];
  readable: boolean;
  resolver: ReturnType<typeof styleResolver>;
} {
  const resolver = styleResolver(checker);
  const initializer = attribute.initializer;
  // `style` with no expression at all — `style="x"` or a bare `style` — is not
  // an object React can read, and is not this contract's business either.
  if (!initializer || !ts.isJsxExpression(initializer)) {
    return { objects: [], readable: true, resolver };
  }
  const { objects, readable } = resolver.objectsFrom(initializer.expression);
  return { objects, readable, resolver };
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
function propertyNameOf(
  name: ts.PropertyName,
  resolver: ReturnType<typeof styleResolver>
): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name)) {
    return staticKeyOf(name.expression, resolver);
  }
  return undefined;
}

/**
 * The property a computed key names, when that is decidable without running it.
 *
 * A literal is the easy case. A local constant is the one that matters:
 * `const key = "borderBottomColor"; style={{ [key]: "red" }}` repaints the
 * indicator exactly as the literal spelling does, and reading only the literal
 * form walked past it — so the check reported clean on a call site that paints.
 *
 * Followed through the same resolver the values use, so a key and a value
 * declared side by side are read the same way, and wrappers are peeled first so
 * `[key as string]` resolves like a bare `key`.
 *
 * `seen` stops a self-referential binding from recursing. It holds DECLARATIONS
 * rather than names, because a name is not what a binding IS: two bindings can
 * share a spelling, and an alias chain may legitimately pass through both. The
 * declaration is what makes them one binding or two, so it is what a cycle has
 * to be measured in. Anything else — a template with substitutions, a call, a
 * member access — stays undecidable and returns undefined, which leaves the
 * property unnamed rather than guessed.
 *
 * KNOWN LIMIT, and it is a hole rather than a decision to be comfortable with:
 * a reassignable key escapes. `let k = "x"; k = "borderBottomColor";
 * style={{ [k]: "red" }}` paints the indicator and is not reported, because the
 * binding is not `const` and its declaration initializer is not what runs.
 *
 * The asymmetry with values is deliberate. For a VALUE the property is already
 * known to be owned, so undecidable defaults to "it emits" and the call site is
 * reported — the conservative side. For a KEY, undecidable means the property
 * is not known at all, and defaulting to "owned" would report every computed
 * key in the repository, including the overwhelming majority that name nothing
 * this primitive draws.
 */
function staticKeyOf(
  expression: ts.Expression,
  resolver: ReturnType<typeof styleResolver>,
  seen = new Set<ts.Declaration>()
): string | undefined {
  const value = withoutTypeWrappers(expression);
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
    return value.text;
  }
  if (ts.isIdentifier(value)) {
    const declaration = resolver.declarationOf(value);
    if (!declaration || seen.has(declaration)) return undefined;
    seen.add(declaration);
    // The binder resolved this identifier at its own position, so an alias
    // like `const key = sourceKey` already refers to whatever `sourceKey`
    // meant where the alias was written.
    const bound = resolver.valueOf(value);
    if (bound) return staticKeyOf(bound, resolver, seen);
  }
  return undefined;
}

/**
 * The string a value is written as, when it is written as one.
 *
 * Some properties are owned or not depending on what they hold, so the value
 * travels with the name rather than being discarded at the key.
 */
function staticStringOf(
  expression: ts.Expression,
  resolver?: ReturnType<typeof styleResolver>,
  seen = new Set<ts.Declaration>()
): string | undefined {
  const inner = withoutTypeWrappers(expression);
  if (ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner)) {
    return inner.text;
  }
  // A name holding the value is the same value. `const noImage = "none"` draws
  // no border image exactly as the literal spelling does, and reading only the
  // literal form reported a call site that paints nothing.
  if (!resolver || !ts.isIdentifier(inner)) return undefined;
  const declaration = resolver.declarationOf(inner);
  if (!declaration || seen.has(declaration)) return undefined;
  seen.add(declaration);
  const bound = resolver.valueOf(inner);
  return bound ? staticStringOf(bound, resolver, seen) : undefined;
}

/**
 * What a value is worth in a boolean test, when that is decidable.
 *
 * `undefined` for anything whose truthiness depends on what it holds at
 * runtime, which keeps the write it guards in play.
 */
function staticTruthiness(value: ts.Expression): boolean | undefined {
  const inner = withoutTypeWrappers(value);
  if (
    ts.isObjectLiteralExpression(inner) ||
    ts.isArrayLiteralExpression(inner)
  ) {
    return true;
  }
  if (ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner)) {
    return inner.text.length > 0;
  }
  if (ts.isNumericLiteral(inner)) return Number(inner.text) !== 0;
  if (inner.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (inner.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (inner.kind === ts.SyntaxKind.NullKeyword) return false;
  if (ts.isVoidExpression(inner)) return false;
  return undefined;
}

/**
 * Whether a value is certainly neither `null` nor `undefined`.
 *
 * Narrow on purpose: it decides whether a `??=` can fire, and answering "yes"
 * removes a value from consideration. Only forms that cannot be nullish however
 * they are read qualify, so anything unfamiliar keeps the write in play.
 */
function isDefinitelyPresent(value: ts.Expression): boolean {
  const inner = withoutTypeWrappers(value);
  return (
    ts.isObjectLiteralExpression(inner) ||
    ts.isArrayLiteralExpression(inner) ||
    ts.isStringLiteral(inner) ||
    ts.isNoSubstitutionTemplateLiteral(inner) ||
    ts.isNumericLiteral(inner) ||
    inner.kind === ts.SyntaxKind.TrueKeyword ||
    inner.kind === ts.SyntaxKind.FalseKeyword
  );
}

/**
 * Whether an initializer can only ever be absent.
 *
 * Deliberately narrow: it answers "is this written as nothing", not "could this
 * be nullish at runtime". A variable that happens to hold `undefined` is not
 * decidable here and must keep being reported, because the same variable holds a
 * colour on the next render — which is exactly how the violation that motivated
 * the inline half was written.
 *
 * `undefined` is a NAME, not a keyword, so a local declaration of it is a
 * colour like any other. It counts as nothing only when it resolves to no
 * declaration in this file, which is what the global one does.
 *
 * The empty string is React's own spelling of absence, not an assumption made
 * here: `renderToStaticMarkup(<div style={{ borderBottomColor: "" }} />)`
 * emits no `style` attribute at all, while the same property with a colour
 * emits `border-bottom-color:red`. Clearing a style with `""` is an ordinary
 * conditional form, so reporting it rejected the idiom the check exists to
 * permit.
 */
function isDefinitelyNothing(
  initializer: ts.Expression,
  resolver: ReturnType<typeof styleResolver>
): boolean {
  const value = withoutTypeWrappers(initializer);
  if (ts.isIdentifier(value)) {
    return value.text === "undefined" && !resolver.declarationOf(value);
  }
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
    return value.text === "";
  }
  // React emits no declaration for a boolean either, verified the same way:
  // `{ borderBottomColor: false }` and `true` both render an element with no
  // `style` attribute at all.
  if (
    value.kind === ts.SyntaxKind.TrueKeyword ||
    value.kind === ts.SyntaxKind.FalseKeyword
  ) {
    return true;
  }
  if (value.kind === ts.SyntaxKind.NullKeyword) return true;
  // `void 0` is the other spelling of the same intent.
  return ts.isVoidExpression(value);
}

/**
 * An expression with the wrappers that emit nothing peeled away.
 *
 * `as`, `satisfies`, `!` and parentheses are all erased before the code runs,
 * so `undefined as string | undefined` and `(undefined)` reach React as exactly
 * `undefined` — and React emits no declaration for either. Reading only the
 * outer node saw an `AsExpression`, decided it was not written as nothing, and
 * reported a call site that paints nothing at all.
 *
 * A false positive here is worse than it looks: `undefined as string |
 * undefined` is the ORDINARY way to write an optional style in a typed
 * codebase, so the check was rejecting the idiomatic spelling of the very thing
 * it exists to permit.
 *
 * Applied where the question is "what does this evaluate to", never where the
 * question is about the written type — nothing here reads types.
 */
function withoutTypeWrappers(expression: ts.Expression): ts.Expression {
  let value = expression;
  while (
    ts.isAsExpression(value) ||
    ts.isSatisfiesExpression(value) ||
    ts.isParenthesizedExpression(value) ||
    ts.isNonNullExpression(value)
  ) {
    value = value.expression;
  }
  return value;
}

/**
 * One property an object declares: whether React emits it, and what it holds.
 *
 * The value travels with the name because ownership is not always decided by
 * the property alone — `border-image-source` replaces the border when it names
 * an image and leaves it alone when it names `none`.
 */
interface DeclaredProperty {
  emits: boolean;
  /** The value when it is written as a literal string, else undefined. */
  value: string | undefined;
}

/**
 * What an object literal actually declares, after spreads and overwrites.
 *
 * An object is built in source order and a later key replaces an earlier one,
 * so the question is never "does this property appear" but "what is it by the
 * end". `{ ...inherited, borderBottomColor: undefined }` is the shape a typed
 * style uses to CLEAR an inherited value, and reading the spread source on its
 * own reported the value the outer object had just removed.
 *
 * `true` means React emits a declaration for it.
 */
function declaredProperties(
  object: ts.ObjectLiteralExpression,
  resolver: ReturnType<typeof styleResolver>,
  onPath = new Set<ts.Node>(),
  // Set when a spread source cannot be read. A spread's contents are entries of
  // the object being built, so an unreadable one leaves the object itself only
  // partly known — and dropping it silently is the direction that reports
  // nothing, which is how a spread carrying an owned property would vanish.
  unreadable = { value: false }
): Array<Map<string, DeclaredProperty>> {
  // A LIST of possible results, not one. A spread whose source is chosen at
  // runtime — `active ? { borderBottomColor: c } : {}` — produces different
  // objects on different renders, and merging them into a single map let the
  // later branch overwrite the earlier one: the emitting branch disappeared,
  // and reversing the two invented a violation instead. Each branch is a shape
  // the element can render, so each is carried separately and any one of them
  // declaring an owned property is a violation.
  //
  // `onPath` is the ACTIVE recursion path rather than everything ever visited,
  // which is the difference between refusing a cycle and refusing a repeat.
  // `{ ...inherited, borderBottomColor: undefined, ...inherited }` spreads one
  // source twice and ends with its value; a set that remembered the first
  // occurrence answered the second with nothing and cleared the declaration.
  if (onPath.has(object)) return [new Map()];
  onPath.add(object);

  let variants: Array<Map<string, DeclaredProperty>> = [new Map()];
  const setOnEach = (name: string, state: DeclaredProperty): void => {
    for (const variant of variants) variant.set(name, state);
  };

  for (const property of object.properties) {
    if (ts.isSpreadAssignment(property)) {
      const spread = resolver.objectsFrom(property.expression);
      if (!spread.readable) unreadable.value = true;
      const branches = spread.objects.flatMap(source =>
        declaredProperties(source, resolver, onPath, unreadable)
      );
      if (branches.length === 0) continue;
      variants = variants.flatMap(base =>
        branches.map(branch => new Map([...base, ...branch]))
      );
      continue;
    }
    if (ts.isPropertyAssignment(property)) {
      const name = propertyNameOf(property.name, resolver);
      if (name) {
        setOnEach(name, {
          emits: emitsValue(property.initializer, resolver),
          value: staticStringOf(property.initializer, resolver),
        });
      }
      continue;
    }
    // A shorthand entry is a different node kind with the same effect:
    // `{ borderBottomColor }` sets the property just as `{ borderBottomColor: c }`
    // does, and a visitor keyed on `PropertyAssignment` alone walks past it. Its
    // value lives in the binding, which `emitsValue` follows.
    if (ts.isShorthandPropertyAssignment(property)) {
      setOnEach(property.name.text, {
        emits: emitsValue(property.name, resolver),
        value: undefined,
      });
      continue;
    }
    // A getter is a third spelling again: React reads the property and emits
    // whatever it returns, so the declaration is real even though no value is
    // written at the key. What it returns is not decidable here, so it counts
    // as emitting.
    if (ts.isGetAccessorDeclaration(property)) {
      const name = propertyNameOf(property.name, resolver);
      if (name) setOnEach(name, { emits: true, value: undefined });
    }
  }
  onPath.delete(object);
  return variants;
}

/**
 * Whether React emits a declaration for this value.
 *
 * Follows an identifier to what it was initialised with, so the same test
 * covers `{ borderBottomColor: empty }` and `{ borderBottomColor }` — one
 * resolving the value at the property, the other at the binding. Treating those
 * two spellings differently is what left an optional style constant reported at
 * one and cleared at the other.
 *
 * Still deliberately narrow: it answers "is this written as nothing", not
 * "could this be nullish at runtime". A binding whose value is not statically
 * decidable keeps counting as a declaration, because the same variable holds a
 * colour on the next render.
 */
function emitsValue(
  value: ts.Expression,
  resolver: ReturnType<typeof styleResolver>,
  seen = new Set<ts.Declaration>()
): boolean {
  const inner = withoutTypeWrappers(value);
  if (isDefinitelyNothing(inner, resolver)) return false;
  // Unwrapped before the binding lookup too, so `(colour as string)` resolves
  // through the same identifier path a bare `colour` does.
  if (ts.isIdentifier(inner)) {
    const declaration = resolver.declarationOf(inner);
    // Keyed on the declaration, so two bindings that share a name are two
    // entries and a chain crossing a shadow is not mistaken for a cycle.
    if (!declaration || seen.has(declaration)) return true;
    seen.add(declaration);
    // Any value the name can hold here is a value React can receive, so the
    // property emits unless EVERY one of them is written as nothing. Each
    // branch carries its own trail, or one branch's visits would cut another's
    // short and report it as emitting.
    // Followed only through a `const`. Anything else can hold a different
    // value by the time the element renders, and assuming it emits is the
    // reporting side.
    const bound = resolver.valueOf(inner);
    if (bound) return emitsValue(bound, resolver, new Set(seen));
  }
  return true;
}

/** An owned inline property this object still declares once it is complete. */
function ownedStyleProperty(
  slot: string,
  object: ts.ObjectLiteralExpression,
  resolver: ReturnType<typeof styleResolver>,
  unreadable = { value: false }
): string | undefined {
  for (const variant of declaredProperties(
    object,
    resolver,
    undefined,
    unreadable
  )) {
    for (const [name, state] of variant) {
      if (state.emits && ownsStyleProperty(slot, name, state.value))
        return name;
    }
  }
  return undefined;
}

interface Violation {
  file: string;
  line: number;
  why: string;
}

function violationsIn(file: string, source: string): Violation[] {
  const { sourceFile, checker } = parse(file, source);
  const { ownership, exportedNameOf, owning, owningNamespaces } =
    ownershipIn(sourceFile);
  const found: Violation[] = [];
  const at = (node: ts.Node): number =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line +
    1;

  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const exported = exportedTagOf(
        node.tagName,
        ownership,
        exportedNameOf,
        owning,
        owningNamespaces,
        checker
      );
      if (exported) {
        for (const attribute of node.attributes.properties) {
          // `<TabsTrigger {...props} />` carries whatever `props` holds, which
          // includes `style` and `className`. Skipping spreads left the whole
          // contract bypassable by one idiom, on both halves at once.
          if (ts.isJsxSpreadAttribute(attribute)) {
            const spread = spreadAttributes(attribute, checker);
            if (!spread.readable) {
              found.push({
                file,
                line: at(attribute),
                why: "spreads props this scan cannot read, which may carry `style` or `className` — spread an object literal, or pass the props this primitive owns explicitly",
              });
              continue;
            }
            for (const carried of spread.attributes) {
              const carriedName = carried.name;
              if (carriedName === "className") {
                const classes = literalStrings(carried.value).join(" ");
                const displaced = displacedBy(exported, classes);
                if (displaced.length > 0) {
                  found.push({
                    file,
                    line: at(attribute),
                    why: `spreads ${displaced.join(", ")} — the primitive owns that appearance, and every surface should change with it`,
                  });
                }
              }
              if (carriedName === "style") {
                const resolver = styleResolver(checker);
                const { objects, readable } = resolver.objectsFrom(
                  carried.value
                );
                if (!readable) {
                  found.push({
                    file,
                    line: at(attribute),
                    why: "spreads an inline style this scan cannot read — write it as a literal object, or move it to `className` so the primitive keeps its appearance",
                  });
                  continue;
                }
                const owned = objects
                  .map(object => ownedStyleProperty(exported, object, resolver))
                  .find(Boolean);
                if (owned) {
                  found.push({
                    file,
                    line: at(attribute),
                    why: `spreads \`${owned}\` inline, which beats every class the primitive applies`,
                  });
                }
              }
            }
            continue;
          }
          if (!ts.isJsxAttribute(attribute)) continue;
          const name = attribute.name.getText(sourceFile);
          if (name === "style") {
            const { objects, readable, resolver } = styleObjectsFor(
              attribute,
              checker
            );
            // An expression the scan cannot read is reported for BEING
            // unreadable, rather than passed over. Tracing what a name holds
            // at this point is the analysis this contract deliberately does
            // not do, and staying silent about it would mean "no violation"
            // and "could not tell" looked the same from outside.
            if (!readable) {
              found.push({
                file,
                line: at(attribute),
                why: "sets an inline style this scan cannot read — write it as a literal object, or move it to `className` so the primitive keeps its appearance",
              });
              continue;
            }
            const spreadUnreadable = { value: false };
            const property = objects
              .map(object =>
                ownedStyleProperty(exported, object, resolver, spreadUnreadable)
              )
              .find(Boolean);
            if (!property && spreadUnreadable.value) {
              found.push({
                file,
                line: at(attribute),
                why: "spreads an inline style this scan cannot read — write it as a literal object, or move it to `className` so the primitive keeps its appearance",
              });
              continue;
            }
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

  it("leaves an important owned declaration alone, and still reports the rest", () => {
    // An important owned declaration wins in CSS whatever the caller qualifies
    // on, so `data-[state=active]:border-b-primary!` must never appear as
    // displaced by an unimportant caller.
    //
    // The class as a whole IS still reported, and that is not a contradiction.
    // Measured: `hover:border-primary` is a SEPARATE owned declaration, not
    // important, equally specific (`&:hover` against `&[data-state="active"]`,
    // one class plus one qualifier each), and emitted FIRST — Tailwind orders it
    // 0 against 1. Hovering an active tab satisfies both, so the caller does
    // repaint the underline's hover colour. An earlier version of this case
    // asserted nothing was reported at all, which was broader than what the
    // important rule establishes and hid a real displacement.
    const source = `${IMPORT}<TabsTrigger className="data-[state=active]:border-b-destructive" />`;
    const reported = violationsIn("probe.tsx", source);
    expect(reported).not.toEqual([]);
    for (const violation of reported) {
      expect(violation.why).not.toContain("border-b-primary!");
    }
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
    // A selector LIST has several subjects, and the first one here is the tab.
    [
      "a selector list whose first branch is the tab itself",
      '<TabsTrigger className="[&,&>span]:border-b-0" />',
    ],
    // A custom property assigned on the tab applies to the tab unconditionally,
    // so it changes every owned rule that reads it whatever their variants say.
    [
      "an unqualified write to a ring variable the primitive reads",
      '<TabsTrigger className="[--tw-ring-inset:inset]" />',
    ],
    [
      "a theme token the primitive draws its ink and underline from",
      '<TabsTrigger className="[--nx-primary:red]" />',
    ],
    // The control that makes the clear-after-spread case above mean something:
    // a spread whose owned property is NOT cleared must still be reported, or
    // that one passes because spread contents are never read at all.
    [
      "a spread whose owned property survives",
      'const inherited = { borderBottomColor: "red" };\n<TabsTrigger style={{ ...inherited }} />',
    ],
    // `all` names no property and resets every one of them.
    [
      "the CSS-wide shorthand as an arbitrary class",
      '<TabsTrigger className="[all:unset]" />',
    ],
    [
      "the CSS-wide shorthand as an inline style",
      '<TabsTrigger style={{ all: "unset" }} />',
    ],
    // Two separately covered forms composed: a namespace import, then an alias
    // of one of its members.
    [
      "an alias of a namespace member",
      'import * as UI from "@nextlyhq/ui";\nconst Trigger = UI.TabsTrigger;\n<Trigger className="border-b-0" />',
    ],
    // A shorthand's value lives in its binding, and a spread branch that emits
    // is a violation even when a sibling branch clears the same property.
    [
      "an owned property emitted by one branch of a conditional spread",
      'const inherited = active ? { borderBottomColor: "red" } : { borderBottomColor: undefined };\n<TabsTrigger style={{ ...inherited }} />',
    ],
    [
      "the same conditional spread with its branches reversed",
      'const inherited = active ? { borderBottomColor: undefined } : { borderBottomColor: "red" };\n<TabsTrigger style={{ ...inherited }} />',
    ],
    // Equal specificity, emitted later, and a shorthand that replaces the
    // longhand the primitive sets.
    // One source spread twice, with a clear between: the last occurrence wins.
    [
      "a repeated spread source whose second occurrence restores the value",
      'const inherited = { borderBottomColor: "red" };\n<TabsTrigger style={{ ...inherited, borderBottomColor: undefined, ...inherited }} />',
    ],
    // React reads the property and emits whatever the getter returns.
    [
      "an owned property declared through a getter",
      '<TabsTrigger style={{ get borderBottomColor() { return "red"; } }} />',
    ],
    // A constant-computed key names the property exactly as the literal
    // spelling does, and React emits the same declaration — so the two must be
    // treated identically. The distinguishing property is that the key is
    // decidable without running the code, not how it is spelled.
    [
      "an owned property behind a computed key bound to a constant",
      'const key = "borderBottomColor";\n<TabsTrigger style={{ [key]: "red" }} />',
    ],
    [
      "the same constant behind a type assertion",
      'const key = "borderBottomColor" as const;\n<TabsTrigger style={{ [key as string]: "red" }} />',
    ],
    [
      "a getter whose name is a computed constant",
      'const key = "borderBottomColor";\n<TabsTrigger style={{ get [key]() { return "red"; } }} />',
    ],
    [
      "a shorthand that replaces an owned longhand",
      '<TabsTrigger className="aria-[controls]:[outline:2px_solid_red]" />',
    ],
    // A border image paints over the border the primitive draws, on every tab
    // including the inactive ones whose colour it owns. It names no edge and no
    // aspect, so it reaches the underline without mentioning it.
    [
      "a border image painted over the underline",
      '<TabsTrigger className="[border-image:linear-gradient(red,red)_1]" />',
    ],
    [
      "the same border image set inline",
      '<TabsTrigger style={{ borderImage: "linear-gradient(red,red) 1" }} />',
    ],
    // The one longhand that can put an image there. It is what keeps the
    // narrowing below honest: the other four are reported by nothing, so
    // without a case on `-source` a mapping that owned no border image at all
    // would pass.
    [
      "a border image supplied by the source longhand",
      '<TabsTrigger style={{ borderImageSource: "linear-gradient(red,red)" }} />',
    ],
    [
      "a destructured namespace member",
      'import * as UI from "@nextlyhq/ui";\nconst { TabsTrigger: Trigger } = UI;\n<Trigger className="border-b-0" />',
    ],
    // A reassignable binding is not its declaration initializer. Reading it as
    // one concludes the element paints nothing while it paints — a false
    // NEGATIVE, which is the direction that lets a real violation ship, and the
    // one an immutable-binding control cannot see.
    [
      "a reassigned binding that held nothing at its declaration",
      'let c: string | undefined = undefined;\nc = "red";\n<TabsTrigger style={{ borderBottomColor: c }} />',
    ],
    [
      "the same reassigned binding behind an assertion",
      'let c: string | undefined = undefined;\nc = "red";\n<TabsTrigger style={{ borderBottomColor: c as string | undefined }} />',
    ],
    // An alias resolved in the WRONG scope. `key` means what `sourceKey` meant
    // where the alias was written; resolving it beside the element picks up an
    // inner `sourceKey` the alias never saw.
    [
      "a computed key aliasing a constant shadowed near the element",
      'const sourceKey = "borderBottomColor";\nconst key = sourceKey;\nfunction Row() {\n  const sourceKey = "width";\n  return <TabsTrigger style={{ [key]: "red" }} />;\n}',
    ],
    // An alias chain CROSSING a shadowed name. Two distinct bindings spelled
    // `key`, so a cycle guard keyed on the spelling stops at the second one and
    // never reaches the owned property the chain names.
    [
      "a computed key aliased through a second binding of the same name",
      'const key = "borderBottomColor";\nfunction Row() {\n  const alias = key;\n  {\n    const key = alias;\n    return <TabsTrigger style={{ [key]: "red" }} />;\n  }\n}',
    ],
    // A second copy of an owned appearance, declared with the same value under
    // a different variant. Nothing is displaced and nothing conflicts today,
    // which is exactly why no comparison saw it — and the day the primitive
    // changes its outline, this rule keeps suppressing it.
    [
      "an owned declaration restated under a different variant",
      '<TabsTrigger className="aria-[controls]:outline-none" />',
    ],
    // Pseudo-class TEXT inside an attribute value is data. This rule really can
    // apply beside the primitive's disabled one.
    [
      "a rule whose attribute value merely spells a state",
      '<TabsTrigger className="data-[foo=:enabled]:opacity-100" />',
    ],
    // A `break` above the reset can carry control out of the `do` body before
    // it runs, so the owned value is still one the element can render.
    [
      "an owned property a do-body reset behind a break does not clear",
      'let style: Record<string, string> = { borderBottomColor: "red" };\ndo {\n  if (Math.random() > 0) break;\n  style = {};\n} while (false);\n<TabsTrigger style={style} />',
    ],
    // The CommonJS spelling of a namespace import.
    [
      "a class on a namespace member behind a CommonJS require",
      'const UI = require("@nextlyhq/ui");\n<UI.TabsTrigger className="border-b-0" />',
    ],
    // A spread of a NAME. The outer object does clear the property, so nothing
    // is repainted today — but knowing that requires reading what the name
    // holds, and `const` does not settle it: an object is mutable in place
    // whatever the binding says. Reported for being unreadable, which is the
    // honest answer rather than a guess in either direction.
    [
      "a spread of a name the scan cannot read",
      'const inherited = { borderBottomColor: "red" };\n<TabsTrigger style={{ ...inherited, borderBottomColor: undefined }} />',
    ],
    // The shapes that used to be traced. Each is now reported for what it is —
    // an inline style whose value this scan does not read — rather than
    // analysed by a flow model. One per kind, because they all reach the same
    // branch and a longer list would only restate it.
    [
      "an inline style held in a mutable binding",
      'let style = { borderBottomColor: "red" };\n<TabsTrigger style={style} />',
    ],
    ["an inline style built by a call", "<TabsTrigger style={buildStyle()} />"],
    [
      "an inline style read from a member access",
      "<TabsTrigger style={theme.tab} />",
    ],
    // A JSX spread carries whatever the object holds, including the two props
    // this contract owns. Skipping spreads left both halves bypassable by one
    // idiom.
    [
      "an owned property spread in as a literal style prop",
      'const props = { style: { borderBottomColor: "red" } };\n<TabsTrigger {...{ style: { borderBottomColor: "red" } }} />',
    ],
    [
      "a displacing class spread in as a literal className",
      '<TabsTrigger {...{ className: "border-b-0" }} />',
    ],
    // And a spread whose contents cannot be read at all, which may carry
    // either of them.
    [
      "a spread of props the scan cannot read",
      'const props = { className: "border-b-0" };\n<TabsTrigger {...props} />',
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
    // Erased before the code runs, so React receives exactly `undefined` and
    // emits no declaration. `undefined as string | undefined` is the ORDINARY
    // way to write an optional style in a typed codebase, so reporting it
    // rejected the idiomatic spelling of the thing this check exists to permit.
    [
      "an inline property widened with an `as` assertion",
      "<TabsTrigger style={{ borderBottomColor: undefined as string | undefined }} />",
    ],
    [
      "an inline property widened with `satisfies`",
      "<TabsTrigger style={{ borderBottomColor: undefined satisfies string | undefined }} />",
    ],
    [
      "an inline property wrapped in parentheses",
      "<TabsTrigger style={{ borderBottomColor: (undefined) }} />",
    ],
    [
      "the same assertion around a parenthesised nothing",
      "<TabsTrigger style={{ borderBottomColor: (undefined) as string | undefined }} />",
    ],
    // The non-null branch. `!` asserts to the COMPILER that a value is present
    // and erases entirely at runtime, so `undefined!` still reaches React as
    // `undefined` and still emits nothing. Without this case, deleting
    // `ts.isNonNullExpression` from the unwrapper leaves the suite green.
    [
      "an inline property with a non-null assertion on nothing",
      "<TabsTrigger style={{ borderBottomColor: undefined! }} />",
    ],
    // The unwrapping in front of the BINDING lookup, which is a second path
    // through the same helper. A wrapper around an identifier has to be peeled
    // before the resolver is asked, or the lookup never happens and the value
    // is reported on the strength of its wrapper alone.
    [
      "a bound nothing behind an assertion",
      "const empty = undefined;\n<TabsTrigger style={{ borderBottomColor: empty as string | undefined }} />",
    ],
    [
      "a bound nothing behind a non-null assertion",
      "const empty = undefined;\n<TabsTrigger style={{ borderBottomColor: empty! }} />",
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
    // `:where()` contributes no specificity however complex its argument, so
    // this cannot out-rank the primitive's own focus rule.
    [
      "a zero-specificity variant that cannot outrank the focus ring",
      '<TabsTrigger className="[&:where(:focus-visible)]:ring-0" />',
    ],
    // An object is built in source order: the later key clears the spread.
    // Disjoint states: the caller's rule is never in the cascade beside the
    // owned one, so ranking them says nothing.
    [
      "a variant that cannot apply at the same time as the owned rule",
      '<TabsTrigger className="[&:not(:focus-visible)]:ring-0" />',
    ],
    // A selector that contradicts itself can never apply, so it cannot displace
    // anything however its variants compare.
    [
      "a variant contradicted by one it includes",
      '<TabsTrigger className="focus-visible:[&:not(:focus-visible)]:ring-0" />',
    ],
    // React emits nothing for a shorthand whose binding holds nothing.
    [
      "an identifier bound to undefined in a property assignment",
      "const empty = undefined;\n<TabsTrigger style={{ borderBottomColor: empty }} />",
    ],
    [
      "a shorthand bound to undefined",
      "const borderBottomColor = undefined;\n<TabsTrigger style={{ borderBottomColor }} />",
    ],
    // `cn` never receives the second string.
    [
      "a class literal behind a statically false guard",
      '<TabsTrigger className={cn("w-full", false && "border-b-0")} />',
    ],
    // A PARAMETER shadowing an outer constant. The name is the parameter, whose
    // value the caller supplies, so the property is undecidable — not the outer
    // constant's. Walking past the parameter named an owned property for an
    // element that renders whatever it is passed.
    [
      "a computed key bound to a parameter shadowing an outer constant",
      'const key = "borderBottomColor";\nfunction Row(key = "width") {\n  return <TabsTrigger style={{ [key]: "red" }} />;\n}',
    ],
    // The border-image longhands that cannot draw. With `border-image-source`
    // at its initial `none` there is no image, so these change nothing on
    // screen and the primitive's own bottom border renders as it did.
    [
      "border-image longhands with no source to draw",
      '<TabsTrigger style={{ borderImageRepeat: "round", borderImageSlice: "30", borderImageWidth: "4px", borderImageOutset: "2px" }} />',
    ],
    // React emits no declaration for an empty string, verified with
    // `renderToStaticMarkup`: `{ borderBottomColor: "" }` renders no `style`
    // attribute at all. Clearing a style with `""` is an ordinary conditional
    // spelling, so reporting it rejects the idiom the check exists to permit.
    [
      "an owned property cleared with an empty string",
      '<TabsTrigger style={{ borderBottomColor: "" }} />',
    ],
    // A branch the condition can never take. The class half already resolves
    // literal conditions, so reading both branches of a style prop held the two
    // halves of one contract to different standards.
    [
      "an owned property in a statically unreachable branch",
      '<TabsTrigger style={true ? {} : { borderBottomColor: "red" }} />',
    ],
    // A rule that can never apply beside the owned one it matches. `disabled:`
    // and `not-disabled:` select complementary states, so neither can restate
    // or override the other however the cascade ranks them.
    [
      "an equal declaration under a negated form of the owned qualifier",
      '<TabsTrigger className="not-disabled:opacity-50" />',
    ],
    // React emits no declaration for a boolean, the same as for an empty
    // string: both render an element carrying no `style` attribute at all.
    [
      "an owned property set to a boolean",
      "<TabsTrigger style={{ borderBottomColor: false }} />",
    ],
    // One element cannot be both enabled and disabled, so these rules never
    // apply together however the cascade ranks them.
    [
      "a rule qualified by the complement of an owned state",
      '<TabsTrigger className="enabled:opacity-50" />',
    ],
    // `none` is the initial value of `border-image-source`: it supplies no
    // image, so the primitive's ordinary bottom border renders unchanged.
    [
      "a border image explicitly set to none",
      '<TabsTrigger style={{ borderImageSource: "none" }} />',
    ],
    // A constant holding `none` draws no border image, as the literal does.
    [
      "a border image whose none is written as a constant",
      'const noImage = "none";\n<TabsTrigger style={{ borderImageSource: noImage }} />',
    ],
    // Guards that are not spelled as booleans are still statically decided.
    [
      "a class literal behind a statically falsy non-boolean guard",
      '<TabsTrigger className={cn(0 && "border-b-0")} />',
    ],
    // A local component may reuse an imported name and is entitled to its own
    // appearance; the tag refers to the local binding, not the import.
    [
      "a class on a local component shadowing an imported name",
      'function Row() {\n  const TabsTrigger = (p: Record<string, unknown>) => <div {...p} />;\n  return <TabsTrigger className="border-b-0" />;\n}',
    ],
    // A local object may shadow a namespace import exactly as a local component
    // may shadow a named one; the tag refers to the local binding.
    [
      "a class on a namespace member shadowing an imported namespace",
      'import * as UI from "@nextlyhq/ui";\nfunction Row() {\n  const UI = { TabsTrigger: (p: Record<string, unknown>) => <div {...p} /> };\n  return <UI.TabsTrigger className="border-b-0" />;\n}',
    ],
    // In an object map the KEY is the class and the VALUE is the condition, so
    // a key switched off applies nothing.
    [
      "a class map entry switched off by its value",
      '<TabsTrigger className={cn({ "border-b-0": false })} />',
    ],
    // A `#` inside an attribute VALUE is data, not an id selector.
    [
      "an attribute value that merely contains a hash",
      '<TabsTrigger className="not-data-[foo=#bar]:opacity-100" />',
    ],
  ])("does not report %s", (_label, body) => {
    // The complement, and the reason this is a contract rather than a ban. A
    // check that flags a documented example or a legitimate layout class gets
    // switched off, and then it enforces nothing at all. Several of these are
    // load-bearing: real call sites depend on them.
    expect(violationsIn("probe.tsx", IMPORT + body)).toEqual([]);
  });

  it("does not read an inline style held under a name", () => {
    // Replaces a case that asserted WHICH declaration a style identifier
    // resolved to. Objects are no longer traced through bindings at all, so the
    // question that test answered is one the scan has stopped asking; what
    // matters now is that both spellings are reported rather than silently
    // resolved to the wrong one.
    const both = `${IMPORT}function a() { const s = { borderBottomColor: c }; return <TabsTrigger style={s} />; }
function b() { const s = { width: 2 }; return <TabsTrigger style={s} />; }`;

    expect(violationsIn("probe.tsx", both)).toHaveLength(2);
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

/**
 * The traversal reads every file a call site can live in.
 *
 * A scan is only as wide as its extension list, and an extension it does not
 * name is a call site it never reads. That gap is invisible from the outside:
 * the repository-wide contract still passes, and so does a control that counts
 * how many files were scanned, because the `.tsx` files it counts are all still
 * there. Only asking the traversal directly separates the two.
 */
describe("which files the call-site scan reads", () => {
  it("reads .jsx as well as .tsx, and nothing that cannot hold an element", () => {
    const dir = mkdtempSync(join(tmpdir(), "tabs-scan-"));
    try {
      for (const name of ["a.tsx", "b.jsx", "c.ts", "d.js", "e.css"]) {
        writeFileSync(join(dir, name), "");
      }

      // Generated output, which reading JavaScript would otherwise pull in by
      // the thousand on any machine where the playground has been built.
      mkdirSync(join(dir, ".next"));
      writeFileSync(join(dir, ".next", "chunk.js"), "");

      // And a route that happens to be NAMED like an output directory. Pruning
      // by basename would drop this, which is a call site going silently
      // unread — the failure the pruning list is supposed to prevent, caused by
      // the pruning list.
      mkdirSync(join(dir, "build"));
      writeFileSync(join(dir, "build", "page.js"), "");

      // `dist` is the same shape and was pruned by name anyway. Both spellings
      // are here because they fail apart: this one has no `package.json`
      // beside it, so it is a route rather than build output.
      mkdirSync(join(dir, "dist"));
      writeFileSync(join(dir, "dist", "page.js"), "");

      // The same name WITH a manifest beside it is a package's build output,
      // and stays pruned. Without this the fix reads as "never prune dist",
      // which would walk every built package in the repository.
      mkdirSync(join(dir, "pkg"));
      writeFileSync(join(dir, "pkg", "package.json"), "{}");
      mkdirSync(join(dir, "pkg", "dist"));
      writeFileSync(join(dir, "pkg", "dist", "bundle.js"), "");

      const found = sourceFiles(dir).map(path => path.slice(dir.length + 1));

      expect(found.sort()).toEqual(
        [
          "a.tsx",
          "b.jsx",
          "d.js",
          join("build", "page.js"),
          join("dist", "page.js"),
        ].sort()
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("covers every scan root and extension in both Turbo tasks", () => {
    // The traversal and the cache have to agree about which files matter. An
    // extension or a root the scan reads but the hash does not cover is a file
    // that can change while Turbo replays a cached green, and a replayed pass
    // is indistinguishable from one that ran.
    //
    // `turbo.json` is static JSON and cannot import the lists above, so the
    // agreement is asserted here rather than assumed.
    //
    // Every ROOT-and-extension pair, not merely every extension: a glob for
    // `packages/**/*.js` says nothing about a call site under `apps`, and a
    // check that only asks "is this extension mentioned anywhere" stays green
    // while half the coverage is gone.
    const config = JSON.parse(
      readFileSync(resolve(HERE, "../../../turbo.json"), "utf8").replace(
        // The file carries `//` comments, which `JSON.parse` rejects.
        /^\s*\/\/.*$/gm,
        ""
      )
    ) as { tasks: Record<string, { inputs?: string[] }> };

    // Derived from the roots the traversal actually walks, so a root added
    // there cannot be forgotten here. `templates` is covered by a single broad
    // glob rather than per-extension ones, which is why a root is satisfied by
    // EITHER spelling: what matters is that every file the scan reads is
    // hashed, not how the glob is written.
    const satisfies = (inputs: Set<string>, root: string): string[] => {
      if (inputs.has(`$TURBO_ROOT$/${root}/**`)) return [];
      return CALL_SITE_EXTENSIONS.map(
        extension => `$TURBO_ROOT$/${root}/**/*${extension}`
      ).filter(glob => !inputs.has(glob));
    };

    // Both tasks: a gap in either replays a stale result for that task alone.
    for (const task of ["test", "test:coverage"]) {
      const inputs = new Set(config.tasks[task]?.inputs ?? []);
      const missing = SCAN_ROOT_NAMES.flatMap(root => satisfies(inputs, root));

      // The missing globs are named, because this rule is only ever broken by
      // someone adding an extension or a root who does not know the second
      // task list exists — and a bare `false` tells them nothing.
      expect({ task, missing }).toEqual({ task, missing: [] });
    }
  });

  it("reruns in watch mode for every root and extension it reads", async () => {
    // The scan reaches call sites with `readFileSync`, so Vitest has no module
    // dependency on them: without an explicit trigger a watch session keeps
    // displaying the previous green after a real violation is added.
    //
    // Both halves matter, and the ROOT half is the one that is easy to miss.
    // The triggers are resolved relative to this package, so a glob under
    // `**/src` subscribes to `packages/ui` alone — a call site in
    // `packages/admin`, an app or a template could gain a violation and the
    // suite reporting on it would never rerun.
    // The REAL triggers and the REAL matcher, on REAL paths.
    //
    // Each of those three is what makes the answer mean anything. The config is
    // IMPORTED rather than parsed, so the assertion reads the value Vitest
    // loads instead of a rendering of it. picomatch is resolved THROUGH Vitest,
    // so the matcher here is the one that decides at runtime and cannot drift
    // to a different version. And the paths are ABSOLUTE, because absolute is
    // what the watcher emits: a glob is only covering a file if it matches the
    // string the matcher is actually handed.
    const { default: config } = (await import("../../../vitest.config")) as {
      default: { test?: { forceRerunTriggers?: string[] } };
    };
    const triggers = config.test?.forceRerunTriggers ?? [];
    const fromHere = createRequire(import.meta.url);
    const isMatch = fromHere(
      fromHere.resolve("picomatch", {
        paths: [dirname(fromHere.resolve("vitest/package.json"))],
      })
    ).isMatch as (path: string, globs: string[]) => boolean;

    // A negative control first, so a matcher that says yes to everything — the
    // one way every assertion below could pass while covering nothing — is
    // caught before its answers are trusted. A Markdown file is read by no
    // scan and must not trigger a rerun.
    expect(isMatch(resolve(REPO, "packages/ui/README.md"), triggers)).toBe(
      false
    );

    // Every root-and-extension pair the scan CAN read, whether or not the
    // repository currently holds such a file.
    //
    // Checking only the files that exist today is an assertion satisfied by
    // absence: there is no `.jsx` call site anywhere under a scan root, so
    // removing `jsx` from every trigger left this case green while the next
    // `.jsx` file added would change without rerunning the suite. The pairs are
    // derived from the same two lists the traversal uses, so a root or an
    // extension added there arrives here on its own.
    //
    // Both depths, because they fail differently: a `**/src/**` trigger covers
    // the nested one and silently misses a file directly under the root.
    // Three depths, because they fail differently and each one has a trigger
    // shape that covers the others and misses it: a `**/src/**` glob covers the
    // nested file and misses the package-level one, and a glob requiring at
    // least one child directory covers both and misses a file sitting directly
    // in the root — which `sourceFiles` reaches, since it recurses from the
    // root itself rather than from the packages inside it.
    const probes = SCAN_ROOT_NAMES.flatMap(root =>
      CALL_SITE_EXTENSIONS.flatMap(extension => [
        resolve(REPO, root, `probe-package/src/nested/probe${extension}`),
        resolve(REPO, root, `probe-package/probe${extension}`),
        resolve(REPO, root, `probe${extension}`),
      ])
    );
    const unwatchedProbes = probes
      .filter(path => !isMatch(path, triggers))
      .map(path => path.replace(`${REPO}/`, ""));
    expect(unwatchedProbes).toEqual([]);

    // Matching is only HALF the mechanism, and the half that was never checked
    // is the one that failed three times: Vitest reruns when its watcher emits
    // an event AND a trigger matches the path. The server is rooted at this
    // package, so nothing outside it was watched at all and the matcher was
    // never consulted for the call sites this suite reads.
    //
    // chokidar removed glob support in v4, so a watched entry has to be a REAL
    // PATH. That is what this asserts, and it is what separates the three
    // broken generations from the working one: `../**/*.tsx` is not a path,
    // `<root>/packages/**/*.tsx` is not a path, `<root>/packages` is.
    const watched: string[] = [];
    const plugins = (config as { plugins?: unknown[] }).plugins ?? [];
    for (const plugin of plugins) {
      const configureServer = (
        plugin as { configureServer?: (server: unknown) => void }
      ).configureServer;
      configureServer?.({
        watcher: { add: (path: string) => watched.push(path) },
      });
    }

    // Proves the hook ran at all before anything is concluded from what it
    // recorded: an empty list would otherwise satisfy every assertion below.
    expect(watched.length).toBeGreaterThan(0);

    const notReal = watched.filter(path => !existsSync(path));
    expect(notReal).toEqual([]);

    const unwatchedRoots = SCAN_ROOTS.filter(
      root =>
        !watched.some(path => root === path || root.startsWith(`${path}/`))
    ).map(root => root.replace(`${REPO}/`, ""));
    expect(unwatchedRoots).toEqual([]);

    // And every file the scan actually reads, which covers shapes no synthetic
    // path anticipates. Named individually: the list is only ever wrong for a
    // whole tree at a time, and a bare count says nothing about which.
    const unwatched = scanned().filter(file => !isMatch(file, triggers));
    expect(unwatched).toEqual([]);
  });

  it("treats complementary states as unable to apply together", () => {
    // Asserted on the coexistence test directly, because through `violationsIn`
    // it cannot be isolated: every disjoint pair in this primitive's vocabulary
    // also meets a rule it genuinely DOES coexist with, so the call site is
    // reported either way and the outcome cannot separate the two causes.
    // `data-[state=active]:border-transparent` is the worked example — it is
    // disjoint from the inactive border, and at the same time a real override
    // of `hover:border-primary`, which an active hovered tab matches.
    //
    // Both spellings the vocabulary produces, taken from what Tailwind actually
    // compiles rather than from how the variants are written:
    //   `not-disabled:` -> `&:not(*:disabled)`   against `&:disabled`
    //   `data-[state=active]:` -> `&[data-state="active"]`
    expect(excludeEachOther("&:not(*:disabled)", "&:disabled")).toBe(true);
    expect(
      excludeEachOther('&[data-state="active"]', '&[data-state="inactive"]')
    ).toBe(true);

    // An ancestor's qualifier is not the subject's. A disabled tab inside a
    // group that is NOT disabled matches both rules, so they coexist and the
    // comparison has to run — `group-not-disabled:` compiles the negation into
    // a descendant group, where it describes the group and not the tab.
    expect(
      excludeEachOther("&:is(:where(.group):not(*:disabled) *)", "&:disabled")
    ).toBe(false);

    // The positive control. Without it a test that answered `true` to
    // everything would pass both cases above, and every comparison in the
    // contract would be silently skipped as "cannot apply together".
    expect(excludeEachOther("&:hover", '&[data-state="active"]')).toBe(false);
    expect(
      excludeEachOther('&[data-state="active"]', '&[data-state="active"]')
    ).toBe(false);
  });

  it("finds a violation behind a CommonJS require", () => {
    // `.js` and `.jsx` are scanned, so a CommonJS consumer reaches this
    // primitive exactly as an ESM one does and is held to the same contract.
    const source =
      'const { TabsTrigger } = require("@nextlyhq/ui");\n' +
      '<TabsTrigger className="border-b-0" />';

    expect(violationsIn("probe.js", source)).not.toEqual([]);
  });

  it("finds a violation in a .jsx call site", () => {
    // The positive control the extension list exists for. Parsed as TSX, which
    // handles JSX, so the only thing that decides this is whether the file was
    // read at all.
    const source =
      'import { TabsTrigger } from "@nextlyhq/ui";\n' +
      '<TabsTrigger className="border-b-0" />';

    expect(violationsIn("probe.jsx", source)).not.toEqual([]);
  });
});
