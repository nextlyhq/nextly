"use client";

/**
 * Where a control's value came from, told to the author: the shared value
 * line, the provenance dot and its description, and the breakpoint label
 * both use.
 *
 * @module style-provenance-indicators
 */
import type {
  BreakpointId,
  BreakpointSet,
  NodeStyles,
  StyleOrigin,
  StyleTraceEntry,
} from "@nextlyhq/blocks-engine";
import * as React from "react";

import { fieldLabel } from "./inspector";
import type { SharedStyleRow } from "./shared-style-library";
import { stateLabel } from "./state-switcher";
import type {
  ProvenanceAnswer,
  EditedAddress,
} from "./style-field-surroundings";
import {
  breakpointSource,
  propertiesWriting,
  type StyleProvenance,
} from "./style-provenance";
import type { StyleTarget } from "./style-target";
import { readStyleValue, type StyleAddress } from "./style-values";

/**
 * Where a value stands between the block and its shared style, in words.
 *
 * Editing the block, a value the block sets over its style reads "Set on this
 * block · overrides Card", with Reset, which shows the style's value again.
 * Editing the style, a value the block sets over it reads "Set on this block
 * · Move to Card", which moves it into the style. Nothing otherwise.
 */
export function SharedValueLine({
  target,
  answer,
  nodeStyles,
  address,
  actionName,
  onResetBlock,
  onMoveTo,
}: {
  target: StyleTarget;
  answer: ProvenanceAnswer | undefined;
  nodeStyles: NodeStyles | undefined;
  address: StyleAddress;
  actionName: string;
  onResetBlock: () => void;
  onMoveTo: (target: Extract<StyleTarget, { kind: "shared" }>) => void;
}): React.JSX.Element | null {
  if (readStyleValue(nodeStyles, address) === undefined) return null;
  if (target.kind === "shared") {
    return (
      <div className="nx-style-inspector__shared-line" data-shared-line="move">
        <span data-shared-line-text="">Set on this block</span>
        {/* The action on a line of its own, so no separator can end a line. */}
        <button
          type="button"
          className="nx-style-inspector__breakpoint-action"
          aria-label={`Move ${actionName} to ${target.style.name}`}
          disabled={target.readOnly !== undefined}
          onClick={() => onMoveTo(target)}
        >
          Move to {target.style.name}
        </button>
      </div>
    );
  }
  const under = styleBeneath(target.worn, answer, address);
  if (under === undefined) return null;
  return (
    <div
      className="nx-style-inspector__shared-line"
      data-shared-line="override"
    >
      {/*
       * The separator is held to the words on either side by no-break spaces,
       * so a wrap falls between other words and never leaves it ending a line.
       */}
      <span data-shared-line-text="">
        {`Set on this block\u00a0·\u00a0overrides\u00a0${under.name}`}
      </span>
      <button
        type="button"
        className="nx-style-inspector__breakpoint-action"
        aria-label={`Reset ${actionName} on this block, showing ${under.name}'s value`}
        onClick={onResetBlock}
      >
        Reset
      </button>
    </div>
  );
}

/**
 * The worn style that would show at this control without the block's own
 * value, or `undefined` when none would: the block's own value at a wider
 * tier, or nothing at all.
 *
 * Read from the cascade's answer where the host supplies one, so a value the
 * block sets at a narrow breakpoint or in a state over the style's wider or
 * base-state value is named, and a block value between the two is not. With
 * no cascade, or a declaration the trace cannot tie to one control, the
 * style's own value at this exact address, the last in library order as the
 * cascade applies them: true where it answers, silent elsewhere.
 */
function styleBeneath(
  worn: readonly SharedStyleRow[],
  answer: ProvenanceAnswer | undefined,
  address: StyleAddress
): SharedStyleRow | undefined {
  const beneath = answer?.beneath;
  if (beneath === undefined || beneath.kind === "ambiguous") {
    return [...worn]
      .reverse()
      .find(row => readStyleValue(row.styles, address) !== undefined);
  }
  if (beneath.kind !== "inherited") return undefined;
  const from = beneath.from;
  return from.kind === "class"
    ? worn.find(row => row.id === from.id)
    : undefined;
}

