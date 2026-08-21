/**
 * Previewing a value while the pointer is still down, and committing once.
 *
 * A scrub is two different operations wearing one gesture. Dragging must show
 * the result immediately and cost nothing per frame; releasing must produce a
 * single undoable edit. Doing both through the document would recompile a
 * stylesheet on every pointer move and push an undo entry for each — so the
 * drag writes CSS and only the release writes the document.
 *
 * **The preview is compiled, not formatted.** `compileStyleValues` is the same
 * function the published stylesheet is emitted through, so a token reference
 * becomes the same `var()`, a composite expands to the same logical properties,
 * and a value the compiler refuses produces no declarations here either. Writing
 * `${property}: ${value}` by hand would be a second emission path, and the two
 * would disagree exactly where emission is interesting.
 *
 * **A refused value never reaches the screen.** The compiler validates before it
 * writes, so the preview and the commit accept exactly the same values — by
 * construction rather than by both remembering to check.
 *
 * **The rule sits at the compiler's own specificity and wins on ORDER.** It is
 * anchored to the same root the compiled sheet uses — `PAGE_ROOT_SELECTOR`,
 * plus the document's scope class when it has one — because that is where the
 * override contract lives. Spelling a stronger selector would quietly raise
 * that contract for the duration of a drag, so the preview would land where the
 * committed value will not; spelling a weaker one loses to the rule being
 * previewed over, and the drag shows nothing move. The consequence for the host
 * is that the element holding this text must come AFTER the compiled sheet —
 * later of two equals wins — and removing it on commit reveals the real rule
 * underneath with no visible change.
 *
 * @module style-scrub
 */

import {
  compilePageCss,
  compileStyleValues,
  escapeIdentifier,
  nodeClassName,
  PAGE_ROOT_SELECTOR,
  STYLE_STATES,
  type BlockDocument,
  type BreakpointSet,
  type Declaration,
  type StyleState,
  type StyleValue,
  type ValidationIssue,
} from "@nextlyhq/blocks-engine";

import { BASE_BREAKPOINT } from "./breakpoints";
import type { StyleAddress, StylePolicy, StyleWrite } from "./style-values";
import { styleValueAtPath, styleWriteOp } from "./style-values";

/** The node a scrub is previewing against. */
export interface ScrubTarget {
  readonly nodeId: string;
  /**
   * The class the compiler emitted for this node.
   *
   * Supplied rather than derived from the id. `nodeClassName` cannot see a hash
   * collision — only `nodeClassNames`, which reads the whole document, can — so
   * a target that hashed the id itself would preview against the wrong node on
   * exactly the documents where the compiler had already disambiguated.
   */
  readonly nodeClass: string;
  /**
   * The document's compile scope, when it has one.
   *
   * `compilePageCss` anchors every rule to `${PAGE_ROOT_SELECTOR}.${scope}`, so
   * a preview that spelled the unscoped root would sit one class BELOW the rule
   * it is previewing over — the stored value would win and the drag would show
   * nothing move. It would also reach a same-class node in another document
   * rendered beside this one.
   *
   * Escaped through the engine's own `escapeIdentifier`, so the preview and the
   * compiled sheet cannot disagree about a scope needing escapes.
   */
  readonly scope?: string;
  /**
   * The site's breakpoint definitions, as the canvas compiles with.
   *
   * `compilePageCss` wraps a non-base breakpoint's rules in `@media` or
   * `@container` — measured, a `mobile` value comes out inside
   * `@media (max-width: 640px)`. A preview that ignored the address's
   * breakpoint would show the value at every width and lose it on release, and
   * for a breakpoint id this site does not define the compiler writes no rule
   * at all while an unconditional preview still showed one.
   *
   * Omitted means every value previews unconditionally, which is right only for
   * a site whose breakpoints are all unconditional.
   */
  readonly breakpoints?: BreakpointSet;
  readonly address: StyleAddress;
  /**
   * The custom-property prefix this site emits tokens under.
   *
   * `compilePageCss` takes it from `StyleCompileContext.tokenPrefix`, so a site
   * that configured `--acme-` would have its published sheet read
   * `var(--acme-brand)` while a preview compiled with the default read
   * `var(--site-brand)` — a token that resolves to nothing, or to a different
   * value, for exactly as long as the drag lasts. Omitted means the engine's
   * own default, which is what the compiler falls back to.
   */
  readonly tokenPrefix?: string;
  /** The site policy, forwarded to the compile so a refused URL never previews. */
  readonly policy?: StylePolicy;
}

