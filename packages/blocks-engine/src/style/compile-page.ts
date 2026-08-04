/**
 * Compiling a document's stored styles into one stylesheet.
 *
 * A pure function of persisted data. It reads a document and a context the
 * caller loaded; it never reaches into storage, never calls a block's `render`,
 * and imports no framework. Styles are therefore never collected while
 * something renders, which is the failure mode this design exists to avoid: a
 * stylesheet assembled during a render is missing whatever did not render, and
 * the bug shows up as a block that looks right until the day it is the only
 * thing on the page.
 *
 * Everything is anchored to the page root and emitted at the same specificity,
 * so precedence comes from source order alone. That is why the tiers below are
 * emitted whole, one after another, rather than interleaved by breakpoint: a
 * node's own style beats its block type's default at every width, which is only
 * true if the whole of one tier precedes the whole of the next.
 *
 * @module style/compile-page
 */
import type {
  BlockDocument,
  BlockNode,
  BreakpointDef,
  BreakpointSet,
  NodeStyles,
  StyleState,
} from "../document";
import { MAX_BREAKPOINTS_PER_AXIS, STYLE_STATES } from "../document";
import { describeValue, pointer } from "../issue-text";
import { DEFAULT_LIMITS } from "../limits";
import type { DocumentLimits } from "../limits";
import { isPlainRecord } from "../plain-record";
import type { ValidationIssue } from "../validation";

import { BREAKPOINT_AXES } from "./breakpoint-axes";
import { escapeIdentifier } from "./css-value";
import { compileStyleValues, DEFAULT_TOKEN_PREFIX } from "./declarations";
import type { Declaration } from "./declarations";
import type { NamedClass } from "./named-class";
import {
  isUsableNamedClass,
  namedClassName,
  orderedNamedClasses,
  usableNamedClasses,
  NAMED_CLASS_SLUG_RE,
} from "./named-class";
import {
  blockTypeClassName,
  nodeClassNames,
  PAGE_ROOT_SELECTOR,
} from "./node-class";
import { serializeRules } from "./serialize";
import type { CssRule } from "./serialize";
import type { StyleIssueBudget } from "./validate-style-value";
import { newStyleIssueBudget } from "./validate-style-value";
import {
  allowanceSpent,
  newWarningAllowance,
  pushBoundedWarning,
} from "./warning-allowance";
import type { WarningAllowance } from "./warning-allowance";

/** Everything site-level the compiler needs; the caller loads it. */
export interface StyleCompileContext {
  breakpoints: BreakpointSet;
  /**
   * Base styles per block type, keyed by block name. One shared rule per type
   * rather than a copy inside every node: a page of forty default sections
   * stores no style bytes, resetting a node is deleting its own values, and
   * improving a block's default look reaches pages that already exist.
   */
  blockBases?: Readonly<Record<string, NodeStyles>>;
  /**
   * The site's named classes, in any order.
   *
   * Emitted between the block-type defaults and each node's own values, which is where a class
   * sits in the cascade: it overrides what a block looks like by default and is overridden by
   * anything the author set on one node. Precedence BETWEEN classes is their library order,
   * carried on the class itself rather than taken from the order a node lists them in, so two
   * nodes with the same classes cannot resolve differently.
   */
  namedClasses?: readonly NamedClass[];
  /**
   * The custom-property prefix site tokens are emitted under. Configurable
   * because a site's tokens live in the same namespace as everything else on
   * the page; the reserved prefixes belong to the admin and to Tailwind.
   */
  tokenPrefix?: string;
  /**
   * A class distinguishing this document's rules from another's.
   *
   * Node ids are unique within a document, not across documents, so two
   * documents rendered into one DOM — a page and a region, say — can hold the
   * same id and therefore the same generated class. Without a scope their rules
   * cross-apply and page settings from each reach both roots.
   *
   * Added to the page root rather than replacing it, so the anchored selector
   * shape is unchanged and a renderer showing one document at a time needs
   * nothing. The renderer puts the same class on the element it mounts.
   */
  scope?: string;
  /**
   * The document limits this site enforces, for bounding the node walk.
   *
   * The same object validation takes, so a caller that raised or lowered a
   * limit gets one answer from both halves rather than a stylesheet compiled
   * against a bound the document was never held to. Defaults to the standard
   * limits when the caller has no opinion.
   */
  limits?: DocumentLimits;
}

/** A library entry's id, for a record that may not have one. */
function readClassId(value: unknown): unknown {
  return value === null || typeof value !== "object"
    ? value
    : (value as { id?: unknown }).id;
}

/** A library entry's slug, for a record that may not have one. */
function readClassSlug(value: unknown): unknown {
  return value === null || typeof value !== "object"
    ? value
    : (value as { slug?: unknown }).slug;
}

/** A compiled page stylesheet. */
export interface CompiledPageCss {
  css: string;
  /**
   * What was not written, and why. Every entry names a value that is in the
   * document and absent from the stylesheet, so "my style did nothing" always
   * has an answer.
   */
  warnings: ValidationIssue[];
  /**
   * The classes to put on each node id, space-separated: its own, then every
   * named class it applies that the stylesheet actually wrote.
   *
   * Returned rather than recomputed by the renderer because two ids can hash
   * alike: only a pass over the whole document sees that, and a renderer that
   * derived the class per node in isolation would give both nodes the same one.
   * The named classes are here for a second reason — a `.nx-c-*` rule reaches
   * an element only if the element carries the token, so a renderer applying
   * this value is what makes that tier do anything at all.
   */
  classes: Map<string, string>;
}

