/**
 * Reading and writing one control's value inside a node's style envelope.
 *
 * The envelope is `state × breakpoint × property`, both outer levels sparse, and
 * a control addresses one position in it. Every control goes through here rather
 * than reaching into `node.styles` itself, so the addressing exists once: a
 * control that spelled the path itself would be a second answer to "where does
 * this value live", and the two disagree the first time the envelope moves.
 *
 * **Validation is DELEGATED, never repeated.** `validateStyleValues` is the
 * catalog's own grammar check, and this calls it on the values that would
 * result. A control that re-checked units or ranges would be a second
 * implementation of the same question — and the one that drifted would be this
 * one, because the catalog is where new properties arrive.
 *
 * **A write is ONE op.** `editorState.apply` pushes exactly one undo entry per
 * call, so a control that commits through a single `update` op is a single step
 * of undo by construction rather than by remembering to batch.
 *
 * @module style-values
 */

import {
  breakpointContexts,
  isPlainRecord,
  isTokenRef,
  validateStyleValues,
  type BreakpointId,
  type BreakpointSet,
  type NodeStyles,
  type StyleState,
  type StyleValue,
  type StyleValues,
  type ValidationIssue,
} from "@nextlyhq/blocks-engine";

import { sameStyleValue, type BuilderOp } from "./ops";
import type { StyleControlOptions } from "./style-controls";

/**
 * The site policy a value is judged against.
 *
 * Carried rather than defaulted, because the engine ships no host list of its
 * own: which hosts a site will fetch from is the operator's decision. Omitting
 * it from a validation run does not mean "allow" — it means the question was
 * never asked — so a control that never forwarded it would accept a URL the
 * published compiler refuses, show it in the preview, fetch it from the editor,
 * and let the author save a value that then vanishes from the page.
 *
 * DERIVED rather than restated. This and `StyleControlOptions` are the same
 * contract read at two moments — choosing which arm to draw, and judging the
 * write — and they must never disagree about a field. Both trace to the
 * engine's own option type, so a field added there reaches all three at once.
 */
export type StylePolicy = StyleControlOptions;

/** Where a control reads and writes. */
export interface StyleAddress {
  readonly state: StyleState;
  readonly breakpoint: BreakpointId;
  /** The catalog key, as stored in a `StyleValues` record. */
  readonly property: string;
  /**
   * The position inside the property's value, from `StyleControl.path`.
   *
   * Empty addresses the property itself. A control never builds this by hand:
   * it carries the path the descriptor gave it, which is what keeps the two
   * from disagreeing about where a side or a corner lives.
   */
  readonly path: readonly string[];
}

/**
 * The outcome of asking for a write.
 *
 * A discriminated union rather than a thrown error, because a refused value is
 * an ordinary thing for a control to encounter — a half-typed length is invalid
 * for as long as it takes to type the unit — and an exception on every keystroke
 * is not a control flow anyone wants to write against.
 */
export type StyleWrite =
  | {
      readonly ok: true;
      /**
       * The op to apply, or `null` when the document already holds this value.
       *
       * `applyOp` REFUSES an update that changes nothing — "a history entry for
       * it would undo to no visible effect" — so an SDK that always handed back
       * an op would advertise one that throws on the ordinary cases: resetting
       * a control that was already unset, or retyping the value a node already
       * holds. Null says the ask was valid and there is nothing to do.
       */
      readonly op: BuilderOp | null;
      /**
       * Findings the catalog reported that do not refuse the write.
       *
       * Carried rather than dropped: a warning is the validator explaining
       * something about a value it accepted, and a control that discarded them
       * would present an accepted-with-reservations value as an unremarkable
       * one.
       */
      readonly warnings: readonly ValidationIssue[];
    }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

/** A stored value holding named sub-values. */
type CompositeValue = { readonly [key: string]: StyleValue };

/**
 * Whether a value addresses sub-values.
 *
 * A token reference is an object and is nonetheless a scalar, so `typeof` alone
 * would descend into `{ $token }` looking for a side that is not there.
 */
function isComposite(value: StyleValue | undefined): value is CompositeValue {
  return typeof value === "object" && value !== null && !isTokenRef(value);
}

