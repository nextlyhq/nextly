// Which appearance the tab primitive owns, and whether a class or an inline
// style takes it over. The CSS half of the `tab-indicator` lint rule: pure
// questions over class strings and property names, answered by Tailwind's own
// design system rather than by a hand-kept table. The rule that finds call
// sites and asks these questions is `call-sites.mjs` beside this file.
//
// `Tabs` is an underline control: the active state is a 2px bottom border on
// the trigger, and the trigger is square so that border runs flush to its
// edges. The primitive applies the border, both state colours, the hover
// colour, the focus ring and the disabled treatment, so a call site that
// restates any of them owns a second copy of one appearance, and the copies
// drift the moment either changes.
//
// WHETHER A CLASS OVERRIDES IS NOT DECIDED BY A LIST. Enumerating forbidden
// utilities failed four times: `border-b-0` was covered while `border-0`,
// `border-y-0`, `border-[0px]` and a bare `border-b` all removed the underline
// and read as clean, as did `rounded`. Tailwind decides what spells an
// override, and it adds utilities, so each class is compiled and what it
// declares is compared with what the primitive declares.
//
// LAYOUT overrides stay allowed and fall out of the same mechanism: `w-full`,
// `px-0`, `justify-start`, `gap-0` and a per-state surface tint displace
// nothing the primitive owns.
//
// Everything here is computed when the module loads, from the BUILT
// `@nextlyhq/ui` and its stylesheet, which is why lint needs a build first as
// every type-aware rule already does. Without that build the rule refuses
// every element that renders the primitive, rather than answering from nothing,
// which would make every call site read as clean; the plugin still loads, so a
// hook linting other files on a fresh checkout is not stopped by it.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** The package that owns the primitive, and what its own code resolves. */
const UI_ROOT = resolve(REPO, "packages/ui");
const fromUi = createRequire(resolve(UI_ROOT, "package.json"));

/**
 * The appearance the primitive declares, taken from what it RENDERS.
 *
 * Rendered rather than read out of the source, because the question is what the
 * component applies: a class sitting in a dead constant or a comment is not
 * appearance, and a witness that greps the file cannot tell the two apart.
 *
 * Rendered from the package's build, through the package's own React, so the
 * element is the one a consumer gets. A build that is missing or stale fails
 * here, by name, rather than leaving an owned set that describes nothing.
 */
function renderedClasses(slot) {
  const { createElement } = fromUi("react");
  const { renderToStaticMarkup } = fromUi("react-dom/server");
  const { Tabs, TabsList, TabsTrigger } = fromUi("@nextlyhq/ui");
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
 * The primitive's full class list also carries layout (`inline-flex`, `h-10`,
 * `px-4`), which a surface is entitled to change, so the owned set is the
 * appearance half of it. Selected by concern rather than listed, so a change to
 * the primitive's colours or spacing moves this with it.
 */