/**
 * The pseudo-class each stored state compiles to.
 *
 * Wrapped in `:where()`, which matches identically and contributes NOTHING to
 * specificity. Everything this module emits is anchored at the page root and
 * meant to be decided by source order alone; a bare `:hover` is worth a class,
 * so a block type's default hover colour would beat a node's own colour however
 * late the node's rule came, and a node given its own colour would still change
 * colour on hover having said nothing about hovering.
 *
 * Zeroing them is only half of it: at equal specificity source order decides, so
 * the order states and breakpoints are emitted in becomes the cascade. See
 * `envelopeRules`.
 *
 * `:focus-visible`, not `:focus`. Styling every focus paints a ring on mouse
 * users who never asked for one, which is why authors historically removed focus
 * styling altogether and broke keyboard navigation.
 */
const STATE_SELECTORS: Readonly<Record<StyleState, string>> = {
  base: "",
  hover: ":where(:hover)",
  focus: ":where(:focus-visible)",
  active: ":where(:active)",
};

/** One breakpoint to emit under, with the at-rule it needs. */
interface BreakpointContext {
  id: string;
  atRule?: string;
  /** Which axis this belongs to; visibility bands are computed per axis. */
  axis?: "viewport" | "container";
  /** The upper bound, for narrowing a hiding rule that a narrower id undoes. */
  maxWidth?: number;
}

/**
 * The breakpoints to emit, in cascade order.
 *
 * The base breakpoint first and unconditional, then viewport widths descending,
 * then container widths descending. Descending because the model is
 * desktop-first: the unconditional rule describes the widest layout and each
 * narrower breakpoint overrides it, so a narrower one has to come later to win.
 * Container rules follow viewport rules so that an element asked to respond to
 * its own box wins over the same value keyed to the window.
 */
function breakpointContexts(set: BreakpointSet): BreakpointContext[] {
  // The base context carries no upper bound and no at-rule, but it still needs
  // to be bounded from below when a narrower breakpoint shows a node again:
  // without that, hiding at base emits an unconditional rule that a later
  // `true` cannot undo.
  const contexts: BreakpointContext[] = [
    { id: BASE_BREAKPOINT, axis: "viewport" },
  ];
  // One id resolves to one definition. Each axis is read separately, so a
  // duplicate — within an axis or across the two — would become two contexts,
  // and a single stored value keyed to it would be emitted under both queries:
  // one `dup` responding to viewport width AND to container width, from the one
  // thing the document model says cannot happen. The document model calls this
  // an error; compilation is the path that does not assume validation ran, so
  // the first definition wins and the rest are not ids this site defines.
  const claimed = new Set<string>([BASE_BREAKPOINT]);
  let unboundedContainer = false;
  const widthDescending = (a: BreakpointDef, b: BreakpointDef): number =>
    (b.maxWidth ?? Infinity) - (a.maxWidth ?? Infinity);
  // The breakpoint set comes from stored settings, so it is read the way
  // validation reads it: as untrusted. A null axis or a malformed definition is
  // skipped rather than dereferenced, because throwing here would take down
  // every page on the site over one corrupt settings record, and rendering is
  // the half a reader still gets after forgiving validation let the document
  // through.
  //
  // A definition whose `maxWidth` is not a positive finite number is dropped
  // rather than treated as unbounded. Unbounded is not a safe reading of a broken bound: it
  // would emit the breakpoint's values unconditionally, applying at every width
  // the author meant to exclude. Dropped, the id is simply not one this site
  // defines, and the values keyed to it are reported as stale like any other.
  //
  // Zero and below are as unusable as a NaN and quieter about it. Nothing has a
  // negative width, so `@media (max-width: -1px)` is a well-formed query that
  // can never match: kept, its id would count as known, and the styles and
  // hiding stored under it would go missing with nothing reported at all.
  const rawSet: unknown = set;
  const axisDefs = (axis: "viewport" | "container"): BreakpointDef[] => {
    const defs = isPlainRecord(rawSet) ? rawSet[axis] : undefined;
    if (!Array.isArray(defs)) return [];
    const usable = defs.filter((def: unknown): def is BreakpointDef => {
      if (!isPlainRecord(def) || typeof def.id !== "string") return false;
      // The base id names the unconditional context and carries no bound by
      // definition; it is skipped below, and asking it for one would drop the
      // very breakpoint every other rule is written against.
      if (def.id === BASE_BREAKPOINT) return true;
      if (def.maxWidth === undefined) {
        // Only one unbounded definition per container axis. Two both compile to
        // `@container (min-width: 0)`, so they cover the identical range and
        // whichever sorts later silently overrides the other — the same
        // ambiguity a duplicate id creates, spelled differently.
        if (axis === "container") {
          if (unboundedContainer) return false;
          unboundedContainer = true;
          return true;
        }
        // A VIEWPORT definition without a bound would emit no at-rule at all:
        // a second unconditional context, overriding the real base at every
        // width, from a settings record the type system accepts. The container
        // axis is not the same case and was answered above, because its
        // unbounded definition still emits a query and stays scoped.
        return false;
      }
      return (
        typeof def.maxWidth === "number" &&
        Number.isFinite(def.maxWidth) &&
        def.maxWidth > 0
      );
    });
    // The declared per-axis limit, enforced here because nothing else enforces
    // it. Every style envelope in the document scans the whole context list, so
    // the cost of a corrupt settings record is multiplied by every node rather
    // than paid once, and a byte-bounded document could still stall a render.
    // The widest are kept, and values keyed to the rest are reported stale like
    // any other id this site does not define.
    return usable
      .sort(widthDescending)
      .filter(def => {
        if (claimed.has(def.id)) return false;
        claimed.add(def.id);
        return true;
      })
      .slice(
        0,
        // The unconditional base context is inserted separately and filtered
        // out of this list, so counting only what survives would honour one
        // definition past the declared limit on the viewport axis.
        axis === "viewport"
          ? MAX_BREAKPOINTS_PER_AXIS - 1
          : MAX_BREAKPOINTS_PER_AXIS
      );
  };
  // Driven by the shared axis order rather than by two loops written in a
  // chosen sequence here. Which axis is emitted last decides which one wins at
  // equal specificity, and provenance has to reproduce that exactly, so the
  // order is stated once where both can read it.
  for (const axis of BREAKPOINT_AXES) {
    for (const def of axisDefs(axis)) {
      if (def.id === BASE_BREAKPOINT) continue;
      contexts.push(
        axis === "viewport"
          ? {
              id: def.id,
              axis,
              maxWidth: def.maxWidth,
              ...(def.maxWidth === undefined
                ? {}
                : { atRule: `@media (max-width: ${def.maxWidth}px)` }),
            }
          : {
              id: def.id,
              axis,
              maxWidth: def.maxWidth,
              // A container axis always emits a container query, the widest one
              // included. Left unconditional, the container's own base values would
              // apply to a node with no query-container ancestor at all, and would
              // outrank every viewport rule while doing it. `min-width: 0` matches
              // inside any container and nowhere else, which is exactly the scope.
              atRule:
                def.maxWidth === undefined
                  ? `@container (min-width: 0)`
                  : `@container (max-width: ${def.maxWidth}px)`,
            }
      );
    }
  }
  return contexts;
}