/**
 * A value's OWN entry at a name, ignoring anything reached through a prototype.
 *
 * The engine reads style maps this way — `validateStyleValues` and the shape
 * walk beside it both guard with `Object.hasOwn` — so a document carrying
 * prototype-bearing maps, or running under a polluted `Object.prototype`, is
 * validated and compiled from own keys alone. Reading any wider here would show
 * an author a value the page will not carry, and spread it into the op that
 * stores it; an inherited accessor would also RUN during the read.
 */
/**
 * The value an own DATA property holds, or `undefined` when there is none to
 * read.
 *
 * The single descriptor read this module addresses anything through. A bracket
 * read runs an own accessor, and every tier of a style address is walked while
 * `sharedValueAt` inspects a selection for a panel — so a getter with a side
 * effect fires from rendering and a throwing one aborts the read.
 *
 * Every tier, because the address has four and they were not all covered by
 * fixing the innermost one: the state, the breakpoint, the property, and each
 * path segment inside the value. A guard on some of them is a guard on none, as
 * the first getter met decides the outcome.
 *
 * The descriptor subsumes the ownership check — an inherited property has none
 * here — so this replaces `Object.hasOwn` rather than joining it.
 */
function ownData(holder: object, key: string): unknown {
  const part = Object.getOwnPropertyDescriptor(holder, key);
  return part !== undefined && "value" in part ? part.value : undefined;
}

function ownValue(value: CompositeValue, name: string): StyleValue | undefined {
  // An accessor reads as ABSENT rather than as a value, and the residue is
  // worth naming: two nodes that both hold one at the same address then look
  // equally unset, so a control shows nothing and typing sets them both. That
  // is benign — nothing real is overwritten, because such a value cannot be
  // stored at all. `applyOp` refuses it: "styles" holds a value JSON cannot
  // carry unchanged. So it is only ever met on nodes a caller built in memory.
  return ownData(value, name) as StyleValue | undefined;
}

/** The value at a path inside one property's stored value. */
function readAtPath(
  value: StyleValue | undefined,
  path: readonly string[]
): StyleValue | undefined {
  let at = value;
  for (const step of path) {
    if (!isComposite(at)) return undefined;
    at = ownValue(at, step);
  }
  return at;
}

/**
 * One property's value with `next` written at `path`.
 *
 * Rebuilt rather than mutated at every level, because the document the editor
 * holds is the one React renders from: writing through a nested reference
 * changes a value the previous render is still displaying, and the two states
 * differ with nothing having re-rendered.
 */
function writeAtPath(
  value: StyleValue | undefined,
  path: readonly string[],
  next: StyleValue
): StyleValue {
  if (path.length === 0) return next;
  const [step, ...rest] = path;
  // A scalar standing where a composite is addressed is REPLACED rather than
  // descended into. It happens when a union moves between its arms — a radius
  // stored as one measurement, then edited per corner — and preserving the
  // scalar would leave a value that is neither arm.
  const parent: CompositeValue = isComposite(value) ? value : {};
  return { ...parent, [step]: writeAtPath(ownValue(parent, step), rest, next) };
}

/**
 * One property's value with `path` removed, or `undefined` when nothing is left.
 *
 * Pruning upward matters because an emptied container is not the same as an
 * absent one to anything that reads the envelope: an empty record still counts
 * as a value set at this breakpoint, so a reset that left one behind would show
 * a control as authored-here with nothing in it.
 */
function clearAtPath(
  value: StyleValue | undefined,
  path: readonly string[]
): StyleValue | undefined {
  if (path.length === 0) return undefined;
  if (!isComposite(value)) return value;
  const [step, ...rest] = path;
  // `in` walks the prototype chain, so an inherited name would be "cleared"
  // from an own map that never held it — materialising the inherited value as
  // an own key on the way.
  if (!Object.hasOwn(value, step)) return value;
  const next = clearAtPath(ownValue(value, step), rest);
  const remaining: Record<string, StyleValue> = { ...value };
  if (next === undefined) delete remaining[step];
  else remaining[step] = next;
  return Object.keys(remaining).length === 0 ? undefined : remaining;
}

/**
 * A value wrapped in the containers its path names.
 *
 * A control holds a scalar and an address; both the validator and the compiler
 * take the property's WHOLE value. Building the containers in one place is what
 * lets the commit judge exactly the shape the preview compiled — two copies
 * would agree until either moved.
 */
