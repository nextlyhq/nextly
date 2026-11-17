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
  emitTokenBlocks,
  getStyleProperty,
  resolveTokenPrefix,
  tokenCustomProperty,
  tokenIdentity,
  type SiteToken,
  type SiteTokenSet,
} from "@nextlyhq/blocks-engine";
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@nextlyhq/ui";
import * as React from "react";

import { isInput } from "./dom-kind";
import { FontChoicesContext, FontFamilyField } from "./font-family-field";
import { NAMED_WEIGHTS, weightName, weightsDrawn } from "./font-library";
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
 * Closes the variable's editor for a control that sends the author elsewhere
 * in the panel, such as a font's "Manage fonts…", without handing focus back
 * to the row: the place the author is sent to takes it. Absent outside an
 * editor.
 */
export const CloseVariableEditor: React.Context<(() => void) | undefined> =
  React.createContext<(() => void) | undefined>(undefined);

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
 * The control every number is edited with: a flex grow's, a plain number,
 * widened past its floor of zero, since a number variable may be read by any
 * property that takes one. The block panel draws numbers with the same field.
 */
const NUMBER_CONTROL: StyleControl | undefined = numberControl();

function numberControl(): StyleControl | undefined {
  const grow = getStyleProperty("flexGrow");
  if (grow === undefined) return undefined;
  const control = styleControlsFor(grow).controls.find(
    candidate => candidate.leaf.kind === "number"
  );
  if (control === undefined || control.leaf.kind !== "number") return undefined;
  const leaf = { ...control.leaf };
  delete leaf.min;
  return { ...control, leaf };
}

/**
 * Why a value cannot be written into the site's stylesheet, in the words the
 * stylesheet's own writer uses, or nothing when it can. Asked of the writer
 * itself, with the variable alone, so the field refuses exactly what the
 * site's save would refuse: a value that would load a file, among others.
 */
export function unwritableValue(
  tokens: SiteTokenSet,
  token: SiteToken,
  value: string
): string | undefined {
  const alone: SiteTokenSet = {
    tokens: [{ ...token, values: { light: value } }],
    ...(tokens.prefix === undefined ? {} : { prefix: tokens.prefix }),
  };
  const { emitted, issues } = emitTokenBlocks(alone, ":root");
  if (emitted.length > 0) return undefined;
  return (
    issues.find(issue => issue.severity === "error")?.message ??
    "This value cannot be used."
  );
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
    // A number field commits a number, which a variable stores as text.
    const text = typeof next === "number" ? String(next) : next;
    if (typeof text !== "string" || text.trim() === "") return "unchanged";
    const typed = text.trim();
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

/**
 * A size under its own label, as a variable's Light and Dark are laid out,
 * and as a shadow layer's offsets, blur and spread are.
 */
export function SizeValue(props: ValueFieldProps): React.JSX.Element {
  return <NumericValue {...props} control={SIZE_CONTROL} />;
}

/** A number under its own label: the numeric field, with no unit to choose. */
function NumberValue(props: ValueFieldProps): React.JSX.Element {
  return <NumericValue {...props} control={NUMBER_CONTROL} />;
}

/**
 * The block panel's numeric field under a label, over a variable's value.
 * Read-only, or without a control to draw, the plain field.
 */
function NumericValue({
  label,
  value,
  readOnly,
  refusedBy,
  onCommit,
  css,
  control,
}: ValueFieldProps & { control: StyleControl | undefined }): React.JSX.Element {
  const id = React.useId();
  if (readOnly || control === undefined) {
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
        control={control}
        css={css}
      />
    </div>
  );
}

/** A duration as a number and its unit, `200ms` or `0.2s`. */
const DURATION = /^\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))(ms|s)\s*$/i;

/** The units a duration is offered in. */
const DURATION_UNITS = ["ms", "s"] as const;

/** A typed duration: a bare number takes the unit on screen. */
function durationOf(typed: string, unit: string): string {
  const text = typed.trim();
  return CSS_NUMBER.test(text) ? `${text}${unit}` : text;
}

