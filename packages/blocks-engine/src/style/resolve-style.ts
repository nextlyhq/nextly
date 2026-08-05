// Where a style value came from.
//
// Once a value can come from a class, an author looking at a control cannot tell whether what
// they see is theirs, a class's, or the block's — and if they cannot tell, they change the wrong
// thing. Every builder that added classes had to add this answer with them; the ones that did not
// are the ones whose users describe styling as guesswork.
//
// This walks the same order the compiler emits, and that is the load-bearing property. If the two
// could disagree, the indicator would describe a page the browser is not rendering, which is
// worse than no indicator at all: it would be confidently wrong.
//
// So the shape here mirrors the compiler's rather than paraphrasing it. The compiler holds ONE
// ordered list of breakpoint contexts and writes every matching rule in that order; it has no
// notion of a chain. Modelling this side as a single chain from the breakpoint being edited was
// the mistake: a chain has one end, and a page can be responding to a viewport width and a
// container width simultaneously, with both sets of rules live. The two axes are therefore taken
// separately and merged in the compiler's order, which `BREAKPOINT_AXES` states once for both.
//
// Pure by construction: no storage, no registry, no compiler state. The inspector calls it per
// control on every render, tests call it without booting an engine, and an agent can ask it what
// a page means without executing anything.

import type { NodeStyles, StyleState, StyleValue } from "../document";
import { isTokenRef, STYLE_STATES } from "../document";
import { isPlainRecord } from "../plain-record";

import { BREAKPOINT_AXES } from "./breakpoint-axes";
import {
  compositeFieldNames,
  declarationsCovered,
  cssPropertiesForField,
  propertiesAlsoMatching,
  declarationsWritten,
  propertyDescendantSelector,
  propertyInheritsToDescendants,
  propertyPseudoClassCount,
  propertyUsesDescendantSelector,
} from "./catalog";
import { compileStyleValues } from "./declarations";
import type { NamedClass } from "./named-class";
import { isUsableNamedClass, orderedNamedClasses } from "./named-class";

/** Which tier a resolved value came from, and which member of that tier. */
export type StyleSource =
  /** The node's own value. What a control edits by default. */
  | { tier: "local" }
  /** A class the node applies. `id` is the class, so the UI can offer to edit it in place. */
  | { tier: "class"; id: string; slug: string }
  /** The block type's default look. */
  | { tier: "blockDefault" }
  /**
   * The page's own styles, reaching this node from the page root.
   *
   * Not a rule on the node at all: it is written once on the root, and shows here only because
   * nothing closer states the property. Reported so a control over a visibly coloured page does
   * not present itself as empty.
   */
  | { tier: "pageSettings" }
  /**
   * An ancestor node, whose value reaches this one because nothing closer states the property.
   *
   * `nodeId` names which ancestor, so a control can offer to jump to it — the value cannot be
   * changed here, and saying only "inherited" leaves an author hunting for where. The wrapped
   * source says how that ancestor got it, since an ancestor's colour can itself come from a class.
   */
  | { tier: "ancestor"; nodeId: string; source: StyleSource }
  /**
   * A breakpoint other than the one being edited, whose rule is also live.
   *
   * Desktop-first: a node styled at base and viewed at tablet shows the base value unless tablet
   * says otherwise. Naming the breakpoint it came from is what lets a control say "inherited from
   * Desktop" rather than showing an empty field over a page that plainly has the value.
   *
   * It also covers the other axis: while editing a container breakpoint, a live viewport rule can
   * be the winner, and `from` names it.
   */
  | { tier: "inheritedBreakpoint"; from: string; source: StyleSource };

/** A resolved value and where it came from. */
export interface ResolvedStyle {
  value: StyleValue;
  /**
   * Where the whole value came from.
   *
   * Absent only when a composite property survived from more than one tier at once, which the
   * stylesheet permits: the fields are separate declarations, so a later rule overrides the ones
   * it names and leaves the rest standing. Read `parts` in that case — naming one winner would
   * mean picking a tier that did not supply what the control is showing.
   */
  source?: StyleSource;
  /**
   * For a composite property, where each field came from, keyed as the value is.
   *
   * Present whenever the value is a record, even if one tier supplied all of it, so a caller can
   * read per-field provenance without first testing which case it is in. A field that is itself
   * composite carries its own `parts`.
   */
  parts?: Record<string, ResolvedStyle>;
}

