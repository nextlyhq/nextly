"use client";

/**
 * Which control a style property draws: the font control or the value
 * control, a held variable, a retained value the control cannot show, and
 * the field drawn for a value no control supports.
 *
 * @module style-control-value
 */
import {
  isTokenRef,
  type FontFaceDef,
  type SiteTokenSet,
  type StyleLeaf,
  type StyleValue,
  tokenRef,
} from "@nextlyhq/blocks-engine";
import { Label } from "@nextlyhq/ui";
import * as React from "react";

import {
  FontChoicesContext,
  FontFamilyField,
  fontFamilyShowable,
  type FontChoices,
} from "./font-family-field";
import { BASELINE_WITHHELD_HINT } from "./style-baseline";
import { colourShowable } from "./style-colour";
import { ColourField } from "./style-colour-field";
import type { StyleControl } from "./style-controls";
import type { CommitOutcome } from "./style-field-surroundings";
import { displayText, editableText } from "./style-text-field";
import { variableLeafOf, FoldedUnion, ValueField } from "./style-value-fields";
import { VariableChip } from "./variable-choice";

/** No faces, as one value, so the Font control's list is not rebuilt each render. */
const NO_FACES: readonly FontFaceDef[] = Object.freeze([]);

/**
 * The Font control where the leaf is `font-family`, chosen from what the site
 * can draw before any other surface (a stored variable shows as the choice it
 * is); every other value as {@link ControlValue} draws it. A value that can
 * only be cleared stays that way.
 */
export function ControlOrFont(
  props: Parameters<typeof ControlValue>[0]
): React.JSX.Element {
  const fonts = React.useContext(FontChoicesContext);
  const font = props.clearOnly ? null : fontControl({ ...props, fonts });
  return font ?? <ControlValue {...props} />;
}

/**
 * The Font control, for the `font-family` leaf: CHOSEN from what the site can
 * draw rather than typed, since a typed family the site has no file for
 * renders in whatever the reader's device has. `null` for any other leaf, or
 * a stored value the picker cannot show.
 */
function fontControl({
  id,
  labelledBy,
  control,
  stored,
  tokens,
  fonts,
  onCommit,
}: {
  id: string;
  labelledBy: string;
  control: Parameters<typeof ControlValue>[0]["control"];
  stored: Parameters<typeof ControlValue>[0]["stored"];
  tokens: Parameters<typeof ControlValue>[0]["tokens"];
  fonts: FontChoices | undefined;
  onCommit: Parameters<typeof ControlValue>[0]["onCommit"];
}): React.JSX.Element | null {
  const isFontFamily =
    control.leaf.kind === "cssValue" &&
    control.leaf.cssProperty === "font-family";
  if (!isFontFamily || !fontFamilyShowable(stored)) return null;
  const manage = fonts?.onManageFonts;
  return (
    <FontFamilyField
      id={id}
      labelledBy={labelledBy}
      stored={stored}
      tokens={tokens}
      faces={fonts?.faces}
      fromCode={fonts?.fromCode ?? NO_FACES}
      onCommit={onCommit}
      {...(manage === undefined ? {} : { onManageFonts: manage })}
    />
  );
}

/**
 * The surface one value is shown through: read-only, a token, or editable.
 *
 * Its own component rather than a chain of conditionals inside the field,
 * because the three are genuinely different surfaces — one of them cannot be
 * typed into at all — and reading them as early returns says that, where a
 * nested ternary reads as one control with two exceptions.
 */