/**
 * A draft in another unit: a duration typed with its own unit (`200s`) takes
 * the one chosen, as a bare number does. Anything else stays as typed, so a
 * refused draft is still refused.
 */
function durationInUnit(draft: string, unit: string): string {
  const typed = DURATION.exec(draft);
  return durationOf(typed?.[1] ?? draft, unit);
}

/**
 * A duration field's draft: the author's typing, until the stored value
 * changes, number or unit, which replaces it with the stored number. Keyed on
 * the whole value, so `200s` stored over `200ms` resets a draft that still
 * reads `200s`; a refused draft is never stored, so it stays as typed.
 */
function useDurationDraft(
  value: string,
  number: string
): [string, (next: string) => void] {
  const [draft, setDraft] = React.useState(number);
  const [shown, setShown] = React.useState(value);
  if (shown !== value) {
    setShown(value);
    setDraft(number);
  }
  return [draft, setDraft];
}

/**
 * A duration: a number with a menu of ms and s. The number box and the menu
 * share one draft, so the menu changes the unit of the number on screen,
 * typed or refused, never of the value stored before it; a refused draft
 * stays refused until it is corrected. A value it cannot split into the two,
 * such as `var(…)`, is edited whole as text, and so is a read-only one.
 */
function DurationValue(props: ValueFieldProps): React.JSX.Element {
  const { label, value, readOnly, refusedBy, onCommit } = props;
  const id = React.useId();
  const parts = DURATION.exec(value);
  const number = parts?.[1] ?? "";
  const unit = (parts?.[2] ?? "ms").toLowerCase();
  const [draft, setDraft] = useDurationDraft(value, number);
  if (readOnly || parts === null) return <TextValue {...props} />;
  const commit = (text: string): void => {
    const typed = text.trim();
    if (typed === "" || (typed === number && refusedBy === undefined)) return;
    onCommit(durationOf(typed, unit));
  };
  return (
    <div className="nx-vars-editor__field">
      <label className="nx-vars-editor__label" htmlFor={id}>
        {label}
      </label>
      <div className="nx-vars-editor__duration">
        <Input
          id={id}
          autoComplete="off"
          aria-invalid={refusedBy === undefined ? undefined : true}
          aria-describedby={refusedBy}
          className="nx-vars-editor__mono"
          value={draft}
          onChange={event => setDraft(event.currentTarget.value)}
          onBlur={event => commit(event.currentTarget.value)}
          onKeyDown={event => {
            if (event.key === "Enter") commit(event.currentTarget.value);
          }}
        />
        <Select
          value={unit}
          onValueChange={next => {
            if (next !== unit || draft.trim() !== number) {
              onCommit(durationInUnit(draft, next));
            }
          }}
        >
          <SelectTrigger
            className="nx-vars-editor__duration-unit"
            aria-label={`Unit for ${label}`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DURATION_UNITS.map(choice => (
              <SelectItem key={choice} value={choice}>
                {choice}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
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
    // Asked by node kind, never `instanceof`: the canvas is a frame, and a
    // constructor from this window answers false for an element from another.
    if (refusedBy === undefined || !isInput(field)) return;
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
        <span
          className="nx-vars-editor__times-mark"
          title="Times the text size"
        >
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
  return KIND_FIELDS[token.kind] ?? TextValue;
}

/** The field each kind with one of its own is edited with. */
const KIND_FIELDS: Partial<
  Record<SiteToken["kind"], (props: ValueFieldProps) => React.JSX.Element>
> = {
  dimension: SizeValue,
  number: NumberValue,
  duration: DurationValue,
  fontFamily: FontValue,
  fontWeight: WeightValue,
};

/**
 * A font variable: chosen from the families the site has files for and the
 * system's, never typed, ending with the way to the site's fonts. The block
 * panel's own Font control, without its font variables, since a variable
 * holds a family of its own. Read-only, the stored family as text.
 */
function FontValue({
  label,
  value,
  readOnly,
  refusedBy,
  onCommit,
}: ValueFieldProps): React.JSX.Element {
  const fonts = React.useContext(FontChoicesContext);
  const id = React.useId();
  const manage = useManageFonts(fonts?.onManageFonts);
  if (readOnly) {
    return (
      <TextValue
        label={label}
        value={value}
        readOnly
        refusedBy={refusedBy}
        onCommit={onCommit}
      />
    );
  }
  return (
    <div className="nx-vars-editor__field">
      <span className="nx-vars-editor__label" id={`${id}-label`}>
        {label}
      </span>
      <FontFamilyField
        id={id}
        labelledBy={`${id}-label`}
        stored={value === "" ? undefined : value}
        tokens={undefined}
        faces={fonts?.faces}
        fromCode={fonts?.fromCode ?? []}
        onCommit={next => {
          if (typeof next === "string" && next !== value) onCommit(next);
        }}
        {...(manage === undefined ? {} : { onManageFonts: manage })}
      />
    </div>
  );
}

/**
 * The way to the site's fonts from a font variable: the variable's editor
 * closes first, since it is a dialog over the panel the author is sent to.
 */
function useManageFonts(
  manage: (() => void) | undefined
): (() => void) | undefined {
  const close = React.useContext(CloseVariableEditor);
  if (manage === undefined) return undefined;
  return () => {
    close?.();
    manage();
  };
}

/**
 * The named weights in the order a weight menu lists them: those some face on
 * the site draws, then the rest, each list lightest first. All of them, in
 * order, while the site's fonts are not known.
 */
function weightOrder(drawn: ReadonlySet<number> | undefined): {
  ours: readonly number[];
  others: readonly number[];
} {
  if (drawn === undefined) return { ours: NAMED_WEIGHTS, others: [] };
  return {
    ours: NAMED_WEIGHTS.filter(weight => drawn.has(weight)),
    others: NAMED_WEIGHTS.filter(weight => !drawn.has(weight)),
  };
}

/** A stored weight in words: `Bold 700`, or the value itself when unnamed. */
function shownWeight(value: string): string {
  const weight = Number(value);
  return NAMED_WEIGHTS.includes(weight) ? weightName(weight) : value;
}

/**
 * A weight variable, by name: "Thin 100" to "Black 900", the weights the
 * site's fonts have first and the others marked, since text set at one of
 * them is drawn by the browser from the nearest weight it has. A stored
 * weight with no name (`450`) still shows, and stays chosen.
 */
function WeightValue({
  label,
  value,
  readOnly,
  refusedBy,
  onCommit,
}: ValueFieldProps): React.JSX.Element {
  const fonts = React.useContext(FontChoicesContext);
  const id = React.useId();
  if (readOnly) {
    return (
      <TextValue
        label={label}
        value={value}
        readOnly
        refusedBy={refusedBy}
        onCommit={onCommit}
      />
    );
  }
  const drawn =
    fonts?.faces === undefined
      ? undefined
      : weightsDrawn([...fonts.faces, ...fonts.fromCode]);
  const { ours, others } = weightOrder(drawn);
  const unnamed = value !== "" && !NAMED_WEIGHTS.includes(Number(value));
  return (
    <div className="nx-vars-editor__field">
      <label className="nx-vars-editor__label" htmlFor={id}>
        {label}
      </label>
      <Select
        value={value}
        onValueChange={next => {
          if (next !== value) onCommit(next);
        }}
      >
        <SelectTrigger
          id={id}
          className="nx-vars-editor__weight"
          aria-describedby={refusedBy}
          aria-invalid={refusedBy === undefined ? undefined : true}
        >
          <SelectValue>{shownWeight(value)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {unnamed ? <SelectItem value={value}>{value}</SelectItem> : null}
          {ours.map(weight => (
            <SelectItem key={weight} value={String(weight)}>
              {weightName(weight)}
            </SelectItem>
          ))}
          {ours.length > 0 && others.length > 0 ? <SelectSeparator /> : null}
          {others.map(weight => (
            <SelectItem key={weight} value={String(weight)}>
              {weightName(weight)}
              <span className="nx-vars-editor__weight-note">
                No font on this site has this weight
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
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