/**
 * What one element contributes, in the three tiers a single node has.
 *
 * The same shape for the node being inspected and for every ancestor above it, because an
 * ancestor's colour is decided exactly the way this node's is — its own value over its classes
 * over its block's default. Modelling an ancestor as a bare style envelope would miss the case
 * where the parent gets its colour from a class, which is the common one.
 */
export interface StyledNode {
  /**
   * The block type, needed only for the properties that write to a descendant selector.
   *
   * The compiler emits one block-default rule per type, sorted by type name, so which of two
   * block defaults wins on a link inside a nested block is decided by the names — not by which
   * block is the ancestor. Without it those rules can only be ordered by depth, which is a
   * different answer.
   */
  blockType?: string;
  /** The node's own styles. */
  node?: NodeStyles;
  /** The classes the node applies, already in library order (see `resolveNodeClasses`). */
  classes?: readonly NamedClass[];
  /** The block type's base styles. */
  blockBase?: NodeStyles;
}

/** An ancestor of the node being inspected, and how it is styled. */
export interface AncestorNode extends StyledNode {
  /** Which ancestor, so a control can say where an inherited value actually lives. */
  nodeId: string;
}

/** Everything resolution reads. Supplied by the caller; nothing is fetched. */
export interface StyleResolutionInput extends StyledNode {
  /**
   * The page's styles, from `doc.settings.styles`.
   *
   * The outermost thing a node can inherit from: written on the page root, and reaching this node
   * only because nothing closer states the property.
   */
  pageSettings?: NodeStyles;
  /**
   * The ancestors between the page root and this node, **outermost first**, ending at the direct
   * parent.
   *
   * Inheritance does not stop at the page. The compiler writes a parent's `color` on the parent's
   * own selector and every descendant that states nothing shows it, so a resolver that knows only
   * about this node and the page reports nothing for a value plainly on screen.
   *
   * Read only for properties that travel, and always beneath this node's own tiers: an inherited
   * value loses to any declaration on the element itself, whatever the source order.
   */
  ancestors?: readonly AncestorNode[];
  /**
   * The viewport breakpoints whose rules are live, widest first, **including the active one**.
   *
   * Every `@media (max-width: …)` at least as wide as the current viewport matches at once, and
   * the compiler writes them widest to narrowest, so this is that list in that order. A site with
   * base/tablet/mobile viewed at mobile passes `["base", "tablet", "mobile"]`.
   *
   * Omitting both chains means the caller is not modelling breakpoints, and the breakpoint asked
   * about is treated as the only live one.
   */
  viewportChain?: readonly string[];
  /**
   * The container breakpoints whose rules are live, widest first, **including the active one**.
   *
   * Read after the viewport chain, because that is the order the stylesheet is written in. See
   * `BREAKPOINT_AXES`.
   */
  containerChain?: readonly string[];
}

/**
 * One tier's styles, in the order they override one another.
 *
 * Lowest first, so a later entry beats an earlier one — the same direction `compile-page` emits
 * in, because at one specificity the cascade is source order and nothing else.
 *
 * Page settings sit below the block default, and for a different reason than the rest: they are
 * not a competing declaration on this element but a value reaching it from an ancestor, and an
 * inherited value loses to any declaration on the element itself whatever the source order.
 */
function nodeTiers(
  styled: StyledNode
): { styles: NodeStyles; source: StyleSource }[] {
  const ordered: { styles: NodeStyles; source: StyleSource }[] = [];
  if (styled.blockBase) {
    ordered.push({
      styles: styled.blockBase,
      source: { tier: "blockDefault" },
    });
  }
  for (const cls of styled.classes ?? []) {
    // The compiler writes nothing for a class it cannot name, so applying one here would report
    // a value and a source the browser never receives.
    if (!isUsableNamedClass(cls)) continue;
    ordered.push({
      styles: cls.styles,
      source: { tier: "class", id: cls.id, slug: cls.slug },
    });
  }
  if (styled.node)
    ordered.push({ styles: styled.node, source: { tier: "local" } });
  return ordered;
}

