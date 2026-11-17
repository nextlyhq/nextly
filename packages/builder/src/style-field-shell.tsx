"use client";

/**
 * The shell around every Style tab control: its label, the control field
 * itself, the issue line under it, and the breakpoint actions beside it
 * (reset at the tier being edited, and jump to the tier a value came from).
 *
 * @module style-field-shell
 */
import type {
  BreakpointId,
  SiteTokenSet,
  StyleState,
  StyleValue,
} from "@nextlyhq/blocks-engine";
import { Label, TooltipProvider } from "@nextlyhq/ui";
import { RotateCcw } from "lucide-react";
import * as React from "react";

import { ChromeTooltip } from "./chrome-tooltip";
import { leafWrites } from "./code-hints";
import { CssHint, CssNamesLine, useDescribedWithNames } from "./css-hint";
import type { EditorState } from "./editor-state";
import { InheritedValue } from "./inherited-value";
import { LabelScrubRow, useLabelScrubProps } from "./label-scrub";
import { CompactSides, sideKeysFor } from "./spacing-box";
import { contrastObscuredAbove, contrastObscuredIn } from "./style-colour";
import { commitsFor, partnerColour } from "./style-colour-field";
import {
  ControlOrFont,
  showsNoField,
  UnsupportedField,
} from "./style-control-value";
import type { StyleControl } from "./style-controls";
import {
  type ProvenanceAnswer,
  type ProvenanceOf,
  NamedAbove,
  TokenPrefixContext,
  type EditedAddress,
} from "./style-field-surroundings";
import { targetKey, useFieldTarget } from "./style-field-target";
import type { BreakpointBadge, BreakpointSource } from "./style-provenance";
import { SharedValueLine, ProvenanceDot } from "./style-provenance-indicators";
import { labelFocusOnly } from "./style-value-fields";
import type { StyleAddress, StylePolicy } from "./style-values";

/** One editable position, drawn as the control its leaf kind resolves to. */
/**
 * A style field's label: its words, and the dot saying where the value came from.
 *
 * Its own component because the two parts are hidden INDEPENDENTLY. Inside a
 * box of logical sides the words are noise — position is saying which edge this
 * is — while the provenance dot says whether the side is authored or inherited,
 * which position cannot tell anyone. So the words are wrapped in an element the
 * stylesheet can clip on its own; clipping the label would take the dot and its
 * focus-revealed explanation with it.
 *
 * @param props - the label's identity, its words, and the provenance to show
 * @returns the label element
 */
function StyleFieldLabel({
  id,
  htmlFor,
  readOnly,
  focusOnly,
  title,
  label,
  answer,
  editing,
  descendant,
}: {
  id: string;
  htmlFor: string;
  /**
   * Whether the control cannot be edited, in which case the label names NOTHING.
   *
   * A label pointing at a read-only field would move focus into a control an
   * author cannot use. Decided here rather than by the caller so the field is
   * left saying what it wants drawn rather than how to draw it.
   */
  readOnly: boolean;
  /**
   * Whether the control is a group of buttons. A label's `for` would CLICK
   * a button, choosing or clearing a value; this label only moves focus to
   * the element the id names, the group's tab stop.
   */
  focusOnly: boolean;
  title: string | undefined;
  label: string;
  answer: ProvenanceAnswer | undefined;
  editing: EditedAddress;
  descendant: string | undefined;
}): React.JSX.Element {
  const namedAbove = React.useContext(NamedAbove);
  // Dragging the label to change a number field's value, while it can.
  const scrub = useLabelScrubProps();
  return (
    <Label
      id={id}
      htmlFor={readOnly || focusOnly ? undefined : htmlFor}
      title={title}
      data-named-above={namedAbove ? "" : undefined}
      // A read-only field's label names nothing, so it drags nothing either.
      {...(readOnly ? {} : scrub)}
      {...(focusOnly && !readOnly
        ? {
            onClick: (event: React.MouseEvent<HTMLLabelElement>) =>
              event.currentTarget.ownerDocument
                .getElementById(htmlFor)
                ?.focus(),
          }
        : {})}
    >
      <span className="nx-style-inspector__field-label-text">{label}</span>
      <ProvenanceDot
        answer={answer}
        editing={editing}
        descendant={descendant}
      />
    </Label>
  );
}

