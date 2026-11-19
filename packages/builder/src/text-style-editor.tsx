"use client";

/**
 * A text style's parts, in the popup its row in Type → "Text styles" opens:
 * its font (the Body font, the Headings font or a family the site loads),
 * its size for each device (a type size, a typed size or a fluid one), its
 * line height, weight, letter spacing (with its unit, `em` unless another is
 * typed) and case. Every part but the font and the case can follow a
 * variable, picked from the variables that fit it, or hold a plain value.
 *
 * Each change is one address-level change to the style's styles, handed to
 * the host, which stores it and keeps it as one step of undo; the fields
 * show it at once, before the store reads back.
 *
 * @module text-style-editor
 */
import {
  isTokenRef,
  tokenRef,
  fluidValue,
  type FluidRangeWidths,
  type FluidSizes,
  type NodeStyles,
  type SiteTokenSet,
  type StyleLeaf,
  type StyleValue,
} from "@nextlyhq/blocks-engine";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nextlyhq/ui";
import * as React from "react";

import { FluidButton } from "./fluid-popover";
import { FontChoicesContext } from "./font-family-field";
import { propertyVariableLeaf } from "./inspector/style-inspector/style-value-fields";
import {
  sharedStyleChange,
  type SharedStyleChange,
} from "./shared-style-target";
import { roleFamilies } from "./site-font-roles-model";
import { fontWeightOptions, lineHeightFromText } from "./style-folded";
import {
  fontChoiceOf,
  fontValueOf,
  LETTER_SPACING_UNITS,
  letterSpacingParts,
  letterSpacingValue,
  partAddress,
  partAt,
  TEXT_STYLE_BASE,
  TEXT_STYLE_CASES,
  type TextStyleDevice,
} from "./text-style-parts";
import { fluidRangeOf, setFluidRange } from "./tokens-studio";
import { VariableChip, VariableChoice } from "./variable-choice";
import {
  CommitInput,
  LineHeightInput,
  SizeInput,
} from "./variable-value-controls";

/** What the editor is handed. */
export interface TextStyleEditorProps {
  /** The style's name, for the fields' names. */
  readonly name: string;
  /** Its styles as the edits on their way leave them. */
  readonly styles: NodeStyles;
  readonly tokens: SiteTokenSet | undefined;
  readonly devices: readonly TextStyleDevice[];
  /** Why its parts can't be changed (a lock, a role), or `undefined`. */
  readonly heldBy: string | undefined;
  /** Store one change to its styles: the refusal in words, or nothing. */
  readonly write: (change: SharedStyleChange) => Promise<string | undefined>;
  /** Change the site's variables, for the fluid range "Fluid…" sets. */
  readonly onTokens?: ((tokens: SiteTokenSet) => void) | undefined;
  /** The two sizes each device's size was made fluid from, where it was. */
  readonly fluidSizes?: Readonly<Record<string, FluidSizes>> | undefined;
  /**
   * Store a size made fluid with the two sizes it was made from, as one
   * change, so a change of the site's fluid range can make it again: the
   * refusal in words, or nothing. Absent, only the size is written.
   */
  readonly onFluid?:
    | ((
        device: string,
        sizes: FluidSizes,
        value: string
      ) => Promise<string | undefined>)
    | undefined;
}

/**
 * The leaf each part's variables are offered for, from the one reading the
 * style panel uses: line height and weight are unions, so each takes the
 * folded leaf over its forms, not none.
 */
const LEAVES = {
  fontSize: propertyVariableLeaf("fontSize"),
  lineHeight: propertyVariableLeaf("lineHeight"),
  fontWeight: propertyVariableLeaf("fontWeight"),
  letterSpacing: propertyVariableLeaf("letterSpacing"),
} as const;

/** A plain value as a field shows it. */
function plain(value: StyleValue | undefined): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}

