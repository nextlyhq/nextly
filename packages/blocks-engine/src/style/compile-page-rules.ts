/**
 * The rules one style envelope compiles to: its declarations per state and
 * breakpoint, anchored and grouped, the device-visibility rules, and the
 * bound on an at-rule's text.
 *
 * @module style/compile-page-rules
 */
import { type BlockNode, type NodeStyles, STYLE_STATES } from "../document";
import { describeValue, pointer } from "../issue-text";
import { isPlainRecord } from "../plain-record";
import type { ValidationIssue } from "../validation";

import {
  type BreakpointContext,
  queryPrefix,
  unknownBreakpointWarnings,
  UNSATISFIABLE_CONDITION,
} from "./compile-page-breakpoints";
import {
  PREVIEW_STATE_SELECTORS,
  STATE_SELECTORS,
} from "./compile-page-states";
import { childFlagRule, withContainInset } from "./contain-inset";
import type { MayFetchUrl } from "./css-value";
import { compileStyleValues, type Declaration } from "./declarations";
import { type PartRouting, routeDeclarations } from "./part-routing";
import type { CssRule } from "./serialize";
import type { StyleOrigin, StyleTraceEntry } from "./style-trace";
import type { StyleIssueBudget } from "./validate-style-value";
import { visibilityCascade } from "./visibility-cascade";
import { pushBoundedWarning, type WarningAllowance } from "./warning-allowance";

/** What one envelope is, and what may be written from it. */
interface EnvelopeContext {
  origin: StyleOrigin;
  /**
   * The properties block parts take from a wrapping root, for the tiers that
   * style a node's root (its own values, shared styles, looks). Absent for
   * the defaults tiers, whose type class sits on the part itself.
   */
  routing?: PartRouting;
  /** Appended to as declarations are emitted; absent when no caller asked for a trace. */
  trace?: StyleTraceEntry[];
  /** Which hosts this site will fetch from; unasked when absent. */
  mayFetchUrl?: MayFetchUrl;
  /**
   * The selector part kept OUTSIDE `:where()` when this envelope's rules are
   * written as defaults, with everything else wrapped.
   *
   * Set for the two DEFAULT tiers — a block type's and the typographic baseline
   * keyed by element — and for nothing else. The page-root prefix
   * is doubled so an AUTHOR's values beat ordinary host CSS, and defaults
   * inherited that contract without it ever being argued for them — but a
   * default nobody can override is not a default. Builder.io shipped
   * compound-class component defaults and answered the resulting complaints
   * with a global opt-out; every low-friction precedent that ships
   * rendered-block typography keeps it at the floor instead, Webflow on bare
   * tags and Tailwind Typography inside `:where()`.
   *
   * It also orders the three tiers by CONSTRUCTION rather than by emission
   * order: a type's default loses to a named class and to a node's own value
   * because it weighs nothing, not because it happens to be written first.
   *
   * **It is an anchor rather than a flag because zero is the wrong weight.**
   * Wrapping the WHOLE selector gives `0-0-0`, and an ordinary unlayered reset
   * — `h1, h2, … { font-size: inherit; margin: 0 }`, which is the shape
   * Tailwind's preflight ships — is `0-0-1` and beats it. A default written
   * that way loses to the very reset it exists to answer. Measured in a
   * browser: with the reset present, the fully wrapped rule left an `h1` at
   * 16px and the anchored one at its declared 36px.
   *
   * One class outside and the rest inside gives `0-1-0`, which is what
   * Tailwind Typography emits and what the two ends of the contract need: it
   * beats a bare element reset, and it still loses to a host's own
   * `.content h1` at `0-1-1`. The anchor is the SINGLE page-root class rather
   * than the doubled one, because doubling is how an author's values are made
   * to outrank host CSS and a default must not borrow that.
   *
   * `:where()` changes what a match WEIGHS and never what it selects, so the
   * same elements are styled either way.
   */
  weightlessAnchor?: string;
  /** Emit the forceable form of each interaction state. See the context field. */
  previewStates?: boolean;
}