/** An ancestor's tier, labelled so a control can say which ancestor and how that one got it. */
function ancestorTier(
  ancestor: AncestorNode,
  tier: { styles: NodeStyles; source: StyleSource }
): { styles: NodeStyles; source: StyleSource } {
  return {
    styles: tier.styles,
    // Wrapped rather than flattened: which ancestor it was, and how that ancestor came by it, are
    // different questions and a control may want to ask either.
    source: { tier: "ancestor", nodeId: ancestor.nodeId, source: tier.source },
  };
}

function tiers(
  input: StyleResolutionInput,
  property: string
): { styles: NodeStyles; source: StyleSource }[] {
  const ordered: { styles: NodeStyles; source: StyleSource }[] = [];
  const ancestors = input.ancestors ?? [];
  const inheritable = propertyInheritsToDescendants(property);
  if (inheritable && input.pageSettings) {
    ordered.push({
      styles: input.pageSettings,
      source: { tier: "pageSettings" },
    });
  }

  // A property that writes to a DESCENDANT selector is not inherited at all: an ancestor's
  // `.parent a` rule lands on this node's links directly, at the same specificity as this node's
  // own `.nx-c-card a`, so the two compete on source order rather than one being a fallback for
  // the other.
  //
  // And the compiler groups its output by TIER across the whole page — every block default, then
  // every class, then every node's own rules — so an ancestor's LOCAL rule is written after this
  // node's class rule and beats it. Ordering ancestors as a block before this node, which is what
  // inheritance means, gets that backwards.
  //
  // Measured, because it reads the other way round: a parent with a local `linkColor` beats a
  // child whose class sets one.
  if (propertyUsesDescendantSelector(property)) {
    const chain: readonly (StyledNode | AncestorNode)[] = [...ancestors, input];
    const label = (
      styled: StyledNode | AncestorNode,
      tier: { styles: NodeStyles; source: StyleSource }
    ): { styles: NodeStyles; source: StyleSource } =>
      "nodeId" in styled ? ancestorTier(styled, tier) : tier;

    // By type name, matching `usedTypes.sort()` in the compiler. A parent typed `z/parent` and a
    // child typed `a/child` put the CHILD default first and the parent's last, so the parent wins
    // on a link inside the child — the reverse of what depth would say. Entries with no type
    // keep their position, since nothing better is known about them.
    const defaults = chain.filter(styled => styled.blockBase !== undefined);
    const typed = defaults.filter(styled => styled.blockType !== undefined);
    const untyped = defaults.filter(styled => styled.blockType === undefined);
    typed.sort((a, b) => (a.blockType ?? "").localeCompare(b.blockType ?? ""));
    for (const styled of [...typed, ...untyped]) {
      if (styled.blockBase === undefined) continue;
      ordered.push(
        label(styled, {
          styles: styled.blockBase,
          source: { tier: "blockDefault" },
        })
      );
    }
    // Classes are emitted once each in library order, not once per node that applies them, so an
    // ancestor's class and this node's interleave by their own order rather than by whose it is.
    const applied: { cls: NamedClass; styled: StyledNode | AncestorNode }[] =
      [];
    for (const styled of chain) {
      for (const cls of styled.classes ?? []) {
        if (!isUsableNamedClass(cls)) continue;
        // One `.nx-c-* a` rule exists for a class however many nodes apply it, so when both an
        // ancestor and the inspected node apply it, the LAST occurrence is the one to keep:
        // reporting the ancestor sends an author to a parent when the class is right there on the
        // node they are editing.
        const already = applied.findIndex(seen => seen.cls.id === cls.id);
        if (already >= 0) applied.splice(already, 1);
        applied.push({ cls, styled });
      }
    }
    const inLibraryOrder = orderedNamedClasses(applied.map(entry => entry.cls));
    for (const cls of inLibraryOrder) {
      const entry = applied.find(seen => seen.cls.id === cls.id);
      if (entry === undefined) continue;
      ordered.push(
        label(entry.styled, {
          styles: cls.styles,
          source: { tier: "class", id: cls.id, slug: cls.slug },
        })
      );
    }
    for (const styled of chain) {
      if (styled.node === undefined) continue;
      ordered.push(
        label(styled, { styles: styled.node, source: { tier: "local" } })
      );
    }
    return ordered;
  }

  // Everything above this node is inheritance, which reaches it only for properties that travel
  // and always loses to a declaration on the element itself. Outermost first, so the nearest
  // ancestor is read last and wins — which is what "the closest one that says anything" means.
  if (inheritable) {
    for (const ancestor of ancestors) {
      for (const tier of nodeTiers(ancestor)) {
        ordered.push(ancestorTier(ancestor, tier));
      }
    }
  }
  ordered.push(...nodeTiers(input));
  return ordered;
}