/** The text style's parts. */
export function TextStyleEditor(
  props: TextStyleEditorProps
): React.JSX.Element {
  const [refusal, setRefusal] = React.useState<string | null>(null);
  const readOnly = props.heldBy !== undefined;
  /** Store a value at one device, or clear it with `null`. */
  const set = (
    breakpoint: string,
    property: string,
    value: StyleValue | null
  ): void => {
    if (readOnly) return;
    void props
      .write(sharedStyleChange(partAddress(breakpoint, property), value))
      .then(answer => setRefusal(answer ?? null));
  };
  const at = (property: string): StyleValue | undefined =>
    partAt(props.styles, TEXT_STYLE_BASE, property);
  return (
    <div
      className="nx-vars-editor__body nx-text-styles__editor"
      spellCheck={false}
    >
      <p className="nx-vars-editor__label nx-site-text__title">{props.name}</p>
      {props.heldBy === undefined ? null : (
        <p className="nx-inspector__note">{props.heldBy}</p>
      )}
      <FontPart
        value={at("fontFamily")}
        readOnly={readOnly}
        onValue={value => set(TEXT_STYLE_BASE, "fontFamily", value)}
      />
      <fieldset className="nx-text-styles__sizes">
        <legend className="nx-vars-editor__label">Size</legend>
        {props.devices.map(device => (
          <SizePart
            key={device.id}
            device={device}
            value={partAt(props.styles, device.id, "fontSize")}
            tokens={props.tokens}
            readOnly={readOnly}
            onValue={value => set(device.id, "fontSize", value)}
            onClear={() => set(device.id, "fontSize", null)}
            onTokens={props.onTokens}
            made={props.fluidSizes?.[device.id]}
            onFluid={
              props.onFluid === undefined || readOnly
                ? undefined
                : (sizes, value) =>
                    void props
                      .onFluid?.(device.id, sizes, value)
                      .then(answer => setRefusal(answer ?? null))
            }
          />
        ))}
      </fieldset>
      <VariablePart
        label="Line height"
        leaf={LEAVES.lineHeight}
        value={at("lineHeight")}
        tokens={props.tokens}
        readOnly={readOnly}
        onValue={value => set(TEXT_STYLE_BASE, "lineHeight", value)}
        onClear={() => set(TEXT_STYLE_BASE, "lineHeight", null)}
      >
        <LineHeightInput
          label="Line height"
          value={plain(at("lineHeight"))}
          readOnly={readOnly}
          onCommit={text => {
            const typed = lineHeightFromText(text);
            if (typeof typed === "string" || typeof typed === "number") {
              set(TEXT_STYLE_BASE, "lineHeight", typed);
            }
          }}
        />
      </VariablePart>
      <VariablePart
        label="Weight"
        leaf={LEAVES.fontWeight}
        value={at("fontWeight")}
        tokens={props.tokens}
        readOnly={readOnly}
        onValue={value => set(TEXT_STYLE_BASE, "fontWeight", value)}
        onClear={() => set(TEXT_STYLE_BASE, "fontWeight", null)}
      >
        <WeightPart
          value={at("fontWeight")}
          readOnly={readOnly}
          onValue={value => set(TEXT_STYLE_BASE, "fontWeight", value)}
        />
      </VariablePart>
      <VariablePart
        label="Letter spacing"
        leaf={LEAVES.letterSpacing}
        value={at("letterSpacing")}
        tokens={props.tokens}
        readOnly={readOnly}
        onValue={value => set(TEXT_STYLE_BASE, "letterSpacing", value)}
        onClear={() => set(TEXT_STYLE_BASE, "letterSpacing", null)}
      >
        <SpacingPart
          value={at("letterSpacing")}
          readOnly={readOnly}
          onValue={value => set(TEXT_STYLE_BASE, "letterSpacing", value)}
          onRefused={setRefusal}
        />
      </VariablePart>
      <CasePart
        value={at("textTransform")}
        readOnly={readOnly}
        onValue={value => set(TEXT_STYLE_BASE, "textTransform", value)}
      />
      {refusal === null ? null : (
        <p className="nx-vars-editor__issue" role="alert">
          {refusal}
        </p>
      )}
    </div>
  );
}

/**
 * One part that may follow a variable: the variable's chip, with Unlink,
 * while it follows one, else the plain field with the list of variables
 * that fit beside it.
 */
function VariablePart({
  label,
  leaf,
  value,
  tokens,
  readOnly,
  onValue,
  onClear,
  children,
}: {
  label: string;
  leaf: StyleLeaf | undefined;
  value: StyleValue | undefined;
  tokens: SiteTokenSet | undefined;
  readOnly: boolean;
  onValue: (value: StyleValue) => void;
  /**
   * Take the part's value away, so the style writes none for it: an emptied
   * field writes nothing, so this is the way back. Absent: not offered.
   */
  onClear?: (() => void) | undefined;
  children: React.ReactNode;
}): React.JSX.Element {
  const labelId = React.useId();
  const held = isTokenRef(value) ? value.$token : undefined;
  // A scaled reference's multiplier ("half of Display"), kept when another
  // variable is picked and when the part is unlinked, so the value written is
  // the one the page draws rather than the variable's own.
  const times = isTokenRef(value) ? value.times : undefined;
  return (
    <div className="nx-vars-editor__field nx-text-styles__part">
      <span className="nx-vars-editor__label" id={labelId}>
        {label}
      </span>
      <div className="nx-text-styles__value">
        {held !== undefined && leaf !== undefined ? (
          <VariableChip
            leaf={leaf}
            tokens={tokens}
            identity={held}
            times={times}
            label={label}
            labelledBy={labelId}
            onPick={identity => onValue(tokenRef(identity, times))}
            onUnlink={onValue}
          />
        ) : (
          children
        )}
        {readOnly || leaf === undefined || held !== undefined ? null : (
          <VariableChoice
            leaf={leaf}
            tokens={tokens}
            current={held}
            label={label}
            onPick={identity => onValue(tokenRef(identity))}
          />
        )}
      </div>
      {readOnly || onClear === undefined || value === undefined ? null : (
        <ResetPart label={`Reset ${label}`} onClear={onClear} />
      )}
    </div>
  );
}