/** Compile one styles envelope into rules under one selector. */
// RELOCATED, not written here — see the docblock of `compile-page.ts`.
// fallow-ignore-next-line complexity
export function envelopeRules(
  styles: NodeStyles | undefined,
  selector: string,
  basePath: string,
  contexts: readonly BreakpointContext[],
  tokenPrefix: string,
  warnings: ValidationIssue[],
  budget: StyleIssueBudget,
  warningAllowance: WarningAllowance,
  /**
   * What this envelope IS and what may be written from it, grouped rather than
   * appended. Ten positional arguments was already past the point where a call
   * reads by position, and the policy below had to arrive with them: as an
   * eleventh optional in line it would have sat beside `trace` with nothing but
   * its type to tell the two apart, and a policy dropped in a mis-slotted call
   * leaves every URL in the document unasked about. Named fields cannot be
   * mis-slotted, and grouping takes the arity DOWN rather than up.
   */
  about: EnvelopeContext
): CssRule[] {
  const {
    origin,
    trace,
    mayFetchUrl,
    weightlessAnchor,
    previewStates,
    routing,
  } = about;
  // Chosen ONCE per envelope rather than per rule: it is a property of the
  // compile, and re-deciding it inside the loop invites the two forms to
  // disagree between a node's base rule and its hover one.
  const stateSelectors =
    previewStates === true ? PREVIEW_STATE_SELECTORS : STATE_SELECTORS;
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
        warningAllowance,
        { mayFetchUrl }
      );
      // Appended as they come. `compileStyleValues` holds this same allowance and charges
      // everything it returns against it exactly once, so charging again here would spend it
      // twice and leave later omissions unexplained while it still had room.
      warnings.push(...compiled.warnings);
      // A property that styles something inside the block goes into its own
      // rule. Keeping the exception in the catalog rather than in a branch here
      // is what makes the set of them enumerable; this only has to honour it.
      for (const rule of anchoredGroups(
        compiled.declarations,
        selector,
        stateSelectors[state],
        weightlessAnchor === undefined ? routing : undefined
      )) {
        rules.push({
          ...(context.atRule === undefined ? {} : { atRule: context.atRule }),
          // Everything after the anchor is wrapped, state and descendant
          // included: `${anchor} :where(x) a` leaves the `a` outside carrying
          // weight of its own, so a default that styles something inside
          // itself would outrank a host rule of the same shape. The anchor is
          // the only part that weighs.
          selector:
            rule.selector ??
            (weightlessAnchor === undefined
              ? `${selector}${stateSelectors[state]}${rule.descendant}`
              : `${weightlessAnchor} :where(${selector}${stateSelectors[state]}${rule.descendant})`),
          declarations: withContainInset(
            rule.declarations,
            rule.descendant === ""
          ),
        });
        // The flag for the block's children; not traced, as no one set it.
        const flags = childFlagRule(
          rule,
          `${selector}${stateSelectors[state]} > *`,
          weightlessAnchor,
          context.atRule
        );
        if (flags !== undefined) rules.push(flags);
        // Recorded here, from the same declarations that were just emitted, in the same loop.
        // Anywhere else it would be a second reading of the document, and a second reading can
        // disagree with the first — which is the one failure a provenance record must not have.
        // A routed declaration is written twice (off the wrapper, onto the
        // part) and traced once: it is one value the node was given.
        if (trace === undefined || rule.traced === false) continue;
        for (const declaration of rule.declarations) {
          trace.push({
            origin,
            property: declaration.property,
            value: declaration.value,
            ...(rule.descendant === "" ? {} : { descendant: rule.descendant }),
            state,
            breakpoint: context.id,
            ...(context.atRule === undefined ? {} : { atRule: context.atRule }),
          });
        }
      }
    }
  }
  return rules;
}

/**
 * The rules one compiled style map writes: grouped by the descendant each
 * declaration attaches to, root first, with the root's declarations a block
 * part takes from a wrapping root split off to their own selectors. A routed
 * group's second rule carries `traced: false`, so the trace records each
 * value once.
 */
function anchoredGroups(
  declarations: readonly Declaration[],
  selector: string,
  state: string,
  routing: PartRouting | undefined
): {
  descendant: string;
  declarations: Declaration[];
  selector?: string;
  traced?: false;
}[] {
  const groups = groupByDescendant(declarations);
  if (routing === undefined || routing.size === 0) return groups;
  return groups.flatMap(group => {
    if (group.descendant !== "") return [group];
    const { kept, routed } = routeDeclarations(
      selector,
      state,
      group.declarations,
      routing
    );
    return [
      ...(kept.length === 0 ? [] : [{ descendant: "", declarations: kept }]),
      ...routed.map((rule, index) => ({
        descendant: "",
        declarations: rule.declarations,
        selector: rule.selector,
        ...(index % 2 === 1 ? { traced: false as const } : {}),
      })),
    ];
  });
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
// RELOCATED, not written here — see the docblock of `compile-page.ts`.
// fallow-ignore-next-line complexity
export function visibilityRules(
  node: BlockNode,
  selector: string,
  contexts: readonly BreakpointContext[],
  basePath: string,
  warnings: ValidationIssue[],
  warningAllowance: WarningAllowance,
  preview: string | undefined
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
  // Where the node shows, from the one statement of the cascade the editor
  // reads too, so the bands below hide exactly where the editor says it is
  // hidden.
  const shown = visibilityCascade(devices, contexts);
  // Per axis: a container breakpoint neither inherits from nor cancels a
  // viewport one, because the two ask about different boxes.
  for (const axis of ["viewport", "container"] as const) {
    const axisContexts = contexts.filter(context => context.axis === axis);
    let hidden = false;
    let hidingFrom: BreakpointContext | undefined;
    const flush = (lowerBound: number | undefined): void => {
      if (hidingFrom === undefined) return;
      const atRule = boundedAtRule(hidingFrom, lowerBound, preview);
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
      const visible = shown[contexts.indexOf(context)] ?? true;
      if (!visible && !hidden) {
        hidden = true;
        hidingFrom = context;
        continue;
      }
      if (visible && hidden) {
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
  lowerBound: number | undefined,
  preview: string | undefined
): string | undefined {
  if (lowerBound === undefined) return context.atRule;
  /*
   * A band on a context that can never match cannot match either.
   *
   * The container axis under preview carries an impossible condition rather
   * than a bound, and rebuilding the wrapper from the prefix alone dropped it —
   * leaving a merely NAMED query that an authored ancestor could satisfy. The
   * node's styles would stay impossible while its visibility band went live, so
   * preview visibility disagreed with preview styling.
   *
   * Returned whole rather than reconstructed, because the context already
   * states the condition and a second construction of it is what diverged.
   */
  if (context.atRule?.includes(UNSATISFIABLE_CONDITION) === true) {
    return context.atRule;
  }
  const feature = queryPrefix(context.axis ?? "viewport", preview);
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