/**
 * Every breakpoint whose rules are live, in the order the stylesheet writes them.
 *
 * Both axes, concatenated in `BREAKPOINT_AXES` order, which is what makes a container rule beat a
 * viewport one. An id appearing on both axes is kept at its first position, matching the compiler,
 * which claims ids across the two axes and drops the later definition.
 */
function liveBreakpoints(
  breakpoint: string,
  input: StyleResolutionInput
): string[] {
  const byAxis = {
    viewport: input.viewportChain,
    container: input.containerChain,
  };
  // Neither chain supplied is the non-responsive case, not an empty page: a caller asking about
  // one breakpoint without describing the others gets exactly that breakpoint, which is what
  // every call looked like before there was a second axis to describe.
  if (byAxis.viewport === undefined && byAxis.container === undefined) {
    return [breakpoint];
  }
  const live: string[] = [];
  const claimed = new Set<string>();
  for (const axis of BREAKPOINT_AXES) {
    for (const id of byAxis[axis] ?? []) {
      if (claimed.has(id)) continue;
      claimed.add(id);
      live.push(id);
    }
  }
  return live;
}

/** The value one tier states for a property at exactly this state and breakpoint, if any. */
function valuesAt(
  styles: NodeStyles,
  state: string,
  breakpoint: string
): Record<string, unknown> | undefined {
  // Read as a record rather than through the declared key types: persisted data reaches here
  // whether or not it matches them, and a state or breakpoint that is not one this site defines
  // is a normal thing to be handed and to find nothing under.
  if (!isPlainRecord(styles)) return undefined;
  const byBreakpoint = (styles as Record<string, unknown>)[state];
  if (!isPlainRecord(byBreakpoint)) return undefined;
  const values = byBreakpoint[breakpoint];
  return isPlainRecord(values) ? values : undefined;
}

/**
 * Whether the compiler would write this value, rather than merely whether it is present.
 *
 * Asks the compiler itself. An earlier version asked `validateStyleValues` instead, which is a
 * paraphrase and was wrong in both directions worth caring about: a token name the compiler
 * refuses in its own emission path — `{ $token: "bad name" }` — passes validation cleanly and
 * produces no declaration, so resolution reported an invalid local token while the browser showed
 * the tier below it.
 *
 * There is no version of that guard that stays correct, because it is a second copy of a decision
 * that lives somewhere else. Running the real one costs a compile of a single-entry map and
 * cannot drift.
 *
 * Asked per stated value, so the cost is one call per tier that mentions the property, not one
 * per property in the document.
 */
function compilerWrites(values: Record<string, unknown>): Set<string> {
  return new Set(
    compileStyleValues(values, "").declarations.map(
      // Keyed by selector AND property. Two catalog keys can write one CSS property to different
      // elements — `color` to the block, `linkColor` to an `a` inside it — so a set of bare
      // property names lets a sibling declaration vouch for a value the compiler refused: an
      // invalid root `color` looked written because `linkColor` had produced `a { color: … }`.
      declaration => `${declaration.descendant ?? ""}|${declaration.property}`
    )
  );
}

/** What the compiler wrote, with each shorthand also standing for the longhands it sets. */
function compilerWroteKeys(values: Record<string, unknown>): Set<string> {
  const keys = new Set<string>();
  for (const written of compilerWrites(values)) {
    const [descendant = "", css = ""] = written.split("|");
    for (const covered of declarationsCovered(css)) {
      keys.add(`${descendant}|${covered}`);
    }
  }
  return keys;
}

/** The keys a candidate writes that also belong to the property being asked about. */
function overlappingWrites(candidate: string, property: string): string[] {
  const wanted = new Set(declarationsWritten(property));
  const descendant = propertyDescendantSelector(candidate) ?? "";
  return declarationsWritten(candidate)
    .filter(css => wanted.has(css))
    .map(css => `${descendant}|${css}`);
}

/**
 * What survives when another catalog key overwrites part of this one.
 *
 * Dropped leaf by leaf rather than wholesale: two keys can overlap on one declaration and leave
 * the rest of a composite standing, and those fields keep both their value and the tier that set
 * them.
 */