/**
 * What reaches a control from another tier, shown in it while nothing is set
 * here. Read from the same answer as the dot, so the two never disagree.
 */
function inheritedShown(
  stored: StyleValue | undefined,
  answer: ProvenanceAnswer | undefined
): string | undefined {
  if (stored !== undefined || answer?.provenance.kind !== "inherited") {
    return undefined;
  }
  return answer.provenance.entry.value;
}

export function StyleControlField({
  control,
  side,
  label,
  summary,
  propertyLabel,
  clearOnly,
  nodeId,
  state,
  breakpoint,
  editor,
  policy,
  tokens,
  prefersDark,
  provenanceOf,
  editing,
}: {
  control: StyleControl;
  /**
   * Which side of a box this field draws, when the property is drawn as one.
   *
   * Present only where the panel decided a box is justified, and read by the
   * stylesheet to PLACE the field. Placement by identity rather than by the
   * field's position among its siblings, because that list varies: the property
   * heading, a form selector and the notice for a withdrawn property are all
   * siblings, so a rule counting elements moves every side the moment one of
   * them appears.
   */
  side?: string;
  label: string;
  summary: string | undefined;
  /**
   * The whole property's name, for naming an ACTION rather than a field.
   *
   * A field is labelled by its position — "Block start" — which is enough
   * beside its own property's heading and not enough on a button: `padding` and
   * `margin` both have a block start, so two buttons called "Clear block start"
   * name the same thing twice and a screen-reader user cannot tell which style
   * each removes.
   */
  propertyLabel: string;
  /**
   * Whether this value may only be REMOVED, not changed.
   *
   * True for a property the block's `supports` no longer declares. The value is
   * still emitted — nothing in validation or compilation reads `supports` — so
   * withholding the control entirely would leave styling on the page that the
   * author can see and cannot remove. Letting them go on EDITING it is the
   * other error: it writes new values through a capability the block has
   * withdrawn, which is the definition the panel is supposed to be reading.
   */
  clearOnly: boolean;
  nodeId: string;
  state: StyleState;
  breakpoint: BreakpointId;
  editor: EditorState;
  policy: StylePolicy | undefined;
  tokens: SiteTokenSet | undefined;
  prefersDark: boolean;
  provenanceOf: ProvenanceOf;
  editing: EditedAddress;
}): React.JSX.Element {
  const id = React.useId();
  // The message's own id, so the control can point at it. A `role="alert"`
  // announces once and then it is gone: a screen-reader user who returns to the
  // field, or meets several rejected controls, has no way to tell which message
  // belongs to which without the relationship being stated.
  const errorId = `${id}-error`;
  const address: StyleAddress = {
    state,
    breakpoint,
    property: control.property,
    path: control.path,
  };
  const writes = useFieldTarget({ editor, nodeId, address, policy });
  const { target, nodeStyles, styles, stored, issue } = writes;
  const pairedColour = partnerColour(control.leaf, styles, address);
  // This node's own styles first, then every ancestor's. An ancestor's
  // `opacity`, `filter` or `mixBlendMode` composites this node along with the
  // rest of the subtree, so both colours reach the eye altered and the ratio
  // between the two stored values describes a rendering that does not happen.
  const obscuredBy =
    contrastObscuredIn(styles) ??
    contrastObscuredAbove(editor.document.nodes, nodeId);
  const actionName = actionNameFor(propertyLabel, label);

  const commit = writes.commit;
  /*
   * The provenance and its breakpoint reading, from ONE ranking of the trace.
   * The dot and the action are two readings of one answer, not two answers.
   */
  const answer = provenanceOf(control.leaf);
  const inherited = inheritedShown(stored, answer);

  const readOnly = showsNoField(control, stored, clearOnly);
  // A spacing-box side resets by key: see `sideKeysFor`.
  const inBox = React.useContext(CompactSides);
  const sideKeys = sideKeysFor(side, inBox, stored, readOnly, id, commit);
  const labelId = `${id}-label`;
  // Computed once and used by both the control and its message: two spellings
  // of "is there an error" is the shape that drifts into a control described by
  // a message it is not marked invalid for.
  const namesId = `${id}-css`;
  const describedBy = useDescribedWithNames(issueId(issue, errorId), namesId);
  const tokenPrefix = React.useContext(TokenPrefixContext);

  if (!control.supported) {
    return (
      <UnsupportedField
        labelId={labelId}
        label={label}
        summary={summary}
        actionName={actionName}
        leafKind={control.leaf.kind}
        stored={stored}
        onClear={() => commit(null)}
      />
    );
  }

  return (
    // What it writes, on hover or keyboard focus anywhere in the field.
    <CssHint
      summary={summary}
      writes={leafWrites(control.leaf, stored, tokenPrefix)}
    >
      <div
        className="nx-inspector__field"
        data-control={control.kind}
        // Absent when this is not a side: React omits an `undefined` attribute, so
        // the value says whether the field is in a box without a branch here.
        data-side={side}
        onKeyDown={sideKeys.onKeyDown}
        {...writes.caption}
      >
        {/* The label drags the value the number field below offers it. */}
        <LabelScrubRow subject={`${nodeId} ${targetKey(writes.target)}`}>
          <StyleFieldLabel
            id={labelId}
            htmlFor={id}
            readOnly={readOnly}
            focusOnly={labelFocusOnly(control.leaf, stored)}
            title={undefined}
            label={label}
            answer={answer}
            editing={editing}
            descendant={control.leaf.descendant}
          />
          <InheritedValue.Provider value={inherited}>
            <ControlOrFont
              id={id}
              labelledBy={labelId}
              control={control}
              stored={stored}
              actionName={actionName}
              clearOnly={clearOnly}
              tokens={tokens}
              prefersDark={prefersDark}
              pairedColour={pairedColour}
              obscuredBy={obscuredBy}
              describedBy={describedBy}
              onCommit={commit}
            />
          </InheritedValue.Provider>
        </LabelScrubRow>
        <CssNamesLine id={namesId} names={[control.leaf.cssProperty]} />
        <BreakpointAction
          answer={answer}
          label={actionName}
          editing={editing}
          fieldId={id}
          onReset={() => commit(null)}
          stored={stored}
          readOnly={readOnly}
          resetByKey={sideKeys.resetByKey}
        />
        {sideKeys.hint}
        <SharedValueLine
          target={target}
          answer={answer}
          nodeStyles={nodeStyles}
          address={address}
          actionName={actionName}
          onResetBlock={writes.resetBlock}
          onMoveTo={writes.moveTo}
        />
        <FieldIssue id={errorId} issue={issue} />
      </div>
    </CssHint>
  );
}