export function styleValueAtPath(
  path: readonly string[],
  value: StyleValue
): StyleValue {
  let wrapped = value;
  for (let index = path.length - 1; index >= 0; index -= 1) {
    wrapped = { [path[index]]: wrapped };
  }
  return wrapped;
}

/** The value a control is currently showing, or `undefined` when nothing set it. */
export function readStyleValue(
  styles: NodeStyles | undefined,
  address: StyleAddress
): StyleValue | undefined {
  const values = valuesAt(styles, address.state, address.breakpoint);
  if (values === undefined) return undefined;
  return readAtPath(ownValue(values, address.property), address.path);
}

/**
 * The stored values at one state × breakpoint, by own keys at every level.
 *
 * Every level is guarded for two reasons at once, and the second is the one
 * that bites. The envelope is a plain object, so a state or breakpoint name
 * reached through a PROTOTYPE is one the compiler will not read — that is what
 * `Object.hasOwn` is for.
 *
 * And every level is tested for being a record before it is read at all,
 * because the envelope arrives from storage rather than from this editor. A
 * migration, a DTCG import or a hand-edited row can leave `{ base: null }`
 * here, and the field's own guard admits it: it checks that `nodes` is an
 * array and no more, deliberately, so a malformed document does not throw
 * inside the render. `Object.hasOwn(null, …)` throws, which is precisely the
 * failure that guard exists to prevent — and it throws during render, so it
 * takes the whole Style tab down and leaves the author no way to repair the
 * value that broke it.
 *
 * This is the CHOKEPOINT for that: reading a value, writing one and clearing
 * one all come through here, so guarding it covers every path into a tier
 * rather than the one path someone remembered.
 *
 * The guard is deliberately NOT the engine's `isPlainRecord`, which answers a
 * different question. That one asks whether a value is JSON-shaped, and refuses
 * anything carrying a prototype — which would refuse the very shapes the own-key
 * rule above exists to handle correctly, reading nothing from a map whose own
 * keys are perfectly good. What is needed here is only whether own keys can be
 * read from the value AT ALL, which is the question `Object.hasOwn` throws on.
 */
/**
 * Whether own keys can be read from this at all.
 *
 * The narrowest question that prevents the throw, and narrower on purpose than
 * "is this a record". `Object.hasOwn` rejects a prototype-reached key by
 * itself, so a map carrying a prototype is handled correctly by the checks that
 * follow and must not be refused here — refusing it would drop values the
 * document really does own. What it cannot survive is `null` or a primitive,
 * which is the whole of what this excludes.
 */
function hasOwnKeys(value: unknown): value is Record<string, never> {
  return typeof value === "object" && value !== null;
}

function valuesAt(
  styles: NodeStyles | undefined,
  state: StyleState,
  breakpoint: BreakpointId
): StyleValues | undefined {
  if (!hasOwnKeys(styles)) return undefined;
  const breakpoints = ownData(styles, state);
  if (!hasOwnKeys(breakpoints)) return undefined;
  const values = ownData(breakpoints, breakpoint);
  return hasOwnKeys(values) ? values : undefined;
}

/**
 * Whether a state holds any declaration of its own, at any breakpoint.
 *
 * Here rather than beside the control that draws the answer, because this file
 * is the chokepoint for reading this envelope and the reading is the whole
 * difficulty. The value arrives from storage, so a migration, a DTCG import or
 * a hand-edited row can leave `hover: null` or `{ base: null }` behind, and the
 * field's own guard admits both — it checks that `nodes` is an array and no
 * more, deliberately, so a malformed document stays repairable instead of
 * throwing. `Object.values(null)` throws during RENDER, which takes the Style
 * tab down and removes the only surface that could repair the value that broke
 * it.
 *
 * Own keys at every level, for the reason `valuesAt` gives: a state or
 * breakpoint reached through a PROTOTYPE is one the compiler will not read, so
 * reporting it as styled would mark a state whose values never reach the page.
 *
 * A PLAIN RECORD at every level, and the engine's own predicate rather than a
 * looser one, for the same reason stated positively: this must agree with what
 * the COMPILER will read. An array is a non-null object, so a guard asking only
 * that would accept `hover: []` and count its numeric indexes as declarations —
 * while `isPlainRecord` makes the compiler emit nothing for it. A state marked
 * as styled that cannot affect the page is worse than an unmarked one, because
 * it sends an author looking for a value that was never going to apply.
 *
 * A TIER THE SHEET HAS. A value stored under a breakpoint the site has since
 * deleted is not reachable by any visitor — the compiler iterates the
 * breakpoint contexts it was given and never looks at the rest — so counting it
 * would mark a state whose appearance nobody can see.
 *
 * EMPTY IS NOT SET. Both levels are sparse and either can survive empty — a
 * state whose last declaration was cleared leaves the keys behind — so a
 * presence test reports a state as styled when it carries nothing, which is
 * precisely the false reassurance the marker exists to remove.
 */
