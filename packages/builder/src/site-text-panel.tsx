"use client";

/**
 * Design → Type → "Site text": one row each for Body, the six headings,
 * Links, Buttons and Captions, set once for every page.
 *
 * Each row previews sample text in its current look beside its pair
 * ("28 / 1.2"), and opens a popup beside the panel, as a variable's row
 * does. A text row is pointed at a type size, which sets its size and line
 * height together, or given a typed size (with the unit menu or "Fluid…")
 * and a line height, or left as "Your site's own", which writes nothing.
 * The Links row has a colour, a colour on hover and when it is underlined.
 *
 * Every edit is a new token set handed to the host, as a variable edit is,
 * so it saves, merges and undoes the same way. What a row writes is said on
 * hover and, while "Show CSS names" is on, under the row.
 *
 * @module site-text-panel
 */
import {
  fluidValue,
  isTokenRef,
  SITE_TEXT_UNDERLINES,
  tokenRef,
  type SiteTextEntry,
  type SiteTextMap,
  type SiteTextRole,
  type SiteTextUnderline,
  type SiteTokenSet,
  type StyleLeaf,
  type TokenMode,
  type NamedClass,
  STYLE_CATALOG,
  textStylesOf,
} from "@nextlyhq/blocks-engine";
import { Button, Popover, PopoverContent, PopoverTrigger } from "@nextlyhq/ui";
import * as React from "react";

import { commitFocusedField } from "./editor-field-commit";
import { EDITOR_WORDS } from "./editor-words";
import { FluidButton, type FluidHook } from "./fluid-popover";
import { CssHint, CssNamesLine } from "./inspector/css-hint";
import { sharedStyleName } from "./shared-style-library";
import {
  pairWords,
  SITE_OWN_WORDS,
  siteTextRowViews,
  siteTextWrites,
  typeSizeChoices,
  withRowTextStyle,
  withSiteTextRow,
  withTypeSize,
  type SiteTextRowView,
  type TypeSizeChoice,
} from "./site-text-rows";
import { lineHeightFromText } from "./style-folded";
import { fluidRangeOf, setFluidRange } from "./tokens-studio";
import { VariableChoice } from "./variable-choice";
import { ColourValue } from "./variable-editor";
import {
  CloseVariableEditor,
  LineHeightInput,
  SizeInput,
} from "./variable-value-controls";

/** What the section is handed: the set, how to change it, and the mode shown. */
export interface SiteTextSectionProps {
  readonly tokens: SiteTokenSet;
  readonly onChange: (tokens: SiteTokenSet) => void;
  readonly readOnly: boolean;
  readonly mode: TokenMode;
  /** The rows the site's code supplies, which Reset returns a row to. */
  readonly supplied?: SiteTextMap | undefined;
  /**
   * The site's class library, whose text styles a row may follow
   * ("Heading 1 uses Display"). Absent: none is offered.
   */
  readonly classes?: readonly NamedClass[] | undefined;
}

/** The words each underline is offered by. */
const UNDERLINE_WORDS: Readonly<Record<SiteTextUnderline, string>> = {
  always: "Always",
  hover: "On hover",
  never: "Never",
};

/** The CSS properties a row writes, for the "Show CSS names" line. */
function cssNamesOf(role: SiteTextRole): string[] {
  return role === "link"
    ? ["color", "text-decoration"]
    : ["font-size", "line-height"];
}

/** The sample text every row previews its look with. */
const SAMPLE = "The quick survey";

/** The sizes a row's preview is drawn between, in px, so every row fits. */
const PREVIEW_PX = { min: 11, max: 20 } as const;

/** A row's preview size: its text's size, scaled into the row's bounds. */
function previewPx(row: SiteTextRowView): number {
  const px = row.px ?? 16;
  return Math.min(PREVIEW_PX.max, Math.max(PREVIEW_PX.min, px * 0.55));
}

/** What a row says beside its name: its pair, a link's look, or its site's own. */
function rowWords(row: SiteTextRowView): string {
  if (row.role !== "link" || row.pair === SITE_OWN_WORDS) return row.pair;
  const underline = row.entry?.underline;
  return underline === undefined
    ? "Colour"
    : `Underline ${UNDERLINE_WORDS[underline].toLowerCase()}`;
}