/** The id a field's refusal is said under, or none while nothing is refused. */
function issueId(issue: unknown, errorId: string): string | undefined {
  return issue === null ? undefined : errorId;
}

/** A field's refusal, which the control points at by its id; nothing without one. */
function FieldIssue({
  id,
  issue,
}: {
  id: string;
  issue: string | null;
}): React.JSX.Element | null {
  if (issue === null) return null;
  return (
    <p className="nx-inspector__error" id={id} role="alert">
      {issue}
    </p>
  );
}

/**
 * The action a control's breakpoint provenance earns, or nothing.
 *
 * Rendered ONLY where it means something: a Reset for a value authored at the
 * tier being edited, a Jump for a value that arrived from another tier, and
 * nothing at all for the unset controls that are the large majority of a panel.
 *
 * That bound is the whole design. {@link ProvenanceDot} refuses to be focusable
 * because a stop per control would double the presses to cross a section of
 * eight or more — and the same objection would apply here if every control
 * carried a button. Tying the affordance to the state that makes it meaningful
 * puts the cost only on controls the author has actually touched.
 *
 * AFTER the input in DOM order, so a keyboard user reaches the value first and
 * the action second. Before it, every control would answer its own question in
 * the wrong order: what to do about a value, then the value.
 *
 * Jump is withheld when no handler is supplied rather than rendered inert. A
 * host that cannot move the canvas — one with no width to move — would
 * otherwise offer a button that does nothing, which is worse than a missing
 * affordance because it reads as a broken one.
 */