export function stateHasOwnValues(
  styles: NodeStyles | undefined,
  state: StyleState,
  breakpoints: BreakpointSet | undefined
): boolean {
  if (!isPlainRecord(styles)) return false;
  const tiers = ownData(styles, state);
  if (!isPlainRecord(tiers)) return false;
  /*
   * Only the tiers the SHEET has, asked of the compiler's own reader rather
   * than of the stored definitions. `breakpointContexts` is what decides which
   * breakpoints a site actually has for the sheet — it drops a definition whose
   * bound it cannot use and claims each id once — so a value stored under a
   * tier that has since been deleted emits nothing at all. Measured: the same
   * node compiles to 73 bytes under a known tier and to an empty sheet under an
   * unknown one.
   *
   * With no breakpoints known, every stored tier counts. That is the honest
   * answer rather than a lenient one: the question "which tiers exist" has not
   * been asked, and treating an unasked question as "none exist" would report
   * every state as unstyled.
   */
  const known =
    breakpoints === undefined
      ? undefined
      : new Set(breakpointContexts(breakpoints).map(context => context.id));
  return Object.keys(tiers).some(tier => {
    if (known !== undefined && !known.has(tier)) return false;
    const values = ownData(tiers, tier);
    return isPlainRecord(values) && Object.keys(values).length > 0;
  });
}