function withoutOverwritten(
  current: Accumulated | undefined,
  property: string,
  path: readonly string[],
  overwritten: ReadonlySet<string>
): Accumulated | undefined {
  if (current === undefined) return undefined;
  if (current.kind === "whole") {
    return writeKeysFor(property, path).some(key => overwritten.has(key))
      ? undefined
      : current;
  }
  const kept = new Map<string, Accumulated>();
  for (const [name, held] of current.fields) {
    const survivor = withoutOverwritten(
      held,
      property,
      [...path, name],
      overwritten
    );
    if (survivor !== undefined) kept.set(name, survivor);
  }
  return kept.size === 0 ? undefined : { kind: "fields", fields: kept };
}

/** The keys a candidate property would produce, in the same form `compilerWrites` records. */
function writeKeysFor(property: string, path: readonly string[]): string[] {
  const descendant = propertyDescendantSelector(property) ?? "";
  return cssPropertiesForField(property, path).map(
    css => `${descendant}|${css}`
  );
}

/**
 * How strongly a rule from this tier, for this property, competes.
 *
 * Counted in class-selectors, which is what decides between two rules that both match. Every rule
 * is anchored at the doubled page root; a tier other than the page's own settings adds its own
 * class to that, and a property attaching to `a:hover` rather than `a` adds one more.
 *
 * This is why `linkColorHover` cannot be resolved on its own. Page settings' hover rule and a
 * class's plain link rule both come to three, so the later one wins, and the later one is the
 * class — meaning a hovered link shows the class's colour while the hover property is what the
 * author set. Measured from the emitted stylesheet, not reasoned about.
 */
function selectorWeight(source: StyleSource, property: string): number {
  let innermost = source;
  while (innermost.tier === "inheritedBreakpoint") innermost = innermost.source;
  const anchor = innermost.tier === "pageSettings" ? 2 : 3;
  return anchor + propertyPseudoClassCount(property);
}

/**
 * What has survived so far, at one property or one field of it.
 *
 * A composite property is not one declaration. `padding` is four, `border` is three, and the
 * compiler writes each field as its own, so a tier that states `blockStart` overrides that side
 * and leaves a lower tier's `blockEnd` on the page. Kept as a tree for exactly that reason:
 * collapsing it to a single winner reports the last writer as the source of fields it never set,
 * and hides the tier the author would have to edit to change them.
 */
type Accumulated =
  | { kind: "whole"; value: StyleValue; source: StyleSource }
  | { kind: "fields"; fields: Map<string, Accumulated> };

/**
 * Fold one tier's value into what earlier tiers left, field by field where both are records.
 *
 * Two cases stay coarser than the stylesheet, both requiring a shorthand and its longhands in
 * DIFFERENT tiers. A record over a scalar — `borderRadius: {…}` over `borderRadius: "4px"` —
 * replaces it here, where the browser keeps the shorthand for the corners the record does not
 * name; expanding it needs the catalog's leaf mapping rather than the stored shape. And a
 * composite carrying one invalid field is skipped whole, where the compiler drops only that
 * field. Both report a real tier and a real value, never an invented one.
 */