function BreakpointAction({
  answer,
  label,
  editing,
  fieldId,
  onReset,
  stored,
  readOnly,
  resetByKey = false,
}: {
  answer: ProvenanceAnswer | undefined;
  /**
   * The control's ACTION NAME — the containing property and the leaf together.
   *
   * The leaf label alone is not unique: `margin` and `padding` both have a
   * block start, so two controls would offer buttons called "Reset Block start"
   * and a screen-reader user could not tell which style each removes. The panel
   * already computes this for exactly that reason, and `Clear` on a token value
   * uses it.
   */
  label: string;
  editing: EditedAddress;
  /** The field this control's actions write, passed on to {@link ResetAction}. */
  fieldId: string;
  onReset: () => void;
  /** What this address stores: with no cascade, reset while it holds anything. */
  stored: StyleValue | undefined;
  /** A field drawn as a retained value, whose own Clear already resets it. */
  readOnly: boolean;
  /** A field that resets by a key of its own: its reset leaves the Tab order. */
  resetByKey?: boolean;
}): React.JSX.Element | null {
  /*
   * The row's one way back, so a list or an icon group needs no Clear of its
   * own. With a cascade it follows the cascade's answer: a value authored at
   * this tier is reset, revealing whatever shows through, and one arriving
   * from another tier is a jump there.
   *
   * Where the cascade gives no answer for this row — none was supplied, or
   * the tier being edited is one the canvas is not showing, so its values
   * read as unset — a value stored at this address is still reset, unless the
   * field is a retained value with a Clear of its own. What it reveals is not
   * known there, so the reset does not claim it.
   */
  const badge = answer?.badge;
  if (badge === undefined || badge.kind === "none") {
    if (stored === undefined || readOnly) return null;
    return (
      <ResetAction
        revealed="unknown"
        label={label}
        editing={editing}
        fieldId={fieldId}
        onReset={onReset}
        outOfTabOrder={resetByKey}
      />
    );
  }
  if (badge.kind === "authored") {
    return (
      <ResetAction
        revealed={revealedBy(badge)}
        label={label}
        editing={editing}
        fieldId={fieldId}
        onReset={onReset}
        outOfTabOrder={resetByKey}
      />
    );
  }
  /*
   * The value showing came from another tier. A value stored HERE as well is
   * shadowed by it, and is still this row's to remove: the reset stays beside
   * the jump, naming nothing it reveals, since what shows here once it is
   * gone is the winning tier's business.
   */
  const reset =
    stored === undefined || readOnly ? null : (
      <ResetAction
        revealed="unknown"
        label={label}
        editing={editing}
        fieldId={fieldId}
        onReset={onReset}
        outOfTabOrder={resetByKey}
      />
    );
  if (answer?.jump === undefined) return reset;
  return (
    <>
      {reset}
      <JumpAction source={badge.source} label={label} onJump={answer.jump} />
    </>
  );
}

/**
 * What to call a breakpoint source in front of an author.
 *
 * ONE naming for both actions. `BreakpointSource` carries the axis precisely
 * because a site defining both makes a bare tier name ambiguous — and a
 * container tier may share its label with a viewport one — so a reset saying
 * "showing the value from Tablet" while a jump says "Tablet (container)" leaves
 * the author to work out that the two Tablets are different tiers.
 */