const APPEARANCE =
  /(?:^|:)(?:-?mb-|border|rounded)|^(?:data-\[state=|hover:|focus-visible:|disabled:)/;

function ownedClassesOf(slot) {
  return renderedClasses(slot)
    .split(/\s+/)
    .filter(Boolean)
    .filter(c => APPEARANCE.test(c));
}

/**
 * Why the primitive cannot be asked, when its build is missing; undefined when
 * it can. Resolving the package's entry is what fails before a build.
 */
export const UNAVAILABLE = (() => {
  try {
    fromUi.resolve("@nextlyhq/ui");
    return undefined;
  } catch {
    return "@nextlyhq/ui is not built, so the appearance its Tabs own cannot be read: run `pnpm build` first";
  }
})();

/** The owned classes of each component, by exported name. */
const OWNED_BY_SLOT = UNAVAILABLE
  ? { TabsList: [], TabsTrigger: [] }
  : {
      TabsList: ownedClassesOf("tabs-list"),
      TabsTrigger: ownedClassesOf("tabs-trigger"),
    };

// The structural witness. The rule exists only because the primitive draws an
// indicator; if it stops, or the render above finds no element, the rule is not
// merely unscoped but meaningless, and loading fails rather than passing every
// call site.
if (
  !UNAVAILABLE &&
  (!OWNED_BY_SLOT.TabsTrigger.includes("border-b-2") ||
    !OWNED_BY_SLOT.TabsTrigger.some(c => /^data-\[state=active\]:/.test(c)) ||
    !OWNED_BY_SLOT.TabsList.includes("rounded-none"))
) {
  throw new Error(
    `tab-indicator: the rendered Tabs primitive no longer draws the indicator this rule protects (owned: ${JSON.stringify(OWNED_BY_SLOT)}). Rebuild @nextlyhq/ui, or update the rule with the primitive.`
  );
}

/**
 * The compiled design system, loaded once.
 *
 * Built from the package's real stylesheet rather than a bare
 * `@import "tailwindcss"`, because the primitive's appearance is written in
 * theme tokens: against stock Tailwind, `text-primary` and `border-b-primary`
 * compile to nothing at all and every owned colour would silently claim no
 * properties. The check after `ownedCssProperties` below turns that into a
 * failure to load rather than a quiet loss of coverage.
 */
async function loadDesignSystem() {
  const { __unstable__loadDesignSystem } = fromUi("tailwindcss");
  const entry = resolve(UI_ROOT, "src/styles/index.css");
  return __unstable__loadDesignSystem(readFileSync(entry, "utf8"), {
    base: dirname(entry),
    loadStylesheet: async (id, base) => {
      const path = id.startsWith(".")
        ? resolve(base, id)
        : createRequire(`${base}/`).resolve(
            id === "tailwindcss" ? "tailwindcss/index.css" : id
          );
      return { base: dirname(path), path, content: readFileSync(path, "utf8") };
    },
  });
}

const designSystem = await loadDesignSystem();

/** The same class list with every important marker removed. */
function withoutImportance(classes) {
  return classes.replace(/!/g, "");
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
function splitAtDepthZero(text) {
  const parts = [];
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
/**
 * A class as the parts the comparisons read: its `variants`
 * (`data-[state=active]`, `hover`, ...), its `bare` utility with variants and
 * importance removed (`border-b-0`), whether it is `important`, and the `full`
 * class exactly as written.
 *
 * `full` is kept because two questions need different halves of it. Which
 * utility BEATS which is decided on the bare form, since importance and
 * variants are compared separately. Which properties it TOUCHES has to be asked
 * of the whole class: the variant is what carries the selector, and compiling
 * `border-b-0` alone cannot show that `[&>span]:border-b-0` lands on a child.
 */
function utilityOf(cls) {
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
function referencesParent(selector) {
  return /(^|[^\\])&/.test(selector);
}
function splitTopLevel(text, separator) {
  const parts = [];
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
function subjectOf(selector) {
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
function retargets(selector) {
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
function partition(block) {
  const rules = [];
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
function hostCss(block) {
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
const EQUIVALENT_VARIANTS = {
  "data-[disabled]": "disabled",
  "data-[state=checked]": "checked",
  "aria-[disabled=true]": "disabled",
};
function normaliseVariant(variant) {
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
function wins(owned, caller) {
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
const ZERO = [0, 0, 0];
function add(a, b) {
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
function specificityOf(selector) {
  const functional = FUNCTIONAL.exec(selector);
  return functional
    ? functionalSpecificity(selector, functional)
    : plainSpecificity(selector);
}

/** A selector whose first functional pseudo-class `functional` matched. */
function functionalSpecificity(selector, functional) {
  const open = functional.index + functional[0].length;
  const close = pastClosingParen(selector, open);
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

/** The index just past the `)` that closes the group opened before `open`. */
function pastClosingParen(selector, open) {
  let depth = 1;
  let close = open;
  while (close < selector.length && depth > 0) {
    if (selector[close] === "(") depth += 1;
    else if (selector[close] === ")") depth -= 1;
    close += 1;
  }
  return close;
}

/** How many times `pattern` (global) occurs in `text`. */
function occurrences(text, pattern) {
  return text.match(pattern)?.length ?? 0;
}

/** A selector with no functional pseudo-class left in it. */
function plainSpecificity(selector) {
  // An attribute selector counts as ONE, and what it holds is data: a `#` or a
  // `.` inside `[data-foo="#bar"]` is a character in a value, not an id or a
  // class. Counted verbatim it inflated the caller's rank and overrode a
  // source-order result that had already decided the question.
  const attributes = occurrences(selector, /\[[^\]]*\]/g);
  const structure = selector.replace(/\[[^\]]*\]/g, "");
  const classes =
    occurrences(structure, /(?<!\\\\)&/g) +
    occurrences(structure, /\.[\w-]+/g) +
    attributes +
    occurrences(structure, /(?<!:):[\w-]+/g);
  return [
    occurrences(structure, /#[\w-]+/g),
    classes,
    occurrences(structure, /::[\w-]+/g),
  ];
}
function compare(a, b) {
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}
/** The selector of a compiled utility's host rule, as Tailwind wrote it. */
function hostSelectorOfUncached(cls) {
  const css = compiled(cls);
  if (css == null) return "";
  const nested = block => {
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
function declarationsOfUncached(cls) {
  const css = compiled(cls);
  if (css == null) return new Map();
  const body = `;${hostCss(css.replace(AT_PROPERTY, ""))}`;
  const found = new Map();
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
function disagree(owned, caller) {
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
function expandDeclarations(declarations) {
  const flat = new Map();
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
function fillsSharedCanvas(value, own) {
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
function exclusiveDeclarationsUncached(cls) {
  const declarations = declarationsOf(cls);
  const own = new Set(declarations.keys());
  const exclusive = new Map();
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
function restates(owned, caller) {
  // An UNQUALIFIED caller declaration against a STATE-QUALIFIED owned one is
  // not a second copy of anything, and this is the one pairing where the
  // restatement route was wrong.
  //
  // `disabled:opacity-50` styles a state; a caller's plain `opacity-50`
  // states the base. They name the same declaration in different
  // circumstances: the variant rule is more specific and still wins while
  // disabled, and if the primitive later fades to `opacity-40` the owned rule
  // keeps winning there, so nothing the caller wrote suppresses the change.
  // Reporting it asked whether two declarations look alike rather than
  // whether one takes the other over.
  //
  // A caller carrying its OWN variant is the case this route exists for, and
  // it stays: `aria-[controls]:outline-none` beside an owned
  // `focus-visible:outline-none` is one appearance written twice for two
  // states, and the copies drift the moment either changes. A caller carrying
  // the owned variants exactly is already decided by `asQualified` above.
  if (owned.variants.length > 0 && caller.variants.length === 0) return false;
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
function withoutAncestorQualifiers(selector) {
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
function excludeEachOther(whole, other) {
  const a = withoutAncestorQualifiers(whole);
  const b = withoutAncestorQualifiers(other);
  const negatedIn = selector =>
    [...selector.matchAll(/:not\(([^)]*)\)/g)].map(match =>
      // A leading `*` is the universal selector Tailwind writes inside the
      // negation — `not-disabled:` compiles to `&:not(*:disabled)` while the
      // required side is a bare `&:disabled`. Compared verbatim the two never
      // met, so the clearest disjoint pair in the vocabulary read as coexisting.
      (match[1] ?? "").trim().replace(/^\*/, "")
    );
  const requires = (selector, qualifier) =>
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
function complementaryStates(a, b) {
  // Matched on a boundary so `:enabled` is not found inside a longer name, and
  // read outside any negation, which the test above already compares.
  const has = (selector, state) =>
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
function attributesConflict(a, b) {
  const required = selector => {
    const found = new Map();
    for (const match of selector
      .replace(/:not\([^)]*\)/g, "")
      .matchAll(/\[([a-zA-Z0-9_-]+)\s*=\s*"([^"]*)"\]/g)) {
      const name = match[1] ?? "";
      const values = found.get(name) ?? new Set();
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
function emittedAfter(owned, caller) {
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
function outranks(owned, caller) {
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
function takesOver(owned, caller) {
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
function dependenciesOfUncached(cls) {
  const css = compiled(cls);
  if (css == null) return [];
  const declarations = declarationsOf(cls);
  const own = new Set(declarations.keys());
  const found = new Set();
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

/** Which of a component's owned classes a caller's `className` takes over. */
function displacedBy(exported, classes) {
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
function setBy(css) {
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
function readBy(css) {
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
function perClass(answer) {
  const cache = new Map();
  return cls => {
    if (cache.has(cls)) return cache.get(cls);
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
const compiledCache = new Map();
function compiled(bare) {
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
function propertiesOfUncached(cls) {
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
function reachedByUncached(cls) {
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
let ownedProperties;
function ownedCssProperties() {
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
function expandsTo(property, value) {
  const kebab = property.replace(/([A-Z])/g, "-$1").toLowerCase();
  // A border IMAGE replaces what the border draws, on every edge it covers.
  // Checked before the shorthand split because it is not one: `border-image`
  // names no edge and no aspect, so the pattern below does not match it and it
  // stood for itself — a name that intersects nothing the primitive owns, while
  // a gradient painted straight over the underline on every tab.
  if (BORDER_IMAGE.test(kebab)) {
    // `none` is the initial value of `border-image-source`, so it supplies no
    // image and the primitive's ordinary border renders exactly as it did.
    // Owning the property whatever it holds reported the spelling that draws
    // NOTHING.
    //
    // `initial` is the same state named a different way: CSS defines it as
    // "reset to the initial value", which for this property IS `none`. Matching
    // the one spelling asked how the value was written rather than what it
    // does, and reported a call site that covers nothing.
    // `initial` and `unset` both name the initial value, which for
    // `border-image-source` IS `none`. They differ only for INHERITED
    // properties, where `unset` means `inherit` -- and this one is not
    // inherited, so both supply no image and cover nothing.
    const drawn = value?.trim().toLowerCase();
    if (drawn === "none" || drawn === "initial" || drawn === "unset") {
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
function ownsStyleProperty(slot, property, value) {
  const owned = ownedCssProperties()[slot];
  if (!owned) return false;
  const kebab = property.replace(/([A-Z])/g, "-$1").toLowerCase();
  if (kebab === RESETS_EVERYTHING) return owned.size > 0;
  return expandsTo(property, value).some(p => owned.has(p));
}

// The instrument check for the inline half. The style oracle is derived from
// these mappings, so an owned class matching none of them silently narrows what
// an inline style is checked against: the geometry stayed covered that way
// while the focus ring, the ink and the disabled treatment were not, though the
// contract claims all five. Refused at load, for the same reason as the witness
// above.
const unmapped = Object.values(OWNED_BY_SLOT)
  .flat()
  .filter(cls => reachedBy(cls).length === 0);
if (
  !UNAVAILABLE &&
  (unmapped.length > 0 ||
    Object.values(ownedCssProperties()).some(
      properties => properties.size === 0
    ))
) {
  throw new Error(
    `tab-indicator: the design system maps no CSS to ${JSON.stringify(unmapped)}. The stylesheet in packages/ui/src/styles may have stopped loading its theme.`
  );
}

export { displacedBy, excludeEachOther, ownedCssProperties, ownsStyleProperty };
