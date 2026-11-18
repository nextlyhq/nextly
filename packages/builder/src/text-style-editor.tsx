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
  STYLE_CATALOG,
  tokenRef,
  fluidValue,
  type NodeStyles,
  type SiteTokenSet,
  type StyleLeaf,
  type StyleValue,
} from "@nextlyhq/blocks-engine";
import * as React from "react";

import { ChoiceMenu } from "./font-choice-menu";
import { FontChoicesContext } from "./font-family-field";
import { FluidButton } from "./fluid-popover";
import type { SharedStyleChange } from "./shared-style-target";
import { sharedStyleChange } from "./shared-style-target";
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
}

/** The catalog's leaf for a property, which decides the variables offered. */
function leafOf(property: string): StyleLeaf | undefined {
  const shape = STYLE_CATALOG.find(entry => entry.property === property)?.shape;
  return shape !== undefined && "cssProperty" in shape ? shape : undefined;
}

const LEAVES = {
  fontSize: leafOf("fontSize"),
  lineHeight: leafOf("lineHeight"),
  fontWeight: leafOf("fontWeight"),
  letterSpacing: leafOf("letterSpacing"),
} as const;

/** A plain value as a field shows it. */
function plain(value: StyleValue | undefined): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}

/** The text style's parts. */
export function TextStyleEditor(props: TextStyleEditorProps): React.JSX.Element {
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
    <div className="nx-vars-editor__body nx-text-styles__editor" spellCheck={false}>
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
            onTokens={props.onTokens}
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
  children,
}: {
  label: string;
  leaf: StyleLeaf | undefined;
  value: StyleValue | undefined;
  tokens: SiteTokenSet | undefined;
  readOnly: boolean;
  onValue: (value: StyleValue) => void;
  children: React.ReactNode;
}): React.JSX.Element {
  const labelId = React.useId();
  const held = isTokenRef(value) ? value.$token : undefined;
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
            label={label}
            labelledBy={labelId}
            onPick={identity => onValue(tokenRef(identity))}
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
    </div>
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
  return (
    <div className="nx-vars-editor__field nx-text-styles__part">
      <label className="nx-vars-editor__label" htmlFor={id}>
        Font
      </label>
      <ChoiceMenu
        id={id}
        label="Font"
        value={current === "" ? "body" : current}
        options={options}
        disabled={readOnly}
        onChange={choice => onValue(fontValueOf(choice))}
      />
    </div>
  );
}

/** One device's size: a type size, a typed size, or a fluid one. */
function SizePart({
  device,
  value,
  tokens,
  readOnly,
  onValue,
  onTokens,
}: {
  device: TextStyleDevice;
  value: StyleValue | undefined;
  tokens: SiteTokenSet | undefined;
  readOnly: boolean;
  onValue: (value: StyleValue) => void;
  onTokens: ((tokens: SiteTokenSet) => void) | undefined;
}): React.JSX.Element {
  const range = tokens === undefined ? undefined : fluidRangeOf(tokens);
  const size = plain(value);
  return (
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
        css={`font-size: ${size};`}
      />
      {readOnly || range === undefined || tokens === undefined ? null : (
        <FluidButton
          hook={{
            sizes: undefined,
            value: size,
            range,
            onFluid: sizes => onValue(fluidValue(sizes, range)),
            onRange: next => onTokens?.(setFluidRange(tokens, next)),
          }}
        />
      )}
    </VariablePart>
  );
}

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
  const current =
    options.find(option => option.value === value)?.key ?? "n:400";
  return (
    <ChoiceMenu
      label="Weight"
      value={current}
      options={options.map(option => [option.key, option.label] as const)}
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
      <ChoiceMenu
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
  const current = typeof value === "string" ? value : "none";
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