function sourceLabel(source: BreakpointSource): string {
  return source.axis === "container"
    ? `${source.label} (container)`
    : source.label;
}

/**
 * What a reset reveals, from an authored badge: another tier, nothing, or a
 * value passed down from an enclosing block or the page, which no tier names.
 */
function revealedBy(
  badge: Extract<BreakpointBadge, { kind: "authored" }>
): BreakpointSource | "unset" | "unknown" {
  if (badge.revealed !== undefined) return badge.revealed;
  return badge.passedDown === true ? "unknown" : "unset";
}

/**
 * Clear this control at the tier being edited, saying what will show through.
 *
 * "Reset" alone asks an author to guess whether the control becomes unset or
 * falls back to a wider tier's value. In a desktop-first cascade it is usually
 * the second, and not always base — so the fallback is named, in the accessible
 * name AND in visible text, because computing it exists to remove that guess
 * for everybody rather than for screen-reader users alone.
 */
function ResetAction({
  revealed,
  label,
  editing,
  fieldId,
  onReset,
  outOfTabOrder = false,
}: {
  /** Out of the Tab order (still clickable): its field resets by key. */
  outOfTabOrder?: boolean;
  /**
   * What shows once this value is gone: another tier's value, nothing, or
   * `"unknown"` where no ranking of the cascade covers this tier, which the
   * names then leave unsaid rather than guess.
   */
  revealed: BreakpointSource | "unset" | "unknown";
  label: string;
  editing: EditedAddress;
  /** The field whose value this press writes. See {@link commitsFor}. */
  fieldId: string;
  onReset: () => void;
}): React.JSX.Element {
  const at = `Reset ${label} at ${editing.labelOf(editing.breakpoint)}`;
  const named =
    revealed === "unknown"
      ? at
      : revealed === "unset"
        ? `${at}, leaving it unset`
        : `${at}, showing the value from ${sourceLabel(revealed)}`;
  const tip =
    revealed === "unknown"
      ? "Reset"
      : revealed === "unset"
        ? "Reset to unset"
        : `Reset to ${sourceLabel(revealed)}`;
  return (
    <TooltipProvider delayDuration={300}>
      <ChromeTooltip content={tip}>
        <button
          type="button"
          className="nx-style-inspector__breakpoint-action"
          data-action="reset"
          {...commitsFor(fieldId)}
          onClick={onReset}
          tabIndex={outOfTabOrder ? -1 : undefined}
          aria-label={named}
        >
          {/* An icon at the row's end, where a "Reset to unset" line under
                every set control made each one two rows. The words are its
                tooltip and, in full, its name. */}
          <RotateCcw size={14} aria-hidden="true" />
        </button>
      </ChromeTooltip>
    </TooltipProvider>
  );
}

/**
 * Take the canvas to the tier this control's value was authored at.
 *
 * The AXIS is named beside the tier, since a site defining both makes a bare
 * tier name ambiguous and the container axis is the one an author is least
 * likely to be holding in mind.
 */
function JumpAction({
  source,
  label,
  onJump,
}: {
  source: BreakpointSource;
  label: string;
  onJump: () => void;
}): React.JSX.Element {
  const where = sourceLabel(source);
  return (
    <button
      type="button"
      className="nx-style-inspector__breakpoint-action"
      data-action="jump"
      onClick={onJump}
      aria-label={`Edit ${label} at ${where}, where its value was set`}
    >
      {/* The source, as the caption beside an inherited value says it, and
          the way there: one line rather than a caption and a "Go to". */}
      From {where}
    </button>
  );
}

function actionNameFor(propertyLabel: string, label: string): string {
  return propertyLabel === label
    ? propertyLabel
    : `${propertyLabel} ${label.toLowerCase()}`;
}