/** "Reset" beside a part holding a value, which takes it away. */
function ResetPart({
  label,
  onClear,
}: {
  label: string;
  onClear: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="nx-style-inspector__breakpoint-action"
      aria-label={label}
      onClick={onClear}
    >
      Reset
    </button>
  );
}

/** The font: the Body font, the Headings font, or a family the site loads. */
function FontPart({
  value,
  readOnly,
  onValue,
}: {
  value: StyleValue | undefined;
  readOnly: boolean;
  onValue: (value: StyleValue) => void;
}): React.JSX.Element {
  const fonts = React.useContext(FontChoicesContext);
  const id = React.useId();
  const current = fontChoiceOf(value);
  const families = roleFamilies(fonts?.faces ?? [], fonts?.fromCode ?? []);
  const options: (readonly [string, string])[] = [
    ["body", "Body font"],
    ["heading", "Headings font"],
    ...families.map(family => [family.stack, family.family] as const),
  ];
  // A stored font the list doesn't hold is shown as it is.
  if (current !== "" && !options.some(([key]) => key === current)) {
    options.push([current, current]);
  }
  // A style that sets no font says so, rather than showing Body font as
  // chosen: it keeps the font of what it is laid on, and Body font has to be
  // a choice the author can make.
  if (current === "") options.unshift([UNSET_PART, "Not set"]);
  return (
    <div className="nx-vars-editor__field nx-text-styles__part">
      <label className="nx-vars-editor__label" htmlFor={id}>
        Font
      </label>
      <PartSelect
        id={id}
        label="Font"
        value={current === "" ? UNSET_PART : current}
        options={options}
        disabled={readOnly}
        onChange={choice => {
          if (choice !== UNSET_PART) onValue(fontValueOf(choice));
        }}
      />
    </div>
  );
}

/**
 * The stored sizes, only while they still make the size: one typed since is
 * the author's, and "Fluid…" starts from it as it reads.
 */
function sizesStillMaking(
  made: FluidSizes | undefined,
  range: FluidRangeWidths | undefined,
  size: string
): FluidSizes | undefined {
  if (made === undefined || range === undefined) return undefined;
  return fluidValue(made, range) === size ? made : undefined;
}

/** One device's size: a type size, a typed size, or a fluid one. */
function SizePart({
  device,
  value,
  tokens,
  readOnly,
  onValue,
  onClear,
  onTokens,
  made,
  onFluid,
}: {
  device: TextStyleDevice;
  value: StyleValue | undefined;
  tokens: SiteTokenSet | undefined;
  readOnly: boolean;
  onValue: (value: StyleValue) => void;
  /** Take the device's own size away, so it follows Desktop's again. */
  onClear: () => void;
  onTokens: ((tokens: SiteTokenSet) => void) | undefined;
  /** The two sizes the size was made fluid from, where it was. */
  made: FluidSizes | undefined;
  /** Store a size made fluid with its two sizes; absent, the size alone. */
  onFluid: ((sizes: FluidSizes, value: string) => void) | undefined;
}): React.JSX.Element {
  const range = tokens === undefined ? undefined : fluidRangeOf(tokens);
  const size = plain(value);
  const sizes = sizesStillMaking(made, range, size);
  // A device other than Desktop holding a size of its own can give it up:
  // an emptied field writes nothing, so this is the way back.
  const own = !readOnly && device.id !== TEXT_STYLE_BASE && value !== undefined;
  return (
    <>
      <VariablePart
        label={device.label}
        leaf={LEAVES.fontSize}
        value={value}
        tokens={tokens}
        readOnly={readOnly}
        onValue={onValue}
      >
        <SizeInput
          label={`Size on ${device.label}`}
          value={size}
          readOnly={readOnly}
          onCommit={onValue}
          css={`
            font-size: ${size};
          `}
        />
        {readOnly || range === undefined || tokens === undefined ? null : (
          <FluidButton
            hook={{
              sizes,
              value: size,
              range,
              onFluid: next => {
                const fluid = fluidValue(next, range);
                if (onFluid === undefined) onValue(fluid);
                else onFluid(next, fluid);
              },
              onRange: next => onTokens?.(setFluidRange(tokens, next)),
            }}
          />
        )}
      </VariablePart>
      {own ? (
        <ResetPart
          label={`Reset the size on ${device.label}`}
          onClear={onClear}
        />
      ) : null}
    </>
  );
}