/** The breakpoint id meaning "no media query" in a stored style envelope. */
export const BASE_BREAKPOINT = "base";

/**
 * The grammar a block type has to match before it reaches a selector.
 *
 * The same shape document validation requires of `node.type`, restated here
 * because compilation is the path that does not assume validation ran.
 */
const BLOCK_TYPE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The scope written as a class selector, or nothing when it cannot be one.
 *
 * A scope is what keeps two documents rendered into one DOM apart, and node
 * classes are unique only WITHIN a document, so losing it is not cosmetic:
 * their rules cross-apply and each document's page settings reach both roots.
 * Dropping it therefore has to be LOUD, and only when the value genuinely
 * cannot be a class.
 *
 * The value is escaped rather than pattern-matched. A class attribute holds any
 * whitespace-free token — a UUID starting with a digit, `_region`, `-region` —
 * and the CSS grammar simply cannot spell some of those raw, which is a question
 * of writing them correctly, not of whether they are allowed. Refusing them sent
 * exactly those documents back to the unscoped selector, which is the collision
 * this exists to prevent.
 *
 * Whitespace is the real exclusion: `a b` in a class attribute is two classes,
 * not one, so no escaping makes it the thing the renderer will have attached.
 */
function scopeSelector(
  scope: string | undefined,
  warnings: ValidationIssue[]
): string {
  if (scope === undefined) return "";
  // ASCII whitespace only, which is what HTML splits a class attribute on.
  // JavaScript's `\s` also matches NBSP and the Unicode spaces, and those do
  // NOT split a class: a renderer attaching `region\u00a0one` attaches one
  // valid class, so rejecting it here would drop the scope for a document whose
  // scope was fine and send it back to the selector every other document shares.
  if (scope === "" || /[ \t\n\f\r]/.test(scope)) {
    warnings.push({
      path: "/scope",
      code: "invalid-scope",
      severity: "warning",
      message: `"${describeValue(scope)}" cannot be one class, so this document's rules were not scoped and may apply to another document rendered beside it.`,
      suggestion: "Use a single class token with no whitespace.",
    });
    return "";
  }
  return `.${escapeIdentifier(scope)}`;
}

/**
 * Warn for style values keyed to a breakpoint the site does not define.
 *
 * A breakpoint id is just a string, so a document can outlive the breakpoint it
 * was written against: renaming or removing one leaves values keyed to an id
 * nothing resolves. Compiling only the ids the context knows would drop those
 * values without a word, and this result promises that anything missing from
 * the stylesheet is explained.
 */
function unknownBreakpointWarnings(
  styles: NodeStyles,
  basePath: string,
  contexts: readonly BreakpointContext[],
  warnings: ValidationIssue[],
  allowance: WarningAllowance
): void {
  const known = new Set(contexts.map(context => context.id));
  const knownStates = new Set<string>(STYLE_STATES);
  // Iterating only the states this engine knows means an unrecognised one is
  // never compiled AND never mentioned. The envelope's own keys are read here
  // so a stored `pressed` is accounted for rather than disappearing.
  for (const state of Object.keys(styles).sort()) {
    if (!knownStates.has(state)) {
      pushBoundedWarning(allowance, warnings, {
        path: pointer(basePath, state),
        code: "invalid-style-state",
        severity: "warning",
        message: `"${describeValue(state)}" is not a style state, so nothing stored under it was written.`,
        suggestion: `Use one of: ${STYLE_STATES.join(", ")}.`,
      });
      continue;
    }
    const byBreakpoint = styles[state as StyleState];
    if (!isPlainRecord(byBreakpoint)) continue;
    for (const id of Object.keys(byBreakpoint).sort()) {
      // Enumeration stops where reporting stops. The allowance bounds what is
      // RETURNED, and a state map with a very large number of stale ids costs a
      // full sort and a full scan before that bound is ever consulted — work
      // done on every render to produce warnings already known to be capped.
      if (allowanceSpent(allowance)) break;
      if (known.has(id)) continue;
      pushBoundedWarning(allowance, warnings, {
        path: pointer(pointer(basePath, state), id),
        code: "unknown-breakpoint",
        severity: "warning",
        message: `Breakpoint "${describeValue(id)}" is not defined for this site, so these values were not written.`,
      });
    }
  }
}

