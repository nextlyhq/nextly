"use client";

/**
 * The value controls a variable's editor draws, one for each kind of value.
 *
 * A size is the block panel's own numeric field, a number beside its unit
 * menu, so a length is edited the same way wherever it is set. A line height
 * is a plain number read as a multiple of the text size, with an offer of
 * pixels when the number is too large to be meant as a multiple. Anything
 * else is a text field. Every field commits on blur or Enter, never per
 * keystroke, because a variable is read by the whole site.
 *
 * @module variable-value-controls
 */
import {
  getStyleProperty,
  resolveTokenPrefix,
  tokenCustomProperty,
  tokenIdentity,
  type SiteToken,
  type SiteTokenSet,
} from "@nextlyhq/blocks-engine";
import { Button, Input } from "@nextlyhq/ui";
import * as React from "react";

import { InheritedValue } from "./inherited-value";
import { styleControlsFor, type StyleControl } from "./style-controls";
import type { CommitOutcome } from "./style-field-surroundings";
import { CSS_NUMBER, lineHeightAsPixels } from "./style-numeric";
import { NumericField } from "./style-numeric-field";
import { typeScaleProperty } from "./tokens-studio";

/** What every value field is given. */
export interface ValueFieldProps {
  label: string;
  value: string;
  readOnly: boolean;
  /** The id of the reason, while this field holds a value that was refused. */
  refusedBy?: string | undefined;
  onCommit: (value: string) => void;
  /**
   * The CSS this value writes, shown on hover over a control that writes it
   * in other words: a number and a unit menu.
   */
  css?: string | undefined;
  /** Which of the variable's values this field edits. */
  mode?: "light" | "dark";
}

/**
 * The declaration a variable's value writes into the site's stylesheet: its
 * custom property, under the site's prefix, and the value. Named by the
 * engine's own rules, the ones the stylesheet is written with.
 */
export function variableCss(
  tokens: SiteTokenSet,
  token: SiteToken,
  value: string
): string {
  const { prefix } = resolveTokenPrefix(tokens.prefix);
  return `${tokenCustomProperty(tokenIdentity(token), prefix)}: ${value}`;
}

/**
 * What a field shows: the author's typing, until the stored value changes
 * underneath it (a reset, a refused save, an undo), which replaces it.
 *
 * A field keyed by its value would do the second by remounting, and would
 * then also remount after its own commit and drop the focus it had.
 */
export function useDraft(value: string): [string, (next: string) => void] {
  const [draft, setDraft] = React.useState(value);
  const [shown, setShown] = React.useState(value);
  if (shown !== value) {
    setShown(value);
    setDraft(value);
  }
  return [draft, setDraft];
}

/** A text field that commits when it loses focus or on Enter. */
function TextValue({
  label,
  value,
  readOnly,
  refusedBy,
  onCommit,
}: ValueFieldProps): React.JSX.Element {
  const id = React.useId();
  return (
    <div className="nx-vars-editor__field">
      <label className="nx-vars-editor__label" htmlFor={id}>
        {label}
      </label>
      <CommitInput
        id={id}
        value={value}
        readOnly={readOnly}
        refusedBy={refusedBy}
        onCommit={onCommit}
      />
    </div>
  );
}

/**
 * A value field that commits on blur or Enter, and only a real change: an
 * empty field or the value it already holds writes nothing. While it holds a
 * refused value, the value it held before is committed too, since putting it
 * back is how the author answers the refusal.
 */