/**
 * The fragment the compiler constrains one state's rules with, per state.
 *
 * READ from the compiler rather than restated here. `compilePageCss` appends
 * `:where(:hover)` and its siblings from a table it does not export, so a copy
 * would be a second statement of which pseudo-class each state means — and the
 * two would agree until the engine moved, at which point a hover preview would
 * land somewhere the committed rule does not. Compiling one probe per state and
 * taking the fragment out of the selector it produced cannot drift.
 *
 * Without it a preview matches the node in EVERY state: dragging a hover value
 * would repaint the resting appearance too, and releasing would reveal
 * behaviour the drag never showed.
 *
 * Four states, computed once.
 */
const STATE_FRAGMENTS = new Map<StyleState, string>();

/** The probe node's id, used only to derive the fragments above. */
const PROBE_ID = "scrub-state-probe";

/** Compile one probe document and return the selector it wrote. */
function probeSelector(state: StyleState): string {
  const document: BlockDocument = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: PROBE_ID,
        type: "core/box",
        version: 1,
        props: {},
        // A property with no descendant, so the selector carries the state
        // fragment and nothing else after the node class.
        styles: { [state]: { base: { height: "1px" } } },
      },
    ],
  };
  const compiled = compilePageCss(document, {
    breakpoints: { viewport: [{ id: "base", label: "Base" }], container: [] },
  });
  return compiled.css.split("{")[0].trim();
}

/**
 * What a state adds to a node's selector.
 *
 * Falls back to constraining nothing only for `base`, which genuinely adds
 * nothing. For any other state a fragment that could not be derived would mean
 * previewing in the wrong place, so this throws rather than emitting a rule
 * that silently repaints the resting appearance.
 */
function stateFragment(state: StyleState): string {
  const cached = STATE_FRAGMENTS.get(state);
  if (cached !== undefined) return cached;
  const prefix = `${PAGE_ROOT_SELECTOR} .${nodeClassName(PROBE_ID)}`;
  const selector = probeSelector(state);
  if (!selector.startsWith(prefix)) {
    throw new Error(
      `the compiler's selector for the ${state} state no longer starts with ` +
        `the node's own selector, so a preview cannot be placed beside it`
    );
  }
  const fragment = selector.slice(prefix.length);
  STATE_FRAGMENTS.set(state, fragment);
  return fragment;
}

/** Every state's fragment, for a caller that wants them warmed or asserted. */
export function scrubStateFragments(): ReadonlyMap<StyleState, string> {
  for (const state of STYLE_STATES) stateFragment(state);
  return STATE_FRAGMENTS;
}

/** At-rules already derived, per breakpoint set and id. */
const AT_RULES = new WeakMap<BreakpointSet, Map<string, string | null>>();

/**
 * The at-rule the compiler wraps one breakpoint's declarations in.
 *
 * `null` means the compiler writes NO rule for this id — which is what it does
 * for an id the site does not define, and is a refusal rather than an
 * unconditional rule. `""` means it writes one with no wrapper, as base does.
 *
 * READ from a probe compile rather than rebuilt from the definitions. Turning a
 * breakpoint into a media query is the compiler's own arithmetic — which axis,
 * which bound, how a container query differs — and it does not export it, so a
 * copy here would drift from the sheet the preview is meant to sit beside.
 */
function breakpointAtRule(
  breakpoints: BreakpointSet,
  id: string
): string | null {
  let perId = AT_RULES.get(breakpoints);
  if (perId === undefined) {
    perId = new Map();
    AT_RULES.set(breakpoints, perId);
  }
  const cached = perId.get(id);
  if (cached !== undefined) return cached;
  const document: BlockDocument = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: PROBE_ID,
        type: "core/box",
        version: 1,
        props: {},
        styles: { base: { [id]: { height: "1px" } } },
      },
    ],
  };
  const css = compilePageCss(document, { breakpoints }).css.trim();
  const wrapper = /^@[a-z-]+[^{]*/.exec(css);
  const derived = css === "" ? null : wrapper === null ? "" : wrapper[0].trim();
  perId.set(id, derived);
  return derived;
}

/**
 * The at-rule this target's declarations belong inside, or `null` to refuse.
 *
 * Omitting the breakpoint set is only safe for the BASE breakpoint, which the
 * compiler writes unconditionally. For any other id the committed value is
 * wrapped in a query — or dropped entirely, when the site does not define it —
 * and an unconditional preview would show the value at every width and lose it
 * on release. Refusing says the preview cannot be placed, which is the honest
 * answer when the caller has not said where it goes.
 */
function atRuleFor(target: ScrubTarget): string | null {
  if (target.breakpoints !== undefined) {
    return breakpointAtRule(target.breakpoints, target.address.breakpoint);
  }
  return target.address.breakpoint === BASE_BREAKPOINT ? "" : null;
}