/** Compile one styles envelope into rules under one selector. */
function envelopeRules(
  styles: NodeStyles | undefined,
  selector: string,
  basePath: string,
  contexts: readonly BreakpointContext[],
  tokenPrefix: string,
  warnings: ValidationIssue[],
  budget: StyleIssueBudget,
  warningAllowance: WarningAllowance
): CssRule[] {
  if (styles === undefined) return [];
  // A stored envelope that is not an object — `[]`, a string, `null` — styles
  // nothing, and this compiler reads persisted data whether or not a caller
  // validated it. Returning quietly would break the one promise this result
  // makes: that everything absent from the stylesheet is accounted for.
  if (!isPlainRecord(styles)) {
    pushBoundedWarning(warningAllowance, warnings, {
      path: basePath,
      code: "invalid-style-values",
      severity: "warning",
      message: `Styles here are ${describeValue(styles)} rather than an object, so none of them were written.`,
    });
    return [];
  }
  unknownBreakpointWarnings(
    styles,
    basePath,
    contexts,
    warnings,
    warningAllowance
  );
  const rules: CssRule[] = [];
  // State outside, breakpoint inside, and the nesting is the cascade. States
  // carry no specificity of their own, so what a rule beats is decided by what
  // comes after it, and each loop order encodes a different rule:
  //
  //   breakpoint outer — every state at base, then every state at tablet, so a
  //   narrower BASE value lands after a wider HOVER value and defeats it. A
  //   node coloured on hover everywhere and re-coloured at tablet would stop
  //   showing its hover colour there, having never said anything about it.
  //
  //   state outer — every breakpoint of base, then every breakpoint of hover.
  //   A narrower base still beats a wider base, which is the desktop-first
  //   model, and a hover value still beats a base value at any width, which is
  //   what "this is what it looks like while hovered" has to mean.
  for (const state of STYLE_STATES) {
    const byBreakpoint = styles[state];
    // The same account the envelope itself gets, one level down. A state whose
    // value is `[]` or a string styles nothing, and skipping it quietly leaves
    // an author with values in the document, no CSS on the page, and nothing
    // connecting the two.
    if (byBreakpoint !== undefined && !isPlainRecord(byBreakpoint)) {
      pushBoundedWarning(warningAllowance, warnings, {
        path: pointer(basePath, state),
        code: "invalid-style-values",
        severity: "warning",
        message: `Styles for "${describeValue(state)}" are ${describeValue(byBreakpoint)} rather than an object, so none of them were written.`,
      });
      continue;
    }
    if (!isPlainRecord(byBreakpoint)) continue;
    for (const context of contexts) {
      const values = byBreakpoint[context.id];
      const path = pointer(pointer(basePath, state), context.id);
      // And one level down again. `undefined` stays silent: a breakpoint a node
      // says nothing about is the normal case, not a malformed one.
      if (values !== undefined && !isPlainRecord(values)) {
        pushBoundedWarning(warningAllowance, warnings, {
          path,
          code: "invalid-style-values",
          severity: "warning",
          message: `Styles at "${describeValue(context.id)}" are ${describeValue(values)} rather than an object, so none of them were written.`,
        });
        continue;
      }
      if (!isPlainRecord(values)) continue;
      const compiled = compileStyleValues(
        values,
        path,
        tokenPrefix,
        budget,
        warningAllowance
      );
      warnings.push(...compiled.warnings);
      // A property that styles something inside the block goes into its own
      // rule. Keeping the exception in the catalog rather than in a branch here
      // is what makes the set of them enumerable; this only has to honour it.
      for (const rule of groupByDescendant(compiled.declarations)) {
        rules.push({
          ...(context.atRule === undefined ? {} : { atRule: context.atRule }),
          selector: `${selector}${STATE_SELECTORS[state]}${rule.descendant}`,
          declarations: rule.declarations,
        });
      }
    }
  }
  return rules;
}