function CommitInput({
  id,
  label,
  value,
  placeholder,
  readOnly,
  refusedBy,
  onCommit,
}: {
  id?: string;
  /** The field's name where no visible label points at it. */
  label?: string;
  value: string;
  placeholder?: string;
  readOnly: boolean;
  refusedBy?: string | undefined;
  onCommit: (value: string) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useDraft(value);
  const commit = (next: string): void => {
    if (
      !readOnly &&
      next.trim() !== "" &&
      (next.trim() !== value || refusedBy !== undefined)
    ) {
      onCommit(next);
    }
  };
  return (
    <Input
      id={id}
      aria-label={label}
      // A value, not words: no list of earlier entries over the field.
      autoComplete="off"
      aria-invalid={refusedBy === undefined ? undefined : true}
      aria-describedby={refusedBy}
      className="nx-vars-editor__mono"
      value={draft}
      placeholder={placeholder}
      onChange={event => setDraft(event.currentTarget.value)}
      readOnly={readOnly}
      onBlur={event => commit(event.currentTarget.value)}
      onKeyDown={event => {
        if (event.key === "Enter") commit(event.currentTarget.value);
      }}
    />
  );
}

/**
 * The control every size is edited with: a padding side's, a length with no
 * keywords that takes every unit a size variable is written in, widened to a
 * negative, which a size variable may hold for a margin or an offset. One
 * leaf for every size, so each one's menu is the same and offers what the
 * block panel offers for a length, and a negative keeps its unit like any
 * other number.
 */
const SIZE_CONTROL: StyleControl | undefined = sizeControl();

function sizeControl(): StyleControl | undefined {
  const padding = getStyleProperty("padding");
  if (padding === undefined) return undefined;
  const side = styleControlsFor(padding).controls.find(
    control => control.leaf.kind === "dimension"
  );
  if (side === undefined || side.leaf.kind !== "dimension") return undefined;
  return { ...side, leaf: { ...side.leaf, allowNegative: true } };
}

/**
 * Whether a field's text is the stored value again, as a field shows a value
 * it cannot split into a number and a unit (`clamp(…)`). The numeric field
 * writes nothing for that, since nothing changed, so a refusal standing over
 * the field is answered here instead.
 */
function restoresStored(text: string, value: string): boolean {
  return text.trim() === value.trim();
}

/**
 * What a size field's commit does: a real change is written, and anything
 * else, a cleared field or the value already held, writes nothing. A refused
 * value is written again when it is put back, as a text field does.
 */
function sizeCommit(
  value: string,
  refusedBy: string | undefined,
  onCommit: (value: string) => void
): (next: unknown) => CommitOutcome {
  return next => {
    if (typeof next !== "string" || next.trim() === "") return "unchanged";
    const typed = next.trim();
    if (typed === value && refusedBy === undefined) return "unchanged";
    onCommit(typed);
    return "applied";
  };
}

/**
 * A size with its unit menu and no visible label of its own, for a layout
 * that names its columns, such as a type size's pair. Read-only, it is the
 * plain field, which still lets a value be selected and copied.
 */
export function SizeInput({
  label,
  value,
  placeholder,
  readOnly,
  refusedBy,
  onCommit,
  css,
}: Omit<ValueFieldProps, "label"> & {
  label: string;
  /** What shows in an empty field: the light value, for a dark one. */
  placeholder?: string;
}): React.JSX.Element {
  const id = React.useId();
  if (readOnly || SIZE_CONTROL === undefined) {
    return (
      <CommitInput
        label={label}
        value={value}
        readOnly={readOnly}
        refusedBy={refusedBy}
        onCommit={onCommit}
        {...(placeholder === undefined ? {} : { placeholder })}
      />
    );
  }
  return (
    <>
      <label className="nx-sr-only" htmlFor={id}>
        {label}
      </label>
      <SizeField
        id={id}
        label={label}
        value={value}
        placeholder={placeholder}
        refusedBy={refusedBy}
        onCommit={onCommit}
        control={SIZE_CONTROL}
        css={css}
      />
    </>
  );
}

/** A size under its own label, as a variable's Light and Dark are laid out. */
function SizeValue({
  label,
  value,
  readOnly,
  refusedBy,
  onCommit,
  css,
}: ValueFieldProps): React.JSX.Element {
  const id = React.useId();
  if (readOnly || SIZE_CONTROL === undefined) {
    return (
      <TextValue
        label={label}
        value={value}
        readOnly={readOnly}
        refusedBy={refusedBy}
        onCommit={onCommit}
      />
    );
  }
  return (
    <div className="nx-vars-editor__field">
      <label className="nx-vars-editor__label" htmlFor={id}>
        {label}
      </label>
      <SizeField
        id={id}
        label={label}
        value={value}
        placeholder={undefined}
        refusedBy={refusedBy}
        onCommit={onCommit}
        control={SIZE_CONTROL}
        css={css}
      />
    </div>
  );
}

/** The block panel's numeric field over a variable's value. */
function SizeField({
  id,
  label,
  value,
  placeholder,
  refusedBy,
  onCommit,
  control,
  css,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string | undefined;
  refusedBy: string | undefined;
  onCommit: (value: string) => void;
  control: StyleControl;
  css: string | undefined;
}): React.JSX.Element {
  // Putting back what the field stored is how an author answers a refusal.
  const restore = (event: React.SyntheticEvent): void => {
    const field = event.target;
    if (refusedBy === undefined || !(field instanceof HTMLInputElement)) return;
    if (restoresStored(field.value, value)) onCommit(value);
  };
  return (
    // The light value shows as the empty dark field's hint, as a value
    // reaching a block's field from elsewhere shows in the block panel.
    <InheritedValue.Provider value={placeholder}>
      <div
        className="nx-vars-editor__size"
        title={css}
        onKeyDownCapture={event => {
          if (event.key === "Enter") restore(event);
        }}
        onBlurCapture={restore}
      >
        <NumericField
          id={id}
          control={control}
          stored={value === "" ? undefined : value}
          actionName={label}
          // No site variables offered: a variable holds a value of its own.
          tokens={undefined}
          describedBy={refusedBy}
          onCommit={sizeCommit(value, refusedBy, onCommit)}
        />
      </div>
    </InheritedValue.Provider>
  );
}

/**
 * A line height: a plain number, a multiple of the text size, marked "×"
 * while it is one. A typed unit is taken as it is.
 */
export function LineHeightInput({
  id,
  label,
  value,
  placeholder,
  readOnly,
  refusedBy,
  onCommit,
}: Omit<ValueFieldProps, "label"> & {
  /** The field's name where no visible label points at it. */
  label: string | undefined;
  id?: string;
  placeholder?: string;
}): React.JSX.Element {
  const times = CSS_NUMBER.test((value === "" ? placeholder : value) ?? "");
  return (
    <span className="nx-vars-editor__times">
      <CommitInput
        {...(id === undefined ? {} : { id })}
        {...(label === undefined ? {} : { label })}
        value={value}
        readOnly={readOnly}
        refusedBy={refusedBy}
        onCommit={onCommit}
        {...(placeholder === undefined ? {} : { placeholder })}
      />
      {times ? (
        <span className="nx-vars-editor__times-mark" title="Times the text size">
          ×
        </span>
      ) : null}
    </span>
  );
}

/**
 * The offer under a line height whose number reads as pixels: what it means
 * as it is, and the pixels it was probably meant as, in one press.
 *
 * A dark value takes the kind of its light one, so a dark line height cannot
 * become pixels while the light one is a multiple: there the hint says what
 * to change first rather than offering a press that would be refused.
 */
export function LineHeightHint({
  value,
  mode,
  readOnly,
  onCommit,
}: {
  value: string;
  mode: "light" | "dark";
  readOnly: boolean;
  onCommit: (value: string) => void;
}): React.JSX.Element | null {
  const pixels = lineHeightAsPixels(value);
  if (pixels === undefined) return null;
  const number = value.trim();
  if (mode === "dark") {
    return (
      <div className="nx-vars-editor__hint" role="note">
        <span>
          {`${number}× the text size. To use pixels, give the light line height pixels first.`}
        </span>
      </div>
    );
  }
  return (
    <div className="nx-vars-editor__hint" role="note">
      <span>{`${number}× the text size. Did you mean ${pixels}?`}</span>
      {readOnly ? null : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="nx-vars-editor__button"
          onClick={() => onCommit(pixels)}
        >
          {`Use ${pixels}`}
        </Button>
      )}
    </div>
  );
}

/**
 * The field a variable's Light and Dark values are edited with, for any
 * kind but a colour, which has its swatch and picker.
 */
export function valueFieldFor(
  token: SiteToken
): (props: ValueFieldProps) => React.JSX.Element {
  // A line height before a size: one stored as a length is still a line
  // height, and a number typed over it means a multiple, never a length.
  if (typeScaleProperty(token) === "line-height") return LineHeightValue;
  return token.kind === "dimension" ? SizeValue : TextValue;
}

/** A line height under its own label, with its hint, outside a type pair. */
function LineHeightValue({
  label,
  value,
  readOnly,
  refusedBy,
  onCommit,
  mode = "light",
}: ValueFieldProps): React.JSX.Element {
  const id = React.useId();
  return (
    <div className="nx-vars-editor__field">
      <label className="nx-vars-editor__label" htmlFor={id}>
        {label}
      </label>
      <LineHeightInput
        id={id}
        label={undefined}
        value={value}
        readOnly={readOnly}
        refusedBy={refusedBy}
        onCommit={onCommit}
      />
      <LineHeightHint
        value={value}
        mode={mode}
        readOnly={readOnly}
        onCommit={onCommit}
      />
    </div>
  );
}