/** The select key of a part the style leaves unset, apart from every value. */
const UNSET_PART = "unset";
const UNSET_WEIGHT = UNSET_PART;

/** The weight, by name: "Semibold 600". */
function WeightPart({
  value,
  readOnly,
  onValue,
}: {
  value: StyleValue | undefined;
  readOnly: boolean;
  onValue: (value: StyleValue) => void;
}): React.JSX.Element {
  const options = fontWeightOptions(value);
  // A style that sets no weight says so, rather than showing Regular 400 as
  // chosen: a heading following it keeps its own bold, and Regular has to be
  // a choice the author can make, not one the list thinks already made.
  const current =
    value === undefined
      ? UNSET_WEIGHT
      : (options.find(option => option.value === value)?.key ?? UNSET_WEIGHT);
  return (
    <PartSelect
      label="Weight"
      value={current}
      options={[
        ...(current === UNSET_WEIGHT
          ? [[UNSET_WEIGHT, "Not set"] as const]
          : []),
        ...options.map(option => [option.key, option.label] as const),
      ]}
      disabled={readOnly}
      onChange={key => {
        const picked = options.find(option => option.key === key);
        if (picked !== undefined) onValue(picked.value);
      }}
    />
  );
}

/** Letter spacing: a number, in `em` unless another unit is typed or chosen. */
function SpacingPart({
  value,
  readOnly,
  onValue,
  onRefused,
}: {
  value: StyleValue | undefined;
  readOnly: boolean;
  onValue: (value: StyleValue | null) => void;
  onRefused: (words: string) => void;
}): React.JSX.Element {
  const { amount, unit } = letterSpacingParts(value);
  const commit = (typed: string, inUnit: string): void => {
    const next = letterSpacingValue(typed, inUnit);
    if (next === undefined) {
      onRefused("Type the letter spacing as a number, such as 0.08.");
      return;
    }
    onValue(next);
  };
  return (
    <span className="nx-text-styles__spacing">
      <CommitInput
        label="Letter spacing"
        value={amount}
        readOnly={readOnly}
        onCommit={typed => commit(typed, unit)}
      />
      <PartSelect
        label="Letter spacing unit"
        value={unit}
        options={LETTER_SPACING_UNITS.map(each => [each, each] as const)}
        disabled={readOnly || amount === ""}
        onChange={next => commit(amount, next)}
      />
    </span>
  );
}

/** The case: As typed, UPPERCASE, lowercase or Capitalised. */
function CasePart({
  value,
  readOnly,
  onValue,
}: {
  value: StyleValue | undefined;
  readOnly: boolean;
  onValue: (value: StyleValue) => void;
}): React.JSX.Element {
  const name = React.useId();
  // A style that sets no case checks none: "As typed" writes `none`, which
  // overrides a case the block gets from elsewhere, so it must be choosable.
  const current = typeof value === "string" ? value : undefined;
  return (
    <fieldset className="nx-site-text__sizes nx-text-styles__case">
      <legend className="nx-vars-editor__label">Case</legend>
      {TEXT_STYLE_CASES.map(([stored, words]) => (
        <label key={stored} className="nx-site-text__option">
          <input
            type="radio"
            name={name}
            value={stored}
            checked={current === stored}
            disabled={readOnly}
            onChange={() => onValue(stored)}
          />
          <span>{words}</span>
        </label>
      ))}
    </fieldset>
  );
}

/**
 * A short list a part is chosen from: the admin's select, whose list is
 * drawn above the popup it is opened in.
 */
function PartSelect<V extends string>({
  id,
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  id?: string;
  /** What the control is, said before its value: "Weight". */
  label: string;
  value: V;
  options: ReadonlyArray<readonly [V, string]>;
  onChange: (value: V) => void;
  disabled?: boolean;
}): React.JSX.Element {
  const shown = options.find(([option]) => option === value)?.[1] ?? value;
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={next => {
        const picked = options.find(([option]) => option === next);
        if (picked !== undefined && picked[0] !== value) onChange(picked[0]);
      }}
    >
      <SelectTrigger
        id={id}
        className="nx-text-styles__select"
        aria-label={`${label}, ${shown}`}
      >
        <SelectValue>{shown}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map(([option, words]) => (
          <SelectItem key={option} value={option}>
            {words}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