/**
 * The root every rule for this document is anchored to.
 *
 * A scope the compiler REFUSES falls back to the unscoped root here too. It
 * refuses an empty scope and one carrying ASCII whitespace, because `a b` in a
 * class attribute is two classes and no escaping makes it the single class the
 * renderer attached — so it warns and emits unscoped rules. Escaping the
 * whitespace instead would produce a selector requiring a class the DOM cannot
 * hold, and the preview would show nothing while the commit produced working
 * CSS.
 *
 * The whitespace set is ASCII only, matching what HTML splits a class attribute
 * on: `\s` in JavaScript also matches NBSP and the Unicode spaces, and those do
 * NOT split a class, so rejecting them would drop a scope the compiler kept.
 */
function rootSelector(scope: string | undefined): string {
  if (scope === undefined || scope === "" || /[ \t\n\f\r]/.test(scope)) {
    return PAGE_ROOT_SELECTOR;
  }
  return `${PAGE_ROOT_SELECTOR}.${escapeIdentifier(scope)}`;
}

/** CSS for the value under the pointer, or the reasons it was refused. */
export type ScrubPreview =
  | {
      readonly ok: true;
      readonly css: string;
      /**
       * What the compiler remarked on while writing this declaration.
       *
       * Emitting and objecting are not the same outcome. A site whose
       * `tokenPrefix` is invalid gets its declarations written under the
       * engine's default prefix WITH a warning saying so — measured: a plain
       * `24px` compiles to one declaration and one `severity: "warning"`
       * issue. Treating that as a refusal would blank every preview on that
       * site, including values with no token in them, while the commit
       * succeeded and the published page rendered normally.
       */
      readonly warnings: readonly ValidationIssue[];
    }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

/**
 * The rule text for one node's declarations, one rule per declaration.
 *
 * Deliberately NOT grouped by descendant. The compiler groups because it
 * serializes a whole document and a stable, compact sheet matters there; a
 * preview carries the declarations of a single leaf, which share one selector
 * anyway, and separate rules at equal specificity cascade identically to one
 * merged rule. Repeating the grouping here would be a second copy of a function
 * the engine already has, kept in step by nothing.
 */
function ruleText(
  target: ScrubTarget,
  declarations: readonly Declaration[],
  atRule: string
): string {
  const root = rootSelector(target.scope);
  const state = stateFragment(target.address.state);
  return declarations
    .map(declaration => {
      const descendant =
        declaration.descendant === undefined
          ? ""
          : ` ${declaration.descendant}`;
      const rule =
        `${root} .${target.nodeClass}${state}${descendant} ` +
        `{ ${declaration.property}: ${declaration.value} }`;
      return atRule === "" ? rule : `${atRule} {\n  ${rule}\n}`;
    })
    .join("\n");
}

/**
 * The stylesheet text that shows `value` without touching the document.
 *
 * Only the scrubbed property is compiled. Everything else the node carries
 * still comes from the sheet underneath, so a preview of one side of a margin
 * does not restate — and cannot accidentally drop — the other three.
 */
export function scrubPreviewCss(
  target: ScrubTarget,
  value: StyleValue
): ScrubPreview {
  const { property, path } = target.address;
  // Resolved BEFORE compiling the value: a breakpoint the site does not define
  // is one the published sheet carries no rule for, so previewing it would show
  // an author a result the page will never have.
  const atRule = atRuleFor(target);
  if (atRule === null) return { ok: false, issues: [] };
  const compiled = compileStyleValues(
    { [property]: styleValueAtPath(path, value) },
    "",
    target.tokenPrefix,
    undefined,
    undefined,
    { mayFetchUrl: target.policy?.mayFetchUrl }
  );
  // Two different outcomes wear one field. An ERROR means the compiler refused
  // the value, and nothing was written; a warning can accompany a declaration
  // it wrote anyway. Reading the field's length alone conflates them, so a
  // setting the compiler recovered from would blank the preview while the
  // published page rendered fine.
  const errors = compiled.warnings.filter(issue => issue.severity === "error");
  if (errors.length > 0) return { ok: false, issues: errors };
  // Nothing written is a refusal however it was reported: previewing a value
  // the page will not carry shows the author a result they cannot keep.
  if (compiled.declarations.length === 0) {
    return { ok: false, issues: compiled.warnings };
  }
  return {
    ok: true,
    css: ruleText(target, compiled.declarations, atRule),
    warnings: compiled.warnings,
  };
}

/**
 * The single op that ends a scrub.
 *
 * Separate from the preview and deliberately not derived from it: the preview
 * is CSS the canvas throws away, and the commit is a document edit. Passing one
 * through the other would make the stored value a function of a string that was
 * built for display.
 */
export function scrubCommitOp(
  target: ScrubTarget,
  styles: Parameters<typeof styleWriteOp>[1],
  value: StyleValue
): StyleWrite {
  return styleWriteOp(
    target.nodeId,
    styles,
    target.address,
    value,
    target.policy
  );
}