/**
 * Where a control's value came from, as a dot beside its label.
 *
 * Three visible states, following the affordance `style-provenance.ts` already
 * says it follows: nothing set draws no dot at all, a value authored here is
 * accented, and one arriving from anywhere else is warned. An author scanning a
 * section sees at a glance which fields are theirs and which they would be
 * taking over by typing.
 *
 * **A dot rather than a written badge**, because a section holds eight or more
 * controls and a label naming the source would have to name its AXIS too once
 * breakpoints are in play — which does not fit beside a numeric input without
 * widening the panel or wrapping every row.
 *
 * **The source is named in the accessible label, not only in the tooltip.** A
 * `title` reaches a mouse and nothing else, so a dot carrying its meaning only
 * there is decoration to a screen-reader user and to anyone navigating by
 * keyboard. The text is the same in both.
 *
 * **`ambiguous` deliberately draws NOTHING.** One CSS property can be written by
 * two catalog controls — `background-image` comes from both `background.url`
 * and `backgroundGradient` — and with one of the pair stored, the trace cannot
 * say which control wrote it. A dot claiming a value this control does not hold
 * is worse than no dot, which is the same judgement `StyleProvenance` makes by
 * reporting the case rather than guessing.
 */
export function ProvenanceDot({
  answer,
  editing,
  descendant,
}: {
  answer: ProvenanceAnswer | undefined;
  editing: EditedAddress;
  /** The control's own descendant selector, to tell its rules from a sibling's. */
  descendant: string | undefined;
}): React.JSX.Element | null {
  const described = describeProvenance(answer?.provenance, editing, descendant);
  if (described === null) return null;
  return (
    <>
      <span
        className="nx-style-inspector__provenance"
        data-provenance={described.kind}
        title={described.text}
        /*
         * A role, because the element is empty: the dot is drawn by the
         * stylesheet, so without one the label is the only content and assistive
         * technology has nothing to attach the description to.
         */
        role="img"
        aria-label={described.text}
      />
      {/*
       * The same sentence, for a sighted keyboard user.
       *
       * `title` reaches a POINTER and nothing else, and `aria-label` reaches
       * assistive technology and nothing else. Between them sits the person who
       * tabs to a control and can see the screen: they got a coloured dot with
       * no way to learn what it means, which is the one group the first two
       * accommodations do not cover.
       *
       * Revealed on `:focus-within` of the field rather than made focusable
       * itself. A focusable dot would put a second tab stop in front of every
       * control in a panel that already has eight or more per section, so
       * reaching the last field would cost twice the presses — fixing the
       * explanation by damaging the navigation it explains.
       *
       * `aria-hidden` because the dot beside it already carries this text: two
       * copies in the accessibility tree is the same sentence announced twice,
       * which reads as a stutter rather than as emphasis.
       */}
      {described.kind === "inherited" && answer?.jump === undefined ? (
        /*
         * An inherited value's source stays in sight, under the label: the
         * value shown greyed in the control is only half an answer without
         * where it came from. In brief, with the whole sentence on hover for
         * a caption the row cuts short, and in text on focus below. Not where
         * the row offers a jump to its source: the jump names it, and goes
         * there.
         */
        <span
          className="nx-style-inspector__provenance-source"
          title={described.text}
          aria-hidden="true"
        >
          {described.source}
        </span>
      ) : null}
      <span className="nx-style-inspector__provenance-text" aria-hidden="true">
        {described.text}
      </span>
    </>
  );
}

/**
 * The dot's state and the sentence that names it, or `null` to draw nothing.
 *
 * Separated from the component so the wording is testable without rendering,
 * and so the two cannot drift: the tooltip and the accessible label are the same
 * string by construction rather than by two call sites agreeing.
 */
export function describeProvenance(
  provenance: StyleProvenance | undefined,
  editing: EditedAddress,
  controlDescendant?: string
):
  | { kind: "authored"; text: string }
  | { kind: "inherited"; text: string; source: string }
  | null {
  if (provenance === undefined) return null;
  if (provenance.kind === "authored") {
    return { kind: "authored", text: "Set here" };
  }
  if (provenance.kind !== "inherited") return null;
  const { from, entry } = provenance;
  // A shared style is named as the source the author chose for the block,
  // "From Card"; every other tier is inherited.
  const lead = from.kind === "class" ? "From" : "Inherited from";
  return {
    kind: "inherited",
    text: `${lead} ${originName(from, entry, editing, controlDescendant)}`,
    source: `From ${originBrief(from, entry, editing, controlDescendant)}`,
  };
}

