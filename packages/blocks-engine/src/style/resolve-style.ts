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
import { STYLE_STATES } from "../document";
import { isPlainRecord } from "../plain-record";

import { BREAKPOINT_AXES } from "./breakpoint-axes";
import {
  cssPropertiesForField,
  propertiesAlsoMatching,
  propertyInheritsToDescendants,
  propertyPseudoClassCount,
} from "./catalog";
import { compileStyleValues } from "./declarations";
import type { NamedClass } from "./named-class";
import { isUsableNamedClass } from "./named-class";

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

function tiers(
  input: StyleResolutionInput,
  property: string
): { styles: NodeStyles; source: StyleSource }[] {
  const ordered: { styles: NodeStyles; source: StyleSource }[] = [];
  // Everything above this node is inheritance, which reaches it only for properties that travel
  // and always loses to a declaration on the element itself. Outermost first, so the nearest
  // ancestor is read last and wins — which is what "the closest one that says anything" means.
  if (propertyInheritsToDescendants(property)) {
    if (input.pageSettings) {
      ordered.push({
        styles: input.pageSettings,
        source: { tier: "pageSettings" },
      });
    }
    for (const ancestor of input.ancestors ?? []) {
      for (const tier of nodeTiers(ancestor)) {
        ordered.push({
          styles: tier.styles,
          // Wrapped rather than flattened: which ancestor it was, and how that ancestor came by
          // it, are different questions and a control may want to ask either.
          source: {
            tier: "ancestor",
            nodeId: ancestor.nodeId,
            source: tier.source,
          },
        });
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
function valueAt(
  styles: NodeStyles,
  state: string,
  breakpoint: string,
  property: string
): StyleValue | undefined {
  if (styles === null || typeof styles !== "object") return undefined;
  const byBreakpoint = (styles as Record<string, unknown>)[state];
  if (byBreakpoint === null || typeof byBreakpoint !== "object")
    return undefined;
  const values = (byBreakpoint as Record<string, unknown>)[breakpoint];
  if (values === null || typeof values !== "object") return undefined;
  const value = (values as Record<string, unknown>)[property];
  return value === undefined ? undefined : (value as StyleValue);
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
function compilerWrites(property: string, value: StyleValue): Set<string> {
  return new Set(
    compileStyleValues({ [property]: value }, "").declarations.map(
      declaration => declaration.property
    )
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
  if (!isPlainRecord(value)) {
    // The compiler refuses a bad declaration one leaf at a time: `padding` with a valid
    // `blockStart` and a nonsense `blockEnd` still writes the first. Folding the whole record
    // would record the refused side too, and report it as the source over a lower tier the
    // browser is still showing there.
    const writes = cssPropertiesForField(property, path);
    if (writes.length > 0 && !writes.some(css => emitted.has(css)))
      return current;
    return { kind: "whole", value, source };
  }
  // A record with no fields states no declarations, so it neither wins nor clears what is
  // already there — and where nothing is there it must not invent an empty one. Read out, that
  // would show a control as carrying a value the browser has no declaration for.
  const keys = Object.keys(value);
  if (keys.length === 0) return current;
  const fields =
    current?.kind === "fields"
      ? current.fields
      : new Map<string, Accumulated>();
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
  const properties = [...propertiesAlsoMatching(property), property];
  let accumulated: Accumulated | undefined;
  let strongest = 0;

  for (const tier of tiers(input, property)) {
    for (const candidateState of states) {
      for (const id of live) {
        for (const candidate of properties) {
          const value = valueAt(tier.styles, candidateState, id, candidate);
          if (value === undefined) continue;
          const emitted = compilerWrites(candidate, value);
          if (emitted.size === 0) continue;
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
