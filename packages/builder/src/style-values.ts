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
  isTokenRef,
  validateStyleValues,
  type BreakpointId,
  type MayFetchUrl,
  type NodeStyles,
  type StyleState,
  type StyleValue,
  type StyleValues,
  type TokenLookup,
  type ValidationIssue,
} from "@nextlyhq/blocks-engine";

import { sameStoredValue, type BuilderOp } from "./ops";

/**
 * The site policy a value is judged against.
 *
 * Carried rather than defaulted, because the engine ships no host list of its
 * own: which hosts a site will fetch from is the operator's decision. Omitting
 * it from a validation run does not mean "allow" — it means the question was
 * never asked — so a control that never forwarded it would accept a URL the
 * published compiler refuses, show it in the preview, fetch it from the editor,
 * and let the author save a value that then vanishes from the page.
 */
export interface StylePolicy {
  readonly mayFetchUrl?: MayFetchUrl;
  /**
   * The site's token table.
   *
   * Without it the validator cannot report `unknown-token` or
   * `token-kind-mismatch`, so a control silently accepts a reference that
   * renders as nothing. `styleControlsFor` already takes one for choosing a
   * union arm; carrying it here is what gives a caller one route to supply it
   * to both.
   */
  readonly tokens?: TokenLookup;
}

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

/** The value at a path inside one property's stored value. */
function readAtPath(
  value: StyleValue | undefined,
  path: readonly string[]
): StyleValue | undefined {
  let at = value;
  for (const step of path) {
    if (!isComposite(at)) return undefined;
    at = at[step];
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
  return { ...parent, [step]: writeAtPath(parent[step], rest, next) };
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
  if (!(step in value)) return value;
  const next = clearAtPath(value[step], rest);
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
  const values = styles?.[address.state]?.[address.breakpoint];
  return readAtPath(values?.[address.property], address.path);
}

/** The whole envelope with one state × breakpoint replaced, pruning what empties. */
function withValues(
  styles: NodeStyles | undefined,
  state: StyleState,
  breakpoint: BreakpointId,
  values: StyleValues | undefined
): NodeStyles {
  const states: NodeStyles = { ...styles };
  const breakpoints = { ...states[state] };
  if (values === undefined || Object.keys(values).length === 0) {
    delete breakpoints[breakpoint];
  } else {
    breakpoints[breakpoint] = values;
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
  if (sameStoredValue(before ?? {}, after)) {
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
  const current = styles?.[address.state]?.[address.breakpoint];
  const values: StyleValues = {
    ...current,
    [address.property]: writeAtPath(
      current?.[address.property],
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
  const current = styles?.[address.state]?.[address.breakpoint];
  const values: StyleValues = { ...current };
  const remaining = clearAtPath(values[address.property], address.path);
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