/** The whole envelope with one state × breakpoint replaced, pruning what empties. */
function withValues(
  styles: NodeStyles | undefined,
  state: StyleState,
  breakpoint: BreakpointId,
  values: StyleValues | undefined
): NodeStyles {
  const states: NodeStyles = { ...styles };
  // Read through the descriptor like every other tier: a spread of
  // `states[state]` invokes an own accessor exactly as a bare bracket read
  // does, and this runs on the way to writing rather than only on the way to
  // reading.
  const breakpoints: Partial<Record<BreakpointId, StyleValues>> = {
    ...(ownData(states, state) as Partial<Record<BreakpointId, StyleValues>>),
  };
  if (values === undefined || Object.keys(values).length === 0) {
    delete breakpoints[breakpoint];
  } else {
    // DEFINED rather than assigned. A breakpoint id is site-supplied free text
    // — nothing in `validateBreakpoints` restricts its characters — and the id
    // `__proto__` reaches JavaScript's legacy prototype setter through an
    // ordinary assignment: the key never becomes an own property, the map reads
    // as empty, the state is pruned, and the write reports success with nothing
    // to do. Every control at that breakpoint would be unable to author its
    // first value, silently. The spread above is safe on its own, because
    // spreading DEFINES own properties rather than setting them.
    Object.defineProperty(breakpoints, breakpoint, {
      value: values,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  if (Object.keys(breakpoints).length === 0) delete states[state];
  else states[state] = breakpoints;
  return states;
}

/** The op that writes an envelope, removing the field outright when it empties. */
function patchOp(nodeId: string, styles: NodeStyles): BuilderOp {
  if (Object.keys(styles).length > 0) {
    return { kind: "update", id: nodeId, patch: { styles } };
  }
  // Named for removal rather than set to `undefined`. An op is persisted, and
  // `JSON.stringify` drops an undefined value — so the inverse of an edit that
  // ADDED the first style would arrive back from storage as an empty patch and
  // undo nothing.
  return { kind: "update", id: nodeId, patch: {}, unset: ["styles"] };
}

/**
 * The issues that refuse a write, as distinct from those that annotate it.
 *
 * Severity is read off each issue rather than assumed from the list being
 * non-empty: a value the catalog accepts while remarking on it would otherwise
 * be refused, and the control would show an error for a value that is fine.
 */
function errorsIn(
  issues: readonly ValidationIssue[]
): readonly ValidationIssue[] {
  return issues.filter(issue => issue.severity === "error");
}

/**
 * Validate the values that would result, and answer with the op or the reasons.
 *
 * `strict` because the author is writing this value right now: a property this
 * build does not know is a mistake to report at the keystroke, not a document
 * from a newer engine to be forgiving about.
 */
function writeResult(
  nodeId: string,
  before: NodeStyles | undefined,
  after: NodeStyles,
  values: StyleValues,
  subject: StyleValues,
  policy: StylePolicy | undefined
): StyleWrite {
  // ONLY the leaf this edit writes. A sibling that is already invalid is not
  // this edit's fault, and judging anything wider lets one bad value block the
  // controls around it with no way to fix them: a breakpoint-wide check blocks
  // every control on the breakpoint, and a property-wide one blocks every side
  // of a margin whose top is malformed. It is also what keeps the commit
  // judging exactly what the preview compiled, so a clean drag cannot snap
  // back on release. The document validator still reads the whole map where
  // completeness is the question.
  const issues = validateStyleValues(
    subject,
    "",
    "strict",
    undefined,
    false,
    policy?.tokens,
    { mayFetchUrl: policy?.mayFetchUrl }
  );
  const errors = errorsIn(issues);
  if (errors.length > 0) return { ok: false, issues: errors };
  // Asked with the op layer's OWN comparison rather than a second one, so the
  // answer here and the answer `applyOp` would give cannot differ. An empty
  // envelope stands in for an absent one: a node with no styles and a node
  // whose styles cleared to nothing are the same document.
  // The STYLE predicate, not the general stored one: the compiler sorts a
  // composite's keys, so a reorder renders identically and an op for it would
  // rewrite the document and cost an undo entry for nothing.
  if (sameStyleValue(before ?? {}, after)) {
    return {
      ok: true,
      op: null,
      warnings: issues.filter(issue => issue.severity !== "error"),
    };
  }
  return {
    ok: true,
    op: patchOp(nodeId, after),
    warnings: issues.filter(issue => issue.severity !== "error"),
  };
}

/** The op that sets one control's value, or the reasons the value was refused. */
export function styleWriteOp(
  nodeId: string,
  styles: NodeStyles | undefined,
  address: StyleAddress,
  value: StyleValue,
  policy?: StylePolicy
): StyleWrite {
  const current = valuesAt(styles, address.state, address.breakpoint);
  const values: StyleValues = {
    ...current,
    [address.property]: writeAtPath(
      current === undefined ? undefined : ownValue(current, address.property),
      address.path,
      value
    ),
  };
  return writeResult(
    nodeId,
    styles,
    withValues(styles, address.state, address.breakpoint, values),
    values,
    { [address.property]: styleValueAtPath(address.path, value) },
    policy
  );
}

/**
 * The op that clears one control's value at this state × breakpoint.
 *
 * Clearing is not writing an empty string: a property with no entry falls back
 * through the cascade to whatever a class, a block default or a wider
 * breakpoint set, which is what an author asking to reset a control means. A
 * stored empty value would instead pin the property to nothing here and win
 * over the tier the author wanted back.
 */
export function styleClearOp(
  nodeId: string,
  styles: NodeStyles | undefined,
  address: StyleAddress,
  policy?: StylePolicy
): StyleWrite {
  const current = valuesAt(styles, address.state, address.breakpoint);
  const values: StyleValues = { ...current };
  const remaining = clearAtPath(
    Object.hasOwn(values, address.property)
      ? values[address.property]
      : undefined,
    address.path
  );
  if (remaining === undefined) delete values[address.property];
  else values[address.property] = remaining;
  // Nothing is being written, so there is nothing to judge: removing a value
  // cannot make a document invalid, and validating what REMAINS would refuse a
  // reset because of a sibling the author is not touching.
  return writeResult(
    nodeId,
    styles,
    withValues(styles, address.state, address.breakpoint, values),
    values,
    {},
    policy
  );
}