function ControlValue({
  id,
  labelledBy,
  control,
  stored,
  actionName,
  clearOnly,
  tokens,
  prefersDark,
  pairedColour,
  obscuredBy,
  describedBy,
  onCommit,
}: {
  id: string;
  labelledBy: string;
  control: StyleControl;
  stored: StyleValue | undefined;
  actionName: string;
  clearOnly: boolean;
  tokens: SiteTokenSet | undefined;
  /** Whether the viewer's system asks for dark, for a site on the media strategy. */
  prefersDark: boolean;
  /** The other half of this control's contrast pair, when its leaf has one. */
  pairedColour: StyleValue | undefined;
  /**
   * A property on this node that puts something between the pair, or
   * `undefined` when none does. A verdict is withheld while one is set.
   */
  obscuredBy: string | undefined;
  describedBy: string | undefined;
  onCommit: (value: StyleValue | null) => CommitOutcome;
}): React.JSX.Element {
  // Read before any branch, as hooks must be: a folded union offers the
  // variables either of its arms takes.
  const fold = React.useContext(FoldedUnion);
  if (clearOnly) {
    return (
      <RetainedValue
        labelledBy={labelledBy}
        label={actionName}
        stored={stored}
        // A value the Baseline gate no longer offers says why it is clear-only.
        note={control.withheld ? BASELINE_WITHHELD_HINT : undefined}
        onClear={() => onCommit(null)}
      />
    );
  }
  /*
   * A colour draws its own surface, INCLUDING for a stored token reference.
   *
   * Placed before the token branch below rather than after it, because that one
   * returns for every reference and a colour control would never see one. It
   * exists for controls that cannot offer a token picker, and says so: choosing
   * a token was "the token picker's job and it does not exist yet". For a
   * colour it now does, so a reference here is editable rather than read-only.
   *
   * Narrowed on the LEAF rather than on `control.kind`, because the leaf is what
   * carries `tokenKinds` and `cssProperty` — the two facts the colour surface
   * asks the catalog for — so passing it narrowed means neither is re-derived.
   *
   * Guarded by {@link colourShowable}, so a value NO colour control can
   * represent — an object at a scalar position from an import or the API — does
   * not take this branch and skip the read-only surface below. Without it the
   * field projects that object to an empty draft and reads as unset while the
   * value goes on compiling, which is the failure the surface below exists to
   * prevent.
   */
  if (control.leaf.kind === "color" && colourShowable(stored)) {
    return (
      <ColourField
        id={id}
        labelledBy={labelledBy}
        control={{ ...control, leaf: control.leaf }}
        stored={stored}
        actionName={actionName}
        tokens={tokens}
        prefersDark={prefersDark}
        pairedColour={pairedColour}
        obscuredBy={obscuredBy}
        describedBy={describedBy}
        onCommit={onCommit}
      />
    );
  }
  /*
   * A held variable, by name in place of the typed value, the name the way to
   * choose another. Every reference reaches this, including one at a leaf
   * that takes no variable or to a variable the site no longer has: the chip
   * still names it, the name opens a list only where a choice exists, and the
   * row's Reset removes it.
   * Typing over a reference is not offered, because the text would store the
   * variable's NAME as a literal, which compiles to nothing.
   */
  if (isTokenRef(stored)) {
    return (
      <HeldVariable
        id={id}
        labelledBy={labelledBy}
        leaf={variableLeafOf(control.leaf, fold)}
        identity={stored.$token}
        times={stored.times}
        actionName={actionName}
        tokens={tokens}
        onCommit={onCommit}
      />
    );
  }
  // A value the editing surface below cannot represent. Drawing it anyway is
  // the worst of the three outcomes: the control reads as unset, the value goes
  // on compiling, and the keystroke that would clear it is the one the field
  // refuses. Shown and removable instead, which is what the other two branches
  // already do for the other two kinds of unteachable value.
  if (editableText(control, stored) === undefined) {
    return (
      <RetainedValue
        labelledBy={labelledBy}
        label={actionName}
        stored={stored}
        note="No control here can edit this value. It is still on the page and can be cleared."
        onClear={() => onCommit(null)}
      />
    );
  }
  return (
    <ValueField
      id={id}
      labelledBy={labelledBy}
      control={control}
      stored={stored}
      actionName={actionName}
      tokens={tokens}
      describedBy={describedBy}
      onCommit={onCommit}
    />
  );
}

/**
 * The reference a chip commits when another variable replaces its own: the
 * new variable at the held one's scale, which is the size it was set to (a
 * Small button's padding), not a property of the variable.
 */
export function pickedReference(
  picked: string,
  times: number | undefined
): { $token: string; times?: number } {
  // Built by the engine's one constructor, which a reader of stored text
  // derives the reference's spelling from.
  return tokenRef(picked, times);
}

/**
 * A field holding a variable: the green chip naming it, its name the way to
 * choose another, and its Unlink, which puts the typed field back holding the
 * variable's value.
 */
function HeldVariable({
  id,
  labelledBy,
  leaf,
  identity,
  times,
  actionName,
  tokens,
  onCommit,
}: {
  /** The id the typed field takes again once the variable is cleared. */
  id: string;
  labelledBy: string;
  /** The leaf the field's variables are offered for; see `variableLeafOf`. */
  leaf: StyleLeaf;
  identity: string;
  /** The factor the variable is scaled by, if it is. */
  times?: number | undefined;
  actionName: string;
  tokens: SiteTokenSet | undefined;
  onCommit: (value: StyleValue | null) => CommitOutcome;
}): React.JSX.Element {
  // A scaled variable stays scaled when another replaces it: the factor is
  // the size it was set to (a Small button's padding), not the variable's.
  const pick = (picked: string): CommitOutcome =>
    onCommit(pickedReference(picked, times));
  const unlink = (value: StyleValue): void => {
    // Unlinking puts the typed field back in the chip's place, holding the
    // value, and the Unlink that held focus is gone: focus goes to that field
    // once it is drawn, rather than falling to the page. One commit, so one
    // undo puts the variable back.
    if (onCommit(value) === "refused") return;
    requestAnimationFrame(() => {
      document.getElementById(id)?.focus();
    });
  };
  return (
    <div className="nx-style-inspector__numeric">
      <VariableChip
        leaf={leaf}
        tokens={tokens}
        identity={identity}
        times={times}
        label={actionName}
        labelledBy={labelledBy}
        onPick={pick}
        onUnlink={unlink}
      />
    </div>
  );
}