/** The Site text section, for the Type tab. */
export function SiteTextSection({
  tokens,
  onChange,
  readOnly,
  mode,
  supplied,
  classes,
}: SiteTextSectionProps): React.JSX.Element {
  const id = React.useId();
  const rows = siteTextRowViews(tokens, mode, classes);
  return (
    <section className="nx-vars__group nx-site-text" aria-labelledby={id}>
      <div className="nx-vars__group-head">
        <h3 className="nx-vars__group-name" id={id}>
          {EDITOR_WORDS.siteText}
        </h3>
      </div>
      <ul className="nx-vars__list">
        {rows.map(row => (
          <SiteTextRow
            key={row.role}
            row={row}
            tokens={tokens}
            onChange={onChange}
            readOnly={readOnly}
            mode={mode}
            resetTo={supplied?.[row.role]}
            classes={classes}
          />
        ))}
      </ul>
    </section>
  );
}

/** One row: its button, what it writes, and its popup. */
function SiteTextRow({
  row,
  tokens,
  onChange,
  readOnly,
  mode,
  resetTo,
  classes,
}: {
  row: SiteTextRowView;
  tokens: SiteTokenSet;
  onChange: (tokens: SiteTokenSet) => void;
  readOnly: boolean;
  mode: TokenMode;
  resetTo: SiteTextEntry | undefined;
  classes: readonly NamedClass[] | undefined;
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const namesId = React.useId();
  const words = rowWords(row);
  const heading = /^h[1-6]$/.test(row.role);
  return (
    <PopupRow open={open} onOpen={setOpen}>
      <div className="nx-vars__line">
        <CssHint writes={siteTextWrites(tokens, row.role, row.entry, classes)}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="nx-vars__row nx-site-text__row"
              data-site-text={row.role}
              data-open={open ? "" : undefined}
            >
              <span
                className="nx-vars__name"
                title={row.label}
                aria-hidden="true"
              >
                {row.label}
              </span>
              <span
                className="nx-site-text__preview"
                aria-hidden="true"
                style={{
                  fontSize: `${String(previewPx(row))}px`,
                  fontWeight: heading ? 700 : 400,
                }}
              >
                {SAMPLE}
              </span>
              <span className="nx-vars__chip" title={words} aria-hidden="true">
                {words}
              </span>
              {/* The row's name, in one element, named with its section so
                  "Body" here is never taken for a type size of the same name
                  in the list below. Text rather than an aria-label, which
                  would have to hold every drawn word, the sample included. */}
              <span className="nx-sr-only">
                {row.follows === undefined
                  ? `${EDITOR_WORDS.siteText}: ${row.label}, ${words}`
                  : `${EDITOR_WORDS.siteText}: ${row.label} uses ${row.follows.name}`}
              </span>
            </button>
          </PopoverTrigger>
        </CssHint>
      </div>
      <CssNamesLine id={namesId} names={cssNamesOf(row.role)} />
      <PopoverContent
        side="right"
        align="start"
        sideOffset={12}
        collisionPadding={8}
        className="nx-vars-editor nx-site-text__editor"
        aria-label={`${readOnly ? "" : "Edit "}${row.label}`}
      >
        <CloseVariableEditor.Provider value={() => setOpen(false)}>
          <SiteTextEditor
            row={row}
            tokens={tokens}
            onChange={onChange}
            readOnly={readOnly}
            mode={mode}
            resetTo={resetTo}
            classes={classes}
          />
        </CloseVariableEditor.Provider>
      </PopoverContent>
    </PopupRow>
  );
}

/**
 * A Design row with a popup beside the panel: the row's line and its popup
 * inside, and what follows the row (a refusal) after it. A field still being
 * typed in commits before the popup closes. Shared by Site text's rows and
 * the text styles'.
 */
export function PopupRow({
  open,
  onOpen,
  after,
  children,
}: {
  open: boolean;
  onOpen: (open: boolean) => void;
  after?: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <li className="nx-vars__item" data-open={open ? "" : undefined}>
      <Popover
        open={open}
        onOpenChange={next => {
          if (!next) commitFocusedField(globalThis.document);
          onOpen(next);
        }}
        modal
      >
        {children}
      </Popover>
      {after}
    </li>
  );
}

/** A row's popup: a link's colours and underline, or a text row's size. */
function SiteTextEditor(props: {
  row: SiteTextRowView;
  tokens: SiteTokenSet;
  onChange: (tokens: SiteTokenSet) => void;
  readOnly: boolean;
  mode: TokenMode;
  /** The row the site's code supplies, or none: the built-in one. */
  resetTo: SiteTextEntry | undefined;
  /** The site's classes, whose text styles a text row may follow. */
  classes: readonly NamedClass[] | undefined;
}): React.JSX.Element {
  const { row, tokens, onChange, readOnly, resetTo } = props;
  return (
    <div className="nx-vars-editor__body" spellCheck={false}>
      <p className="nx-vars-editor__label nx-site-text__title">{row.label}</p>
      {row.role === "link" ? (
        <LinkFields {...props} />
      ) : (
        <SizeFields {...props} />
      )}
      {readOnly || !row.stated ? null : (
        <div className="nx-vars-editor__actions">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="nx-vars-editor__button"
            // Back to the code's row where it supplies one, else the built-in.
            onClick={() => onChange(withSiteTextRow(tokens, row.role, resetTo))}
          >
            Reset
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Which way a text row is set: a type size's identity, "custom" for a typed
 * size, or "own" for the site's own.
 */
type SizeWay = string;

/** The way a text style is chosen by, beside a type size's identity. */
const TEXT_STYLE_WAY = "text:";

/** The way a row's values say it is set. */
function wayOf(row: SiteTextRowView): SizeWay {
  if (row.follows !== undefined) return `${TEXT_STYLE_WAY}${row.follows.id}`;
  const size = row.entry?.fontSize;
  if (isTokenRef(size)) return size.$token;
  return size === undefined && row.entry?.lineHeight === undefined
    ? "own"
    : "custom";
}

/** A text row's size: a type size, "Custom size", or "Your site's own". */
function SizeFields({
  row,
  tokens,
  onChange,
  readOnly,
  mode,
  classes,
}: {
  row: SiteTextRowView;
  tokens: SiteTokenSet;
  onChange: (tokens: SiteTokenSet) => void;
  readOnly: boolean;
  mode: TokenMode;
  classes: readonly NamedClass[] | undefined;
}): React.JSX.Element {
  const name = React.useId();
  const choices = typeSizeChoices(tokens, mode);
  // The text styles the row may follow in place of a size of its own.
  const followable = textStylesOf(classes);
  const stored = wayOf(row);
  // "Custom size" chosen shows its fields before anything is typed.
  const [typing, setTyping] = React.useState(false);
  const way = typing && stored !== "custom" ? "custom" : stored;
  const pick = (next: SizeWay): void => {
    setTyping(next === "custom");
    if (next === "custom") return;
    if (next.startsWith(TEXT_STYLE_WAY)) {
      onChange(
        withRowTextStyle(tokens, row.role, next.slice(TEXT_STYLE_WAY.length))
      );
      return;
    }
    onChange(
      next === "own"
        ? withSiteTextRow(tokens, row.role, {})
        : withTypeSize(tokens, row.role, next)
    );
  };
  const options: readonly { value: SizeWay; label: string }[] = [
    { value: "own", label: SITE_OWN_WORDS },
    ...choices.map(choice => ({
      value: choice.size,
      label: `${choice.name} · ${choice.pair}`,
    })),
    { value: "custom", label: "Custom size" },
    ...followable.map(style => ({
      value: `${TEXT_STYLE_WAY}${style.id}`,
      label: `Text style: ${sharedStyleName(style)}`,
    })),
  ];
  return (
    <>
      <fieldset className="nx-site-text__sizes">
        <legend className="nx-vars-editor__label">Type size</legend>
        {options.map(option => (
          <label key={option.value} className="nx-site-text__option">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={way === option.value}
              disabled={readOnly}
              onChange={() => pick(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </fieldset>
      {way === "custom" ? (
        <TypedSize
          row={row}
          tokens={tokens}
          onChange={onChange}
          readOnly={readOnly}
          choices={choices}
        />
      ) : null}
    </>
  );
}

/** A plain value as a field shows it. */
function plain(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}

/** A typed size, with its unit menu and "Fluid…", and a typed line height. */
function TypedSize({
  row,
  tokens,
  onChange,
  readOnly,
}: {
  row: SiteTextRowView;
  tokens: SiteTokenSet;
  onChange: (tokens: SiteTokenSet) => void;
  readOnly: boolean;
  choices: readonly TypeSizeChoice[];
}): React.JSX.Element {
  // Typing a size of its own takes the row off a text style it followed.
  const { textStyle: _followed, ...own } = row.entry ?? {};
  const entry: SiteTextEntry = isTokenRef(own.fontSize) ? {} : own;
  const write = (next: SiteTextEntry): void =>
    onChange(withSiteTextRow(tokens, row.role, next));
  const range = fluidRangeOf(tokens);
  const size = plain(entry.fontSize);
  const fluid: FluidHook = {
    sizes: entry.fluid,
    value: size,
    range,
    onFluid: sizes =>
      write({ ...entry, fontSize: fluidValue(sizes, range), fluid: sizes }),
    onRange: next => onChange(setFluidRange(tokens, next)),
  };
  return (
    <div className="nx-vars-editor__field nx-site-text__typed">
      <SizeInput
        label="Size"
        value={size}
        readOnly={readOnly}
        onCommit={value => {
          const { fluid: _made, ...rest } = entry;
          write({ ...rest, fontSize: value });
        }}
        css={`
          font-size: ${size};
        `}
      />
      {readOnly ? null : <FluidButton hook={fluid} />}
      <LineHeightInput
        label="Line height"
        value={plain(entry.lineHeight)}
        readOnly={readOnly}
        onCommit={value => {
          const typed = lineHeightFromText(value);
          if (typeof typed !== "string" && typeof typed !== "number") return;
          write({ ...entry, lineHeight: typed });
        }}
      />
      <p className="nx-site-text__said">
        {pairWords(size, plain(entry.lineHeight))}
      </p>
    </div>
  );
}

/** The catalog's leaf for a text colour, which offers the colour variables. */
const COLOUR_LEAF: StyleLeaf | undefined = (() => {
  const entry = STYLE_CATALOG.find(each => each.property === "color");
  const shape = entry?.shape;
  return shape !== undefined && "cssProperty" in shape ? shape : undefined;
})();

/** The Links row: its colour, its colour on hover, and its underline. */
function LinkFields({
  row,
  tokens,
  onChange,
  readOnly,
}: {
  row: SiteTextRowView;
  tokens: SiteTokenSet;
  onChange: (tokens: SiteTokenSet) => void;
  readOnly: boolean;
  mode: TokenMode;
}): React.JSX.Element {
  const name = React.useId();
  const entry = row.entry ?? {};
  const write = (next: SiteTextEntry): void =>
    onChange(withSiteTextRow(tokens, "link", next));
  return (
    <>
      <LinkColour
        label="Colour"
        value={entry.color}
        tokens={tokens}
        readOnly={readOnly}
        onValue={color => write({ ...entry, color })}
      />
      <LinkColour
        label="Colour on hover"
        value={entry.hoverColor}
        tokens={tokens}
        readOnly={readOnly}
        onValue={hoverColor => write({ ...entry, hoverColor })}
      />
      <fieldset className="nx-site-text__sizes" aria-label="Underline">
        <legend className="nx-vars-editor__label">Underline</legend>
        {SITE_TEXT_UNDERLINES.map(underline => (
          <label key={underline} className="nx-site-text__option">
            <input
              type="radio"
              name={name}
              value={underline}
              checked={entry.underline === underline}
              disabled={readOnly}
              onChange={() => write({ ...entry, underline })}
            />
            <span>{UNDERLINE_WORDS[underline]}</span>
          </label>
        ))}
      </fieldset>
    </>
  );
}

/** One of a link's colours: typed or picked, or a colour variable. */
function LinkColour({
  label,
  value,
  tokens,
  readOnly,
  onValue,
}: {
  label: string;
  value: SiteTextEntry["color"];
  tokens: SiteTokenSet;
  readOnly: boolean;
  onValue: (value: SiteTextEntry["color"]) => void;
}): React.JSX.Element {
  const held = isTokenRef(value) ? value.$token : undefined;
  return (
    <div className="nx-site-text__colour">
      {held === undefined ? (
        <ColourValue
          label={label}
          value={plain(value)}
          readOnly={readOnly}
          onCommit={onValue}
        />
      ) : (
        <p className="nx-vars-editor__field">
          <span className="nx-vars-editor__label">{label}</span>
          <span className="nx-vars-editor__mono">{held}</span>
        </p>
      )}
      {readOnly || COLOUR_LEAF === undefined ? null : (
        <VariableChoice
          leaf={COLOUR_LEAF}
          tokens={tokens}
          current={held}
          label={label}
          onPick={identity => onValue(tokenRef(identity))}
        />
      )}
    </div>
  );
}