/**
 * The same place in brief, for the caption drawn beside an inherited value:
 * the tier, then each axis that differs, named as the panel names them.
 *
 * Built from the same reading as {@link originName}: the control a rule came
 * through and the axes that differ are asked of the same helpers, so the
 * caption and the sentence cannot name two different places. Shorter where
 * the sentence spends words on what the author already knows, the block they
 * selected, and on qualifiers a caption of one row has no room for.
 */
function originBrief(
  origin: StyleOrigin,
  entry: StyleTraceEntry,
  editing: EditedAddress,
  controlDescendant: string | undefined
): string {
  const control = sourceControl(entry, controlDescendant);
  const ownBlock = origin.kind === "node" && origin.id === editing.nodeId;
  const parts = [ownBlock ? control : briefSubject(origin, editing)];
  // Defaults are no breakpoint's to edit, so naming one after them would send
  // an author to a tier where the value is not.
  const defaults = origin.kind === "element" || origin.kind === "blockType";
  if (!defaults && entry.breakpoint !== editing.breakpoint) {
    parts.push(editing.labelOf(entry.breakpoint));
  }
  if (entry.state !== editing.state) parts.push(stateLabel(entry.state));
  const named = parts.filter(part => part !== undefined);
  return named.length === 0 ? "this block" : named.join(" · ");
}

/** {@link originSubject}'s tiers, in the words a one-row caption can hold. */
function briefSubject(origin: StyleOrigin, editing: EditedAddress): string {
  switch (origin.kind) {
    case "class":
      return editing.sharedStyleName?.(origin.slug) ?? `.${origin.slug}`;
    case "blockType":
      return origin.type === editing.blockType
        ? "block defaults"
        : "enclosing block defaults";
    case "page":
      return "the page";
    // The tag as the HTML tag control shows it, which is where an author
    // meets it.
    case "element":
      return `${origin.tag.toUpperCase()} defaults`;
    case "node":
      return enclosingName(editing, origin.id);
  }
}

/** An enclosing block as the Layers panel names it, or in general words. */
function enclosingName(editing: EditedAddress, nodeId: string): string {
  return editing.nameOf?.(nodeId) ?? "an enclosing block";
}

/**
 * Which block, class or tier a value came from — the SUBJECT of the phrase.
 *
 * Split from {@link originName} because the address that qualifies it is the
 * same for every tier while the subject is different for each, and composing
 * both in one function made the tier answers hard to read past the qualifiers.
 *
 * A same-node origin resolves to the CONTROL where one differs, because there
 * the control is what the author must open: a rule reaches a control whose
 * descendant selector is more specific than its own — `linkColorHover` displays
 * the plain `a` declaration when no hover value exists — and told "this block",
 * the author cannot find the field that holds it.
 */
function originSubject(
  origin: StyleOrigin,
  editing: EditedAddress,
  control: string | undefined
): string {
  switch (origin.kind) {
    case "class":
      return editing.sharedStyleName?.(origin.slug) ?? `.${origin.slug}`;
    case "blockType":
      /*
       * The same problem the `node` case has, and it arrives by the same route:
       * `reachesThroughAncestor` asks `reachesNode` about each ancestor, and
       * that matches a `blockType` origin against the ANCESTOR's type. So a
       * descendant rule from an enclosing block's defaults reaches this control
       * carrying that block's type, not this one's.
       */
      return origin.type === editing.blockType
        ? "this block's defaults"
        : "an enclosing block's defaults";
    case "page":
      return "the page";
    // Named for what an author can act on. "the `h1` baseline" rather than the
    // tier's internal name, because the next thing they do is either override
    // it on this block or replace the baseline for the whole site, and both
    // start from knowing which element it keys on.
    case "element":
      return `the ${origin.tag} typography baseline`;
    case "node":
      if (origin.id !== editing.nodeId)
        return enclosingName(editing, origin.id);
      return control ?? "this block";
  }
}