/**
 * A value that is live on the page and cannot be edited here: shown, and
 * removable.
 *
 * Three different reasons reach this one surface — the block's `supports` no
 * longer declares the property, no control in this build can draw the leaf's
 * kind, or the stored value has a shape the control cannot represent — and they
 * share it because the author's position is identical in all three: the styling
 * is on the page, nothing here can change it, and the panel owes them the
 * action that removes it. `note` is what tells them WHICH of the three, since
 * only the first has a notice of its own beside the property.
 *
 * Named for the property for the same reason the variable chip is — several of
 * these on one panel would otherwise be a column of identical "Clear" buttons.
 */
function RetainedValue({
  labelledBy,
  label,
  stored,
  note,
  onClear,
}: {
  /** The id of the label element that names this value. */
  labelledBy: string;
  label: string;
  stored: StyleValue | undefined;
  /** Why this value cannot be edited, where the property does not already say. */
  note?: string;
  onClear: () => void;
}): React.JSX.Element {
  const noteId = React.useId();
  return (
    <>
      {/*
        `group` for the reason the variable chip carries one: the ARIA
        `paragraph` role a bare paragraph maps to prohibits an accessible name.

        The note is pointed AT rather than left beside: it is the only thing
        saying why this value cannot be edited, and a group announced with its
        name and its Clear button but not its reason tells a screen-reader user
        that a field is read-only without ever saying what made it so.
      */}
      <p
        className="nx-style-inspector__token"
        role="group"
        aria-labelledby={labelledBy}
        aria-describedby={note === undefined ? undefined : noteId}
        tabIndex={-1}
      >
        {/*
          `displayText` rather than the text-field projection, which answers
          `""` for a shape it cannot type — and an empty span beside a Clear
          button asks an author to remove something they cannot see.
        */}
        <span>{displayText(stored)}</span>
        <button type="button" onClick={onClear} aria-label={`Clear ${label}`}>
          Clear
        </button>
      </p>
      {note === undefined ? null : (
        <p className="nx-inspector__note" id={noteId}>
          {note}
        </p>
      )}
    </>
  );
}

/**
 * Whether this position renders no element a label can be attached to.
 *
 * HTML's `for` only associates a label with a LABELABLE element — input,
 * select, textarea, button, output, meter, progress. Pointing it at the
 * paragraph the read-only surfaces render drops the association SILENTLY, so
 * the label carries an id of its own and the value points back at it instead.
 *
 * `control.supported` is not a term here: the caller returns before this is
 * read, so including it would be a condition that can never be true where it
 * is used.
 */
export function showsNoField(
  control: StyleControl,
  stored: StyleValue | undefined,
  clearOnly: boolean
): boolean {
  if (clearOnly) return true;
  // Every reference, whatever the control. The colour surface reaches this the
  // same way the others do: it draws a name and a button for a reference and a
  // text field only for a literal, so a reference has no field there either.
  if (isTokenRef(stored)) return true;
  return editableText(control, stored) === undefined;
}

/**
 * A position this build has no control for: shown by value, and removable.
 *
 * Its own component because it is a different SURFACE rather than a variation
 * of one — nothing here is editable, so no labelable element exists and the
 * label has to name the value by id instead of pointing at a field.
 *
 * UNTESTED as a CATALOG case, and stated rather than left to be assumed: every
 * leaf kind the engine ships resolves to a control, so only a catalog written
 * by a newer engine reaches this — and the catalog is compiled in rather than
 * registered, so no fixture can hand this panel an unknown kind. What IS
 * reachable and IS covered is the value: a node can store one at such a leaf,
 * and it compiles.
 */
export function UnsupportedField({
  labelId,
  label,
  summary,
  actionName,
  leafKind,
  stored,
  onClear,
}: {
  labelId: string;
  label: string;
  summary: string | undefined;
  actionName: string;
  leafKind: StyleLeaf["kind"];
  stored: StyleValue | undefined;
  onClear: () => void;
}): React.JSX.Element {
  return (
    <div className="nx-inspector__field" data-unsupported={leafKind}>
      {/* No `htmlFor`: this branch renders no labelable element. */}
      <Label id={labelId} title={summary}>
        {label}
      </Label>
      <RetainedValue
        labelledBy={labelId}
        label={actionName}
        stored={stored}
        note={`This build has no control for ${leafKind} values.`}
        onClear={onClear}
      />
    </div>
  );
}
