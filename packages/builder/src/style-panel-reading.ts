/**
 * What the Style tab reads about the selection once, for every control:
 * which node, state and breakpoint it edits, the cascade a target is read
 * against, where each control's value came from, and what the cascade
 * applies at another tier.
 *
 * @module style-panel-reading
 */
import type {
  BreakpointId,
  BreakpointSet,
  StyleState,
  StyleSubject,
} from "@nextlyhq/blocks-engine";
import type { PageStyleCascade } from "@nextlyhq/blocks-react";

import { editedTierLive } from "./breakpoints";
import { breakpointsAtWidth } from "./canvas-width";
import type { AppliedAt } from "./columns-layout";
import type { EditorState } from "./editor-state";
import type { ProvenanceOf } from "./style-field-surroundings";
import type { StyleInspectionOptions } from "./style-inspector";
import {
  breakpointBadge,
  inheritedProvenance,
  provenanceBeneath,
} from "./style-provenance";
import { styleSubjectFor } from "./style-subject";

/**
 * The same provenance reading the dots use, asked at a tier: what a canvas at
 * that tier's width applies, through the one ranking of the trace.
 */
export function appliedAtReader({
  cascade,
  subject,
  state,
  breakpoints,
  nodeId,
}: {
  cascade: PageStyleCascade | undefined;
  subject: StyleSubject | undefined;
  state: StyleState;
  breakpoints: BreakpointSet | undefined;
  nodeId: string;
}): AppliedAt | undefined {
  if (cascade === undefined || subject === undefined) return undefined;
  return (tier, cssProperty) => {
    const width = breakpoints?.viewport.find(
      each => each.id === tier
    )?.maxWidth;
    const read = provenanceReader({
      cascade,
      subject,
      live: breakpointsAtWidth(breakpoints, width),
      state,
      breakpoint: tier,
      breakpoints,
      onJumpToBreakpoint: undefined,
    });
    const provenance = read({
      kind: "cssValue",
      cssProperty,
      tokenKinds: [],
    })?.provenance;
    if (provenance === undefined || provenance.kind === "unset")
      return undefined;
    const { entry } = provenance;
    return {
      value: entry.value,
      breakpoint: entry.breakpoint,
      own: entry.origin.kind === "node" && entry.origin.id === nodeId,
    };
  };
}

/**
 * The node the declarations describe, or `undefined` with nothing selected.
 *
 * Read from the CASCADE's own tree where there is one. Asking the raw document
 * instead would answer about a node the declarations may not describe — read
 * time repair can drop or replace one — and the fallback is only for a panel
 * with no cascade at all, where no indicator is drawn and the subject is read
 * for the block type alone.
 */
export function selectedSubject(
  editor: EditorState,
  cascade: PageStyleCascade | undefined,
  tag: string | undefined
): StyleSubject | undefined {
  if (editor.selectedId === null) return undefined;
  const subject = styleSubjectFor(
    cascade?.nodes ?? editor.document.nodes,
    editor.selectedId
  );
  // Spread only when there is one, so a host with no canvas leaves the field
  // ABSENT rather than present-and-undefined. `styleOrigin` reads it as "the
  // caller cannot say" either way, and an absent key says that more plainly to
  // anyone reading a logged subject.
  if (subject === undefined || tag === undefined) return subject;
  return { ...subject, tag };
}

/**
 * The cascade as the inspection reads it, or `undefined` where there is no
 * cascade or no subject in it: both are needed to ask what applies here.
 */
export function cascadeFor(
  cascade: PageStyleCascade | undefined,
  subject: StyleSubject | undefined
): StyleInspectionOptions["cascade"] {
  if (cascade === undefined || subject === undefined) return undefined;
  return { trace: cascade.entries, subject };
}

/**
 * The reader that answers, per control, where its value came from.
 *
 * Built OUTSIDE the panel because nothing in it is React: it is a pure function
 * of inputs the panel has already resolved — one subject, one live set, one
 * trace — and closing over them inside the component put the whole derivation
 * into a body that also renders.
 */
export function provenanceReader({
  cascade,
  subject,
  live,
  state,
  breakpoint,
  breakpoints,
  onJumpToBreakpoint,
}: {
  cascade: PageStyleCascade | undefined;
  subject: StyleSubject | undefined;
  live: readonly BreakpointId[] | undefined;
  state: StyleState;
  breakpoint: BreakpointId;
  breakpoints: BreakpointSet | undefined;
  onJumpToBreakpoint: ((breakpoint: BreakpointId) => void) | undefined;
}): ProvenanceOf {
  return leaf => {
    // Absent means the question was never asked. A host that supplies no cascade
    // gets no indicators, which is the honest answer for a surface that cannot
    // compile — and not the same as "nothing is inherited".
    if (cascade === undefined || subject === undefined) return undefined;
    /*
     * The same answer while the canvas is previewing and nobody has said which
     * tier the preview BOX is showing.
     *
     * Under a preview compile the viewport tiers are container queries, and a
     * `matchMedia` caller cannot evaluate them — so the window-derived set is
     * the base context alone. Passed on, that is not silence: `["base"]` is the
     * CLAIM that base is what the browser is applying, and a narrow box showing
     * the mobile tier would have every mobile declaration excluded and the base
     * value reported as the visible winner.
     *
     * No dot says "not asked", which is true until a caller observes the box.
     */
    if (live === undefined) return undefined;
    const query = {
      trace: cascade.entries,
      subject,
      // The control's own leaf, never the catalog key: two keys can write one
      // CSS property, and the trace records what was WRITTEN.
      cssProperty: leaf.cssProperty,
      descendant: leaf.descendant,
      state: state,
      breakpoint: breakpoint,
      /*
       * What the BROWSER is applying, and ONLY that. The edited breakpoint is a
       * different fact and travels separately in `breakpoint`: it says where a
       * write lands, not what is on screen.
       *
       * An earlier version forced the edited breakpoint into this set so a value
       * authored there could be called "authored here". That inverted the
       * premise — a host editing `mobile` while the canvas sits at desktop width
       * would have the mobile declaration reported as the visible winner, which
       * is a value the browser is not showing.
       *
       * The consequence is deliberate: editing a breakpoint whose query does not
       * match reports its controls as unset. That is the honest answer, because
       * the dot describes what is DISPLAYED rather than what is stored.
       */
      liveBreakpoints: live,
    };
    /*
     * ONE query, ONE ranking, read twice. The badge is the breakpoint dimension
     * of the same answer rather than a second opinion about it — two rankings
     * of one trace would first disagree at exactly the boundaries the trace
     * exists to settle.
     */
    const provenance = inheritedProvenance(query);
    const badge = breakpointBadge(query, provenance, breakpoints);
    /*
     * Offered only for a tier a canvas can actually be taken to. A declaration
     * stored under an id that lost its bound still names a real tier — worth
     * saying — but a jump to it cannot be honoured, and the host would read the
     * absent width as the unconditional tier and release the canvas instead.
     */
    const target =
      badge.kind === "inherited" && badge.source.selectable
        ? badge.source.breakpoint
        : undefined;
    /*
     * At the tiers that match where the write lands rather than at the
     * canvas's width: the line describes the position being edited.
     */
    const beneath = provenanceBeneath({
      ...query,
      liveBreakpoints: editedTierLive(breakpoints, breakpoint, live),
    });
    return {
      provenance,
      badge,
      beneath,
      ...(onJumpToBreakpoint === undefined || target === undefined
        ? {}
        : { jump: () => onJumpToBreakpoint(target) }),
    };
  };
}