/**
 * The label of the control a declaration came from, when it was not this one.
 *
 * `undefined` when the declaration belongs to this control's own address.
 *
 * The catalog is asked rather than the selector rendered: ` a` is not a name an
 * author has seen anywhere, while the property that writes it is the field they
 * are looking at.
 *
 * The multiple-writers guard is NOT currently reachable, and that is recorded
 * rather than left for someone to rediscover. Measured over the whole catalog,
 * exactly one `(cssProperty, descendant)` pair has two writers —
 * `background-image` with no descendant, from `background` and
 * `backgroundGradient` — and nothing writes `background-image` at a descendant
 * at all. So a differing descendant always resolves to one property today.
 *
 * It is kept because it is not redundant: nothing else stops this naming one of
 * two writers arbitrarily, and a control labelled with a field the author did
 * not touch is the failure this whole indicator exists to avoid. A catalog leaf
 * added at a descendant would reach it on the day it lands.
 */
function sourceControl(
  entry: StyleTraceEntry,
  controlDescendant: string | undefined
): string | undefined {
  const mine = (controlDescendant ?? "").trim();
  const theirs = (entry.descendant ?? "").trim();
  if (mine === theirs) return undefined;
  const writers = propertiesWriting(entry.property, entry.descendant);
  if (writers.length !== 1) return undefined;
  return fieldLabel(writers[0] ?? "");
}

/**
 * A breakpoint's author-facing name, or its id when the site defines no such
 * breakpoint.
 *
 * Resolved through `breakpointContexts` — the engine's own normalisation — and
 * not by searching the stored axes. The two disagree, and the disagreement is
 * exactly the case a label matters in. `breakpointContexts` sorts each axis
 * WIDEST-FIRST and then claims each id once, so of two rows storing the same id
 * the wider one survives and emits the rule; a raw search returns whichever was
 * stored first. With a narrow `dup` above a wider `dup`, the value on screen
 * comes from the wide row while the tooltip names the narrow one — an author
 * sent to a definition that did not produce the value.
 *
 * The surviving DEFINITION is then matched by axis and bound rather than by id
 * alone, because id alone is what is ambiguous here. Two rows sharing an id and
 * a bound differ only in their label, and the compiler's sort is stable, so the
 * first of those is the one it kept.
 *
 * Falling back to the id rather than to a placeholder: a value keyed to a
 * breakpoint the settings no longer define is exactly the case an author needs
 * to recognise, and "unknown" tells them nothing they can act on.
 */
export function breakpointLabel(
  breakpoints: BreakpointSet | undefined,
  id: BreakpointId
): string {
  // One matcher, in `style-provenance`. The survivor is found by BOUND as well
  // as id — among definitions sharing an id the compiler keeps one — and a
  // second lookup here would be a second place to lose that.
  return breakpointSource(id, breakpoints)?.label ?? id;
}

/**
 * What to call the place a value came from, as ONE address.
 *
 * Every axis that differs from what the panel is editing is named, not just the
 * first. Naming a subset is not a vaguer answer, it is a WRONG one: editing
 * hover at Tablet, a value arriving from base at Mobile labelled "this block at
 * Mobile" sends the author to a real address that does not hold the value, and
 * finding nothing there they conclude the indicator is broken.
 *
 * The qualifiers apply to EVERY tier, not only to a node. A class carries
 * responsive and interaction-state values of its own, so `.card` alone leaves an
 * author who opens the class editor at base looking at the wrong row — the same
 * misdirection, one tier over.
 *
 * The control is the SUBJECT for a same-node origin and a `via` clause for every
 * other tier, because that is what it means in each: on this block it is the
 * field to open, while on a class or an enclosing block it says which field's
 * rule reached here, and the place to go is still the class or the block.
 */
function originName(
  origin: StyleOrigin,
  entry: StyleTraceEntry,
  editing: EditedAddress,
  controlDescendant: string | undefined
): string {
  const label = sourceControl(entry, controlDescendant);
  const control = label === undefined ? undefined : `the ${label} control`;
  const ownControl = origin.kind === "node" && origin.id === editing.nodeId;
  const parts = [originSubject(origin, editing, control)];
  if (!ownControl && control !== undefined) parts.push(`via ${control}`);
  if (entry.breakpoint !== editing.breakpoint) {
    parts.push(`at ${editing.labelOf(entry.breakpoint)}`);
  }
  if (entry.state !== editing.state) {
    parts.push(`in its ${entry.state} state`);
  }
  return parts.join(" ");
}