function fold(
  current: Accumulated | undefined,
  value: StyleValue,
  source: StyleSource,
  property: string,
  path: readonly string[],
  emitted: ReadonlySet<string>
): Accumulated | undefined {
  // A token reference is a record in storage and a VALUE in meaning. Descended into, its `$token`
  // key names no catalog leaf and the whole reference is refused.
  if (!isPlainRecord(value) || isTokenRef(value)) {
    // The compiler refuses a bad declaration one leaf at a time: `padding` with a valid
    // `blockStart` and a nonsense `blockEnd` still writes the first. Folding the whole record
    // would record the refused side too, and report it as the source over a lower tier the
    // browser is still showing there.
    //
    // A path with NO catalog leaf is refused for the same reason rather than waved through: the
    // compiler had nothing to write for it. Read as "no claim", a stored key the catalog does not
    // define — `padding: { blockStart: "16px", bogus: "4px" }` — reported `bogus` as a value with
    // a local source over a page carrying no such declaration.
    if (!writeKeysFor(property, path).some(key => emitted.has(key))) {
      return current;
    }
    return { kind: "whole", value, source };
  }
  // A record with no fields states no declarations, so it neither wins nor clears what is
  // already there — and where nothing is there it must not invent an empty one. Read out, that
  // would show a control as carrying a value the browser has no declaration for.
  const keys = Object.keys(value);
  if (keys.length === 0) return current;
  const fields = new Map<string, Accumulated>();
  if (current?.kind === "fields") {
    for (const [name, held] of current.fields) fields.set(name, held);
  } else if (current?.kind === "whole") {
    // A shorthand underneath a partial record. `borderRadius: "4px"` sets all four corners, and a
    // later `{ startStart: "8px" }` overrides exactly one, so the browser keeps 4px on the other
    // three. Replacing the shorthand outright would report only the corner that changed and leave
    // the three the lower tier is still painting with no source at all — so it is expanded into
    // the fields it stood for, and the record folds over that.
    for (const name of compositeFieldNames(property, path)) {
      fields.set(name, {
        kind: "whole",
        value: current.value,
        source: current.source,
      });
    }
  }
  for (const key of keys) {
    const folded = fold(
      fields.get(key),
      value[key],
      source,
      property,
      [...path, key],
      emitted
    );
    if (folded !== undefined) fields.set(key, folded);
  }
  return fields.size === 0 ? current : { kind: "fields", fields };
  return { kind: "whole", value, source };
}