/** Split declarations by the descendant they attach to, root first. */
function groupByDescendant(
  declarations: readonly Declaration[]
): { descendant: string; declarations: Declaration[] }[] {
  const groups = new Map<string, Declaration[]>();
  for (const declaration of declarations) {
    const key =
      declaration.descendant === undefined ? "" : ` ${declaration.descendant}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [declaration]);
    else group.push(declaration);
  }
  return (
    [...groups.entries()]
      // The node's own rule first, then descendants in a fixed order, so the same
      // document always serializes the same way.
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([descendant, group]) => ({ descendant, declarations: group }))
  );
}

/**
 * Rules hiding a node at the breakpoints it is marked hidden for.
 *
 * Visibility is not a style property: it is stored on the node rather than in
 * its style envelope, and a value of `false` means "not shown here" rather than
 * naming a CSS property. Compiling it here keeps the one place that turns a
 * document into CSS in one file.
 *
 * Hiding INHERITS downward, the way every other value in a desktop-first model
 * does: marked hidden at tablet and unmarked below, a node stays hidden on a
 * phone. Marking it visible again at a narrower breakpoint has to stop that,
 * which a plain `max-width` rule cannot do, because the wider rule still
 * matches at the narrower width. Such a rule is bounded below instead, so it
 * covers its own band and stops where the author said to stop.
 */
function visibilityRules(
  node: BlockNode,
  selector: string,
  contexts: readonly BreakpointContext[],
  basePath: string,
  warnings: ValidationIssue[],
  warningAllowance: WarningAllowance
): CssRule[] {
  // The containing structures get the same account as the values inside them.
  // A `visibility` or `devices` that is an array, a string or null applies none
  // of what it holds, and returning quietly is indistinguishable from a node
  // that simply said nothing about being hidden.
  const visibility: unknown = node.visibility;
  if (visibility !== undefined && !isPlainRecord(visibility)) {
    pushBoundedWarning(warningAllowance, warnings, {
      path: pointer(basePath, "visibility"),
      code: "invalid-visibility",
      severity: "warning",
      message: `Visibility is ${describeValue(visibility)} rather than an object, so none of it was applied and the node stays visible.`,
    });
    return [];
  }
  const devices: unknown = isPlainRecord(visibility)
    ? visibility.devices
    : undefined;
  if (devices !== undefined && !isPlainRecord(devices)) {
    pushBoundedWarning(warningAllowance, warnings, {
      path: pointer(pointer(basePath, "visibility"), "devices"),
      code: "invalid-visibility",
      severity: "warning",
      message: `Visibility devices are ${describeValue(devices)} rather than an object, so none of them were applied and the node stays visible.`,
    });
    return [];
  }
  if (!isPlainRecord(devices)) return [];
  const rules: CssRule[] = [];
  const known = new Set(contexts.map(context => context.id));
  for (const id of Object.keys(devices).sort()) {
    if (known.has(id)) continue;
    // The same promise the style envelope keeps: a breakpoint the site no
    // longer defines leaves a stored `false` that hides nothing, and saying so
    // is the difference between a node that reappears and a mystery.
    pushBoundedWarning(warningAllowance, warnings, {
      path: pointer(pointer(pointer(basePath, "visibility"), "devices"), id),
      code: "unknown-breakpoint",
      severity: "warning",
      message: `Breakpoint "${describeValue(id)}" is not defined for this site, so this visibility setting was not applied.`,
    });
  }
  // Per axis: a container breakpoint neither inherits from nor cancels a
  // viewport one, because the two ask about different boxes.
  for (const axis of ["viewport", "container"] as const) {
    const axisContexts = contexts.filter(context => context.axis === axis);
    let hidden = false;
    let hidingFrom: BreakpointContext | undefined;
    const flush = (lowerBound: number | undefined): void => {
      if (hidingFrom === undefined) return;
      const atRule = boundedAtRule(hidingFrom, lowerBound);
      rules.push({
        ...(atRule === undefined ? {} : { atRule }),
        // Hiding has to beat the node's own `display`, including one stored on
        // a state: `.node:focus-visible { display: block }` outranks a plain
        // `.node { display: none }` however late it comes, so a focused node
        // would stay on screen at a width it is meant to be gone from. Doubling
        // the node class raises this rule above every state selector without
        // reaching for `!important`, which an author could not then override.
        selector: selector.replace(
          /(\.[A-Za-z0-9_-]+)$/,
          (match: string) => `${match}${match}`
        ),
        declarations: [{ property: "display", value: "none" }],
      });
      hidingFrom = undefined;
    };
    for (const context of axisContexts) {
      const declared = devices[context.id];
      // A stored value that is neither boolean decides nothing, and deciding
      // nothing here means the node stays visible. This compiler reads
      // persisted data whether or not a caller validated it, and promises that
      // anything missing from the stylesheet is explained, so `"false"` — a
      // string that reads exactly like the thing it is not — has to be said out
      // loud rather than treated as "no opinion".
      if (declared !== undefined && typeof declared !== "boolean") {
        pushBoundedWarning(warningAllowance, warnings, {
          path: pointer(
            pointer(pointer(basePath, "visibility"), "devices"),
            context.id
          ),
          code: "invalid-visibility",
          severity: "warning",
          message: `Visibility at "${describeValue(context.id)}" is ${describeValue(declared)} rather than true or false, so it was not applied and the node stays visible here.`,
        });
        continue;
      }
      if (declared === false && !hidden) {
        hidden = true;
        hidingFrom = context;
        continue;
      }
      if (declared === true && hidden) {
        hidden = false;
        flush(context.maxWidth);
      }
    }
    // Still hidden at the narrowest breakpoint, so the rule runs all the way
    // down and needs no lower bound.
    flush(undefined);
  }
  return rules;
}

/**
 * An at-rule narrowed to stop at a lower bound.
 *
 * Only ever used for a hiding rule that a narrower breakpoint undoes; every
 * other rule inherits downward and wants no floor.
 */
function boundedAtRule(
  context: BreakpointContext,
  lowerBound: number | undefined
): string | undefined {
  if (lowerBound === undefined) return context.atRule;
  const feature = context.axis === "container" ? "@container" : "@media";
  const upper =
    context.maxWidth === undefined
      ? ""
      : `(max-width: ${context.maxWidth}px) and `;
  // A strict lower bound rather than the next whole pixel. Breakpoint widths
  // are arbitrary numbers, so adding one can erase the band entirely — bounds
  // of 640.5 and 640 would ask for `(max-width: 640.5px) and (min-width: 641px)`
  // — and even between whole numbers it leaves fractional widths uncovered,
  // which is exactly where a device pixel ratio puts a viewport.
  return `${feature} ${upper}(width > ${lowerBound}px)`;
}

/** One node and the pointer that resolves to it inside the document. */
interface PlacedNode {
  node: BlockNode;
  path: string;
}

/**
 * Every node in the document, each with the pointer that reaches it.
 *
 * The pointer is built during the walk rather than counted, because a warning's
 * path is a promise that it resolves into the document being compiled: a node
 * inside a slot lives at `/nodes/0/slots/children/1`, and numbering nodes in
 * visit order would produce a path that reaches a different node or none at all.
 */
function documentNodes(
  doc: BlockDocument,
  warnings: ValidationIssue[],
  warningAllowance: WarningAllowance,
  limits: DocumentLimits = DEFAULT_LIMITS
): PlacedNode[] {
  const placed: PlacedNode[] = [];
  if (!Array.isArray(doc.nodes)) return placed;
  // A worklist rather than recursion. A stored document is not required to have
  // been validated before it is compiled — a render pass may validate
  // forgivingly, or not at all — and a deeply nested slot chain would then
  // overflow the stack and fail the request with a RangeError instead of
  // returning a stylesheet. Validation walks the same adversarial shape the
  // same way.
  const queue: { nodes: readonly BlockNode[]; base: string; depth: number }[] =
    [{ nodes: doc.nodes, base: "/nodes", depth: 1 }];
  // Iterating instead of recursing keeps a deep document from overflowing the
  // stack; it does not keep one from exhausting memory. Every queued level
  // retains the cumulative pointer to it, so a chain nested as deep as the byte
  // cap allows holds path text growing with its own depth at every level, and a
  // document nothing rejected can still stall the render it was asked for.
  // Stopping at the same limits validation enforces bounds the work rather than
  // only the shape of it.
  let stopped = false;
  // Every array entry read, usable or not.
  let seen = 0;
  const stop = (path: string, reason: string): void => {
    if (stopped) return;
    stopped = true;
    pushBoundedWarning(warningAllowance, warnings, {
      path,
      code: "node-count-exceeded",
      severity: "warning",
      message: reason,
    });
  };
  for (let at = 0; at < queue.length && !stopped; at += 1) {
    const level = queue[at];
    if (level === undefined) continue;
    if (level.depth > limits.maxDepth) {
      stop(
        level.base,
        `Nodes below depth ${limits.maxDepth} were not styled, because the document nests deeper than a document may.`
      );
      break;
    }
    // An indexed loop rather than `forEach`, and counting every ENTRY rather
    // than every entry that turned out usable. `forEach` cannot be broken out
    // of, so reaching the cap still walked the rest of an oversized array; and
    // a malformed entry never reached `placed`, so an array made entirely of
    // them passed the cap without ever tripping it. The bound has to be on what
    // is READ, since reading is the work being bounded.
    for (let index = 0; index < level.nodes.length; index += 1) {
      if (seen >= limits.maxNodes) {
        stop(
          level.base,
          `Only the first ${limits.maxNodes} nodes were styled, because the document holds more than a document may.`
        );
        break;
      }
      seen += 1;
      const node = level.nodes[index];
      if (!isPlainRecord(node) || typeof node.id !== "string") continue;
      const path = pointer(level.base, index);
      placed.push({ node, path });
      if (!isPlainRecord(node.slots)) continue;
      // Sorted, so two documents whose slots were written in a different order
      // still compile to the same bytes.
      for (const slot of Object.keys(node.slots).sort()) {
        const children = node.slots[slot];
        if (!Array.isArray(children)) continue;
        queue.push({
          nodes: children,
          base: pointer(pointer(path, "slots"), slot),
          depth: level.depth + 1,
        });
      }
    }
  }
  return placed;
}

/**
 * Compile a document's styles.
 *
 * The tiers, in the order they are emitted and therefore in the order they
 * override one another: page settings, block-type defaults, the site's named
 * classes in library order, then each node's own values. A whole tier precedes
 * the whole of the next, so a node's value beats a class's at any breakpoint.
 *
 * Two tiers named in the cascade are still absent. Design tokens are defined by
 * data this signature does not take yet, and user custom CSS has to be sanitized
 * before it can be written at all, so writing it before that exists would be the
 * one hole nothing else in this design leaves open.
 */
export function compilePageCss(
  doc: BlockDocument,
  ctx: StyleCompileContext
): CompiledPageCss {
  const warnings: ValidationIssue[] = [];
  // One allowance for the whole compile. Per style map it would reset, and a
  // document with a long slot key and many bad values would answer with output
  // quadratic in its own size.
  const budget = newStyleIssueBudget();
  // Bounded separately from the budget above, so a settings record full of
  // stale ids — or a document full of malformed token names — costs its own
  // diagnostics and not the page's stylesheet.
  const warningAllowance = newWarningAllowance();
  const contexts = breakpointContexts(ctx.breakpoints);
  const tokenPrefix = ctx.tokenPrefix ?? DEFAULT_TOKEN_PREFIX;
  const scope = scopeSelector(ctx.scope, warnings);
  const pageRoot = `${PAGE_ROOT_SELECTOR}${scope}`;

  const nodes = documentNodes(doc, warnings, warningAllowance, ctx.limits);
  const classes = nodeClassNames(nodes.map(entry => entry.node.id));
  // Two nodes sharing an id share a class, because a class is derived from the
  // id and the map this returns is keyed by it — there is no second class to
  // give the second node, and no way to tell a renderer about one. So their
  // styles are refused rather than emitted: written, both envelopes would land
  // on the one selector and the later would silently restyle BOTH elements, one
  // of which never asked for it. Refusing costs the styling of two nodes and
  // says so; writing corrupts a node the author did not touch.
  const duplicateIds = new Set<string>();
  const seenIds = new Set<string>();
  for (const { node } of nodes) {
    const id = node.id;
    if (typeof id !== "string") continue;
    if (seenIds.has(id)) duplicateIds.add(id);
    seenIds.add(id);
  }

  const rules: CssRule[] = [];

  // Page-scoped values, on the root every other selector is anchored to. First
  // because it is the outermost element: what it sets is what everything inside
  // inherits before any block has said anything.
  rules.push(
    ...envelopeRules(
      doc.settings?.styles,
      pageRoot,
      "/settings/styles",
      contexts,
      tokenPrefix,
      warnings,
      budget,
      warningAllowance
    )
  );

  // One rule per block type present, not per node using it.
  const usedTypes = new Set<string>();
  for (const { node } of nodes) {
    if (typeof node.type === "string") usedTypes.add(node.type);
  }
  const bases = ctx.blockBases ?? {};
  for (const type of [...usedTypes].sort()) {
    if (!Object.hasOwn(bases, type)) continue;
    // A node type reaches a SELECTOR, and this compiler reads persisted data
    // whether or not a caller validated it. Unchecked, `"evil/x, body"` emits
    // `.nx-pb-page .nx-bt-evil--x, body { … }` — a second selector of the
    // author's choosing, applying a block's defaults to every `body` on the
    // page, and more hostile spellings close the rule and open their own.
    //
    // Held to the same grammar the document model defines for a node type
    // rather than escaped into something safe: a type that is not a namespaced
    // slug is not a type this engine can style, and quietly renaming it would
    // emit a class no renderer will ever put on an element.
    if (!BLOCK_TYPE_RE.test(type)) {
      pushBoundedWarning(warningAllowance, warnings, {
        path: pointer("/blockBases", type),
        code: "invalid-node-type",
        severity: "warning",
        message: `"${describeValue(type)}" is not a block type, so its default styles were not written.`,
        suggestion: 'Use a namespaced slug such as "core/section".',
      });
      continue;
    }
    rules.push(
      ...envelopeRules(
        bases[type],
        // Escaped as well as refused above. The check is what makes this safe;
        // escaping is what keeps it safe if the check is ever loosened, and it
        // changes nothing for a type that passed, whose characters are all
        // legal in a class already.
        `${pageRoot} .${escapeIdentifier(blockTypeClassName(type))}`,
        pointer("/blockBases", type),
        contexts,
        tokenPrefix,
        warnings,
        budget,
        warningAllowance
      )
    );
  }

  // The named classes, in library order — the tier between a block's defaults and a node's own
  // values. At one specificity the cascade is source order, so being emitted here IS what makes
  // a class beat the block default and lose to a local value.
  //
  // `usableNamedClasses` decides which of them are written, and the resolver reads the same
  // list, so a class dropped here cannot be reported as the source of a value.
  //
  // Charged against an allowance of their own, one per class. A site's class library is one
  // document's configuration and every document's problem, and it took two goes to bound that
  // properly: sharing the NODE budget let a malformed library entry spend it before any node was
  // reached, and sharing one budget across the tier let a single unreferenced entry spend it
  // before any later class was read. Either way one bad entry stripped styling from a page that
  // never referenced it.
  // The library is one site-settings record read by every page compile, and it arrives whether or
  // not anything validated it. A non-array — `{}` from a corrupt row — reaches a spread inside
  // `orderedNamedClasses` and throws, which would take down rendering for every page on the site
  // rather than costing the styling of the classes nobody can read.
  const storedLibrary: unknown = ctx.namedClasses;
  const library: readonly NamedClass[] = Array.isArray(storedLibrary)
    ? (storedLibrary as readonly NamedClass[])
    : [];
  if (storedLibrary !== undefined && !Array.isArray(storedLibrary)) {
    pushBoundedWarning(warningAllowance, warnings, {
      path: "/classes",
      code: "invalid-class-library",
      severity: "warning",
      message: `The site's class library is ${describeValue(storedLibrary)} rather than a list, so no named class was written.`,
      suggestion: "Store the class library as an array of classes.",
    });
  }
  const usableClasses = usableNamedClasses(library);
  // The entries themselves, not their ids. Two entries can carry ONE id, and only one of them is
  // written: asking "was this id written" answers yes for the one that was dropped, and it goes
  // unreported — the exact case this reporting exists to explain.
  const written = new Set<unknown>(usableClasses);
  // The ids the written classes claimed, so an entry dropped for sharing one can be told that
  // rather than being told its name collided.
  const usedIds = new Set(usableClasses.map(cls => cls.id));
  // Where each entry sits in the stored array, so a warning can point at the entry rather than at
  // a name derived from it. A pointer built from the id does not resolve — the id may be missing,
  // may not be a string, and is exactly what is unreliable about a malformed entry — so an editor
  // could not highlight the class it is describing.
  const libraryIndex = new Map<unknown, number>();
  library.forEach((cls, index) => {
    if (!libraryIndex.has(cls)) libraryIndex.set(cls, index);
  });
  for (const cls of orderedNamedClasses(library)) {
    if (written.has(cls)) continue;
    // Reported once per entry the library could not use, naming which of the three reasons it
    // was. A usable record whose name is free is not reachable here, so the remaining case after
    // the two structural ones is a name another class already took.
    //
    // Read in this order because the reasons are not alternatives: an entry can be malformed AND
    // collide, and a name that cannot be written is the one an author can act on without first
    // being told the wrong thing. Collapsing the middle case into the collision — which the
    // presence of a valid slug alone would do — tells the author to rename a class whose name was
    // never the problem, and renaming it fixes nothing.
    const slug = readClassSlug(cls);
    const id = readClassId(cls);
    const named =
      typeof slug !== "string" || !NAMED_CLASS_SLUG_RE.test(slug)
        ? {
            code: "invalid-class-name" as const,
            message: `A named class could not be written: ${describeValue(slug)} is not a class name.`,
            suggestion: 'Use a lowercase slug such as "card-featured".',
          }
        : !isUsableNamedClass(cls)
          ? {
              code: "invalid-class" as const,
              message: `The class named "${describeValue(slug)}" is missing its id or its styles, so it was not written.`,
              suggestion: "Give every class a string id and a styles record.",
            }
          : // A usable record that survived neither claim lost one of them. The id is checked
            // first because it is the one a document references: told only that the NAME
            // collided, an author renames a class and the reference still reaches the other one.
            typeof id === "string" && usedIds.has(id)
            ? {
                code: "duplicate-class-id" as const,
                message: `More than one class carries the id ${describeValue(id)}, so only the first was written.`,
                suggestion: "Give every class a distinct id.",
              }
            : {
                code: "duplicate-class-name" as const,
                message: `More than one class is named "${describeValue(slug)}", so only the first was written.`,
                suggestion: "Give every class a distinct name.",
              };
    pushBoundedWarning(warningAllowance, warnings, {
      path: pointer("/classes", String(libraryIndex.get(cls) ?? 0)),
      severity: "warning",
      ...named,
    });
  }
  for (const cls of usableClasses) {
    rules.push(
      ...envelopeRules(
        cls.styles,
        `${pageRoot} .${escapeIdentifier(namedClassName(cls.slug))}`,
        pointer("/classes", String(libraryIndex.get(cls) ?? 0)),
        contexts,
        tokenPrefix,
        warnings,
        // One budget per class, not one for the tier. Shared, a single unreferenced entry with
        // enough invalid properties spends it and every later class is refused unread — so a node
        // referencing a perfectly good class receives its token and no declarations, styled by a
        // library entry it never mentions. The tier's total output stays bounded by the warning
        // allowance, which is shared and is what actually caps the reporting.
        newStyleIssueBudget(),
        warningAllowance
      )
    );
  }

  // Each node's own values, in document order so the stylesheet reads the way
  // the page does.
  const reportedDuplicates = new Set<string>();
  for (const { node, path } of nodes) {
    const className = classes.get(node.id);
    if (className === undefined) continue;
    if (duplicateIds.has(node.id)) {
      // Once per id rather than once per node carrying it: the second report
      // would name the same defect and the same fix.
      if (!reportedDuplicates.has(node.id)) {
        reportedDuplicates.add(node.id);
        pushBoundedWarning(warningAllowance, warnings, {
          path: pointer(path, "id"),
          code: "duplicate-node-id",
          severity: "warning",
          message: `More than one node has the id "${describeValue(node.id)}", so they cannot be styled apart and none of their styles were written.`,
          suggestion: "Give every node a unique id.",
        });
      }
      continue;
    }
    const selector = `${pageRoot} .${className}`;
    rules.push(
      ...envelopeRules(
        node.styles,
        selector,
        pointer(path, "styles"),
        contexts,
        tokenPrefix,
        warnings,
        budget,
        warningAllowance
      )
    );
    rules.push(
      ...visibilityRules(
        node,
        selector,
        contexts,
        path,
        warnings,
        warningAllowance
      )
    );
  }

  // The classes a renderer puts on each node, which is not the same as the class this compiler
  // styles it by. A `.nx-c-*` rule reaches an element only if the element carries that token, so
  // returning the node class alone would emit the whole named-class tier and leave every rule in
  // it inert — styles written, referenced, and applying to nothing.
  //
  // Narrowed through `usableClasses` for the same reason resolution is: a class the stylesheet
  // dropped must not be put on an element, where it would match a rule some other class owns.
  const byId = new Map(usableClasses.map(cls => [cls.id, cls]));
  const attributeClasses = new Map<string, string>();
  const reportedMissingClasses = new Set<string>();
  for (const { node, path } of nodes) {
    const own = classes.get(node.id);
    if (own === undefined) continue;
    const names = [own];
    // A stored `classes` that is not a list — `"c1"` rather than `["c1"]` — references nothing
    // this compiler can apply. Normalized away in silence it leaves an author with classes in the
    // document, none on the element, and no account of either.
    if (node.classes !== undefined && !Array.isArray(node.classes)) {
      pushBoundedWarning(warningAllowance, warnings, {
        path: pointer(path, "classes"),
        code: "invalid-classes",
        severity: "warning",
        message: `The classes on this node are ${describeValue(node.classes)} rather than a list, so none were applied.`,
        suggestion: "Store node classes as an array of class ids.",
      });
    }
    const applied = Array.isArray(node.classes) ? node.classes : [];
    for (const id of new Set(applied)) {
      if (typeof id === "string" && byId.has(id)) continue;
      // A reference that reached nothing. Silently dropping it leaves an author with a class on
      // the node, no class on the element, and nothing connecting the two — the same account
      // every other unwritten value in this compile gets. Once per id, because a second report
      // would name the same missing class and the same fix.
      const key = describeValue(id);
      if (reportedMissingClasses.has(key)) continue;
      reportedMissingClasses.add(key);
      pushBoundedWarning(warningAllowance, warnings, {
        path: pointer(path, "classes"),
        code: "unknown-class",
        severity: "warning",
        message: `This node lists the class ${key}, which the site library does not define, so it was not applied.`,
        suggestion: "Remove the reference, or add the class to the library.",
      });
    }
    // Two nodes sharing an id share one entry in this map, so a named class recorded here would
    // either be lost by whichever node is written second or applied to both. Refused for the
    // same reason their rules are: a class the author put on one node must not silently restyle
    // another node that never referenced it.
    if (!duplicateIds.has(node.id)) {
      // Library order, not the order the node lists them in, so the value is stable for a caching
      // renderer and reads the way the stylesheet does.
      for (const cls of orderedNamedClasses(
        [...new Set(applied)]
          .map(id => byId.get(id))
          .filter((cls): cls is NamedClass => cls !== undefined)
      )) {
        names.push(namedClassName(cls.slug));
      }
    }
    attributeClasses.set(node.id, names.join(" "));
  }

  return {
    css: serializeRules(rules),
    warnings,
    classes: attributeClasses,
  };
}