/** Two sources are the same origin when they name the same tier and the same member of it. */
function sameSource(
  a: StyleSource | undefined,
  b: StyleSource | undefined
): boolean {
  if (a === undefined || b === undefined) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The accumulated tree, read out as the value a control shows and the origins behind it. */
function readOut(acc: Accumulated): ResolvedStyle {
  if (acc.kind === "whole") return { value: acc.value, source: acc.source };
  const value: Record<string, StyleValue> = {};
  const parts: Record<string, ResolvedStyle> = {};
  let common: StyleSource | undefined;
  let shared = true;
  for (const [key, field] of acc.fields) {
    const resolved = readOut(field);
    value[key] = resolved.value;
    parts[key] = resolved;
    if (common === undefined) common = resolved.source;
    else if (!sameSource(common, resolved.source)) shared = false;
    if (resolved.source === undefined) shared = false;
  }
  return {
    value,
    parts,
    ...(shared && common !== undefined ? { source: common } : {}),
  };
}

/**
 * What a property resolves to, and where it came from.
 *
 * Walked tier-outermost, breakpoint-innermost, because that is the order the stylesheet is
 * written in and at one specificity the order IS the cascade. A whole tier precedes the whole of
 * the next, so a value from a higher tier beats one from a lower tier at ANY width: a node's own
 * desktop value beats a class's tablet value, even while viewing at tablet, because the node's
 * rule is emitted after the class's and both match.
 *
 * Reading it the other way round — narrowest breakpoint first, whoever wrote it — is the
 * intuitive answer and the wrong one. It would report a class value the browser never shows.
 *
 * Within one tier the live breakpoints are walked in written order and the last match kept, which
 * gives the desktop-first model on the viewport axis and lets a container rule beat a viewport one.
 *
 * `breakpoint` is the one the control is EDITING, and is used only to decide whether the winning
 * value is the author's own or has come from elsewhere. Which breakpoints are live is
 * `viewportChain` and `containerChain`; this argument does not imply them.
 *
 * `undefined` means nothing states this property anywhere. A control showing a placeholder is
 * telling the truth in that case; showing an empty box for a value that exists is not.
 */
export function resolveStyle(
  property: string,
  state: string,
  breakpoint: string,
  input: StyleResolutionInput
): ResolvedStyle | undefined {
  const live = liveBreakpoints(breakpoint, input);
  // An interactive state does not replace the unconditional rules — it joins them. `:hover` is
  // emitted as `:where(:hover)`, which carries no specificity, so a `base` declaration written
  // LATER still wins over a `hover` one written earlier. A hovered element therefore matches
  // both, and asking only about `hover` reports a value the browser overrides.
  //
  // Within one tier the compiler writes base first and the state after, so the state wins there;
  // across tiers the later tier wins whichever state it used.
  // A state the compiler does not know is reported as `invalid-style-state` and emits nothing, so
  // reading it here would return a value from a rule that was deliberately never written.
  if (!STYLE_STATES.includes(state as StyleState)) return undefined;
  const states = state === "base" ? ["base"] : ["base", state];
  // Least specific first, so a rule that outranks another is read after it and the `>=` below
  // keeps the right one. For everything but the link colours this is a list of one.
  const properties = new Set([...propertiesAlsoMatching(property), property]);
  let accumulated: Accumulated | undefined;
  let strongest = 0;
  // Which catalog key produced what is accumulated, so a key overriding a DIFFERENT key that
  // happens to write the same CSS property replaces it rather than merging into its shape.
  let producer: string | undefined;

  for (const tier of tiers(input, property)) {
    for (const candidateState of states) {
      for (const id of live) {
        const values = valuesAt(tier.styles, candidateState, id);
        if (values === undefined) continue;
        // Compiled as the WHOLE map, the way the page compiler compiles it. A map is refused
        // together — enough malformed siblings exhaust the structural budget and nothing in it is
        // written — so asking about one property in isolation can report a value the browser
        // never received because of the company it was stored with.
        const emitted = compilerWroteKeys(values);
        // Sorted, because that is the order the compiler writes a map in — it sorts the keys so
        // two documents differing only in the order they were written compile to the same bytes.
        // Stored order looks like the write order and is not: with `backgroundGradient` stored
        // first, the compiler still emits `background` first and the gradient last.
        for (const candidate of Object.keys(values).sort()) {
          if (!properties.has(candidate)) continue;
          const value = values[candidate] as StyleValue;
          if (value === undefined) continue;
          // Accepted only if this candidate actually wrote a declaration that OVERLAPS the
          // property being asked about. That it emitted something is not enough: a same-map
          // `background: { position: "center" }` writes `background-position` and nothing else,
          // so treating it as a candidate for `backgroundGradient` reports a position object as
          // the gradient over an element with no image declaration at all.
          const overwrote = overlappingWrites(candidate, property).filter(key =>
            emitted.has(key)
          );
          if (overwrote.length === 0) continue;
          const source: StyleSource =
            id === breakpoint
              ? tier.source
              : {
                  // Named so a control can say which breakpoint the value comes from, with the
                  // writer kept inside so it can also say who set it there.
                  tier: "inheritedBreakpoint",
                  from: id,
                  source: tier.source,
                };
          const weight = selectorWeight(source, candidate);
          // A weaker rule cannot displace a stronger one however late it is written, which is
          // the one place source order alone is not the whole cascade.
          if (weight < strongest) continue;
          if (weight > strongest) {
            strongest = weight;
            accumulated = undefined;
          }
          // Folding merges a value into what a LOWER tier of the same property left, field by
          // field. Two different catalog keys are not that: `backgroundGradient` and `background`
          // both write `background-image`, but they are stored in different shapes and neither is
          // a partial version of the other, so the later one replaces rather than merges. Only a
          // key overriding itself can leave the other's fields standing.
          // Whether the other key covers ALL of this property's declarations decides what can be
          // said about it. `linkColor` under `linkColorHover` writes the same one declaration, so
          // its value IS the answer and folds in. `backgroundGradient` under `background` writes
          // one of five, so it replaces the image and leaves position, size and repeat standing —
          // and there is no field of `background` that can hold a gradient, so those survivors are
          // the whole of what can honestly be reported.
          const coversEverything =
            overwrote.length === declarationsWritten(property).length;
          if (
            producer !== undefined &&
            producer !== candidate &&
            !coversEverything
          ) {
            // Only the leaves this candidate overwrote. A lower tier's `background` may have set
            // `position`, `size` and `repeat` alongside its `url`, and a higher `backgroundGradient`
            // replaces the image alone — the browser goes on using the rest, so clearing the whole
            // accumulator would hide fields that are still painting the element.
            accumulated = withoutOverwritten(
              accumulated,
              property,
              [],
              new Set(overwrote)
            );
            // Cleared, not replaced. The value belongs to a DIFFERENT key, in a different stored
            // shape, so there is no field of the property being asked about that can hold it —
            // `backgroundGradient` is not a `background.url`. What survives is what the other key
            // did not overwrite, which is exactly what a control can still edit here.
            producer = candidate;
            continue;
          }
          producer = candidate;
          accumulated = fold(
            accumulated,
            value,
            source,
            candidate,
            [],
            emitted
          );
        }
      }
    }
  }

  return accumulated === undefined ? undefined : readOut(accumulated);
}
