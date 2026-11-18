"use client";

/**
 * The value fields a control draws by kind: select, folded, length or
 * number, percent and toggle, and the value field that picks between them.
 *
 * @module style-value-fields
 */
import {
  APPEAR_DELAY_PROPERTY,
  APPEAR_DURATION_PROPERTY,
  isStyleLeaf,
  OVERLAY_STRENGTH,
  STYLE_CATALOG,
  trimCssWhitespace,
  type SiteTokenSet,
  type StyleLeaf,
  type StyleValue,
} from "@nextlyhq/blocks-engine";
import {
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
} from "@nextlyhq/ui";
import * as React from "react";

import { AspectRatioField, drawsAspectRatio } from "./aspect-ratio-field";
import {
  BackgroundPositionField,
  BackgroundSizeField,
} from "./background-fields";
import { BackgroundImageField } from "./background-image-control";
import { useCanvasTokenMode } from "./canvas/prefers-dark";
import { commitOnEnter } from "./commit-on-enter";
import { CssHint, OptionWrites, useFieldDescription } from "./css-hint";
import { DecorationField, drawsDecoration } from "./decoration-field";
import { FocalPointField } from "./focal-point-field";
import { IconChoiceField } from "./icon-choice-field";
import { InheritedValue, useUnsetHint } from "./inherited-value";
import { useLabelScrub } from "./label-scrub";
import { typedStyleText } from "./live-draft";
import { SectionHeld } from "./section-held";
import {
  alignmentGroupFor,
  drawsIcons,
  type Flow,
} from "./style-alignment-icons";
import { foldedLeaf, type SiteVariable } from "./style-colour";
import type { StyleControl } from "./style-controls";
import {
  StyleTargetContext,
  type CommitOutcome,
} from "./style-field-surroundings";
import {
  fontWeightOptions,
  lineHeightFromText,
  lineHeightLeafFor,
  lineHeightScrubOrigin,
  storedKey,
  type FoldedControl,
  type FoldedOption,
} from "./style-folded";
import { keywordLabel, menuKeywords } from "./style-keyword-labels";
import {
  scrubbedValue,
  steppedValue,
  toggleOptionsFor,
  toggleShows,
} from "./style-numeric";
import { textNumber, UnitWords, NumericField } from "./style-numeric-field";
import { BOX_SHADOW, drawsShadow, ShadowField } from "./style-shadow-field";
import { useDraft, arrowStep, storedText } from "./style-text-field";
import { tokenForTypedName } from "./style-variables";
import {
  focusVariableAfterPick,
  pickedVariable,
  useOfferedVariables,
  VariableChoice,
  VariableSelectItems,
} from "./variable-choice";

/**
 * The leaf a catalog property's variables are offered for, outside the style
 * panel: its own leaf, or, for a union such as line height or weight, the one
 * folded leaf over its forms the panel's field uses. `undefined` for a
 * property the catalog does not list, or one with no form a variable fits.
 */
export function propertyVariableLeaf(property: string): StyleLeaf | undefined {
  const shape = STYLE_CATALOG.find(entry => entry.property === property)?.shape;
  if (shape === undefined) return undefined;
  if (isStyleLeaf(shape)) return shape;
  if (shape.kind !== "union") return undefined;
  const first = shape.of.find(isStyleLeaf);
  return first === undefined ? undefined : foldedLeafFor(property, first);
}

/**
 * The leaf a field's variables are offered for: the control's own, or, for a
 * folded union drawn as one field, one leaf over all its forms, which takes
 * every kind any form takes and judges each variable by the form its kind is
 * written in (see `foldedLeaf`).
 */
export function variableLeafOf(
  leaf: StyleLeaf,
  fold: Fold | undefined
): StyleLeaf {
  return fold === undefined ? leaf : foldedLeafFor(fold.property, leaf);
}

/**
 * The folded leaf for one catalog property, made once: its forms are the
 * catalog's, which do not change, and one leaf object keeps the forms it
 * carries attached. The control's own leaf stands in if the catalog has no
 * union there.
 */
function foldedLeafFor(property: string, fallback: StyleLeaf): StyleLeaf {
  const made = FOLDED_LEAVES.get(property);
  if (made !== undefined) return made;
  const shape = STYLE_CATALOG.find(entry => entry.property === property)?.shape;
  const arms =
    shape?.kind === "union" ? shape.of.filter(isStyleLeaf) : [fallback];
  // With its union, so each variable is judged by the arm the engine picks
  // for its value.
  const leaf =
    shape?.kind === "union" && arms.length > 0
      ? foldedLeaf(arms, shape)
      : foldedLeaf(arms.length > 0 ? arms : [fallback]);
  FOLDED_LEAVES.set(property, leaf);
  return leaf;
}

const FOLDED_LEAVES = new Map<string, StyleLeaf>();

/**
 * A closed vocabulary of more than two keywords, as a menu.
 *
 * Its own component rather than a branch inside the router, so that deciding
 * WHICH surface a leaf gets and drawing one are separate readings: the router
 * is then short enough to see all three choices at once, which is the thing a
 * reader comes to it for.
 */
function SelectField({
  id,
  control,
  stored,
  describedBy,
  onCommit,
}: {
  id: string;
  control: StyleControl & { leaf: Extract<StyleLeaf, { kind: "keyword" }> };
  stored: StyleValue | undefined;
  describedBy: string | undefined;
  onCommit: (value: StyleValue | null) => CommitOutcome;
}): React.JSX.Element {
  // The refusal, and the CSS names while they are shown.
  const described = useFieldDescription(describedBy);
  const current = typeof stored === "string" ? stored : "";
  const hint = useUnsetHint("Not set");
  // The validator accepts a keyword case-insensitively, with surrounding CSS
  // whitespace and escapes, and accepts the CSS-wide keywords everywhere — so
  // a stored `Bold` or `inherit` is live and compiles while matching no item
  // here, and the select would render empty over a value that is doing
  // something. Offered VERBATIM rather than normalised, in the place of the
  // item it reads the same as, so the stored string needs no rule of its own.
  const offered = menuKeywords(
    control.leaf.cssProperty,
    control.leaf.values,
    current
  );
  return (
    <div className="nx-style-inspector__select">
      <Select value={current} onValueChange={value => onCommit(value)}>
        <SelectTrigger
          id={id}
          aria-describedby={described}
          aria-invalid={describedBy === undefined ? undefined : true}
        >
          <SelectValue placeholder={hint} />
        </SelectTrigger>
        <SelectContent>
          {/* In words, the CSS spelling in the tooltip; see style-keyword-labels. */}
          {offered.map(option => (
            <SelectItem key={option} value={option} title={option}>
              {keywordLabel(control.leaf.cssProperty, option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * What this control's clear action removes, named for the author.
 *
 * The property alone where a property draws one control, and the property plus
 * the position where it draws several: `padding` and `margin` both have a block
 * start, so two buttons called "Clear block start" name the same thing twice
 * and a screen-reader user cannot tell which style each removes.
 */
/** A folded union's control, and the property it edits. */
interface Fold {
  readonly kind: FoldedControl;
  readonly property: string;
}

/** The folded control the property being drawn takes, if it is folded. */
export const FoldedUnion: React.Context<Fold | undefined> = React.createContext<
  Fold | undefined
>(undefined);

/**
 * One control for a union the author picks without naming its form: a list
 * holding both forms' values, or a field that infers the form from the text.
 */
function FoldedField({
  id,
  fold,
  leaf,
  stored,
  actionName,
  tokens,
  describedBy,
  onCommit,
}: {
  id: string;
  fold: Fold;
  /** The leaf the field's variables are offered for; see `variableLeafOf`. */
  leaf: StyleLeaf;
  stored: StyleValue | undefined;
  actionName: string;
  tokens: SiteTokenSet | undefined;
  describedBy: string | undefined;
  onCommit: (value: StyleValue | null) => CommitOutcome;
}): React.JSX.Element {
  // The site's variables for this property: first in the list a weight is
  // chosen from, and behind a menu of its own at a typed field's end, which
  // has no unit menu to hold them.
  const offered = useOfferedVariables(leaf, tokens);
  const pick = (identity: string): void => {
    onCommit({ $token: identity });
  };
  if (fold.kind === "number-or-length") {
    return (
      <div className="nx-style-inspector__numeric">
        <LengthOrNumberField
          id={id}
          leaf={leaf}
          stored={stored}
          tokens={tokens}
          describedBy={describedBy}
          onCommit={onCommit}
        />
        <VariableChoice
          leaf={leaf}
          tokens={tokens}
          current={undefined}
          label={actionName}
          onPick={pick}
        />
      </div>
    );
  }
  return (
    <OptionSelect
      id={id}
      options={fontWeightOptions(stored)}
      stored={stored}
      describedBy={describedBy}
      onCommit={onCommit}
      variables={offered}
      onPickVariable={pick}
    />
  );
}

/**
 * An inherited value by the name its option carries — `700` as "Bold 700" —
 * found by the key it would be stored under, so the list and the hint name a
 * weight the same way. As written when no option holds it.
 */
function optionNamed(
  options: readonly FoldedOption[],
  written: string
): string {
  const number = trimCssWhitespace(written) === "" ? NaN : Number(written);
  const key = storedKey(Number.isFinite(number) ? number : written);
  return options.find(option => option.key === key)?.label ?? written;
}

/** A select over named options, each committing its own stored value. */
function OptionSelect({
  id,
  options,
  stored,
  describedBy,
  onCommit,
  variables,
  onPickVariable,
}: {
  id: string;
  options: readonly FoldedOption[];
  stored: StyleValue | undefined;
  describedBy: string | undefined;
  onCommit: (value: StyleValue | null) => CommitOutcome;
  /** The site's variables the property takes, listed before the options. */
  variables: readonly SiteVariable[];
  onPickVariable: (identity: string) => void;
}): React.JSX.Element {
  // The refusal, and the CSS names while they are shown.
  const described = useFieldDescription(describedBy);
  const current = storedKey(stored) ?? "";
  const inherited = React.useContext(InheritedValue);
  const hint =
    inherited === undefined ? "Not set" : optionNamed(options, inherited);
  return (
    <div className="nx-style-inspector__select">
      <Select
        value={current}
        onValueChange={key => {
          const identity = pickedVariable(key);
          if (identity !== undefined) {
            // The list becomes the variable's chip; focus follows to it.
            focusVariableAfterPick(document.getElementById(id));
            onPickVariable(identity);
            return;
          }
          const chosen = options.find(option => option.key === key);
          if (chosen !== undefined) onCommit(chosen.value);
        }}
      >
        <SelectTrigger
          id={id}
          aria-describedby={described}
          aria-invalid={describedBy === undefined ? undefined : true}
        >
          <SelectValue placeholder={hint} />
        </SelectTrigger>
        <SelectContent>
          <VariableSelectItems offered={variables} before />
          {options.map(option => (
            <SelectItem key={option.key} value={option.key}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * A field taking a number or a length as typed: "1.5" is stored as a number,
 * "24px" or "150%" as written. Written as it is typed, as every text field in
 * the panel is, and the stretch of typing is one undo step, ended on blur and
 * on Enter. A shared style is written only when the edit ends.
 */
function LengthOrNumberField({
  id,
  leaf,
  stored,
  tokens,
  describedBy,
  onCommit,
}: {
  id: string;
  /** The leaf the field's variables are offered for, both arms' kinds. */
  leaf: StyleLeaf;
  stored: StyleValue | undefined;
  tokens: SiteTokenSet | undefined;
  describedBy: string | undefined;
  onCommit: (value: StyleValue | null) => CommitOutcome;
}): React.JSX.Element {
  // The refusal, and the CSS names while they are shown.
  const described = useFieldDescription(describedBy);
  const { draft, setDraft, live } = useDraft(stored);
  const typedLive = React.useContext(StyleTargetContext).kind !== "shared";
  const mode = useCanvasTokenMode();
  const hint = useUnsetHint("1.5, 24px or 150%");
  // A variable's name typed here is that variable, asked before the text is
  // read as a number or a length, as every text field asks it.
  const valueOf = (text: string): StyleValue | null => {
    const named = tokenForTypedName(leaf, tokens, text, mode);
    return named === undefined ? lineHeightFromText(text) : { $token: named };
  };
  const commit = () => {
    live.join(() => {
      if (draft === storedText(stored) || live.written(draft)) return;
      if (onCommit(valueOf(draft)) === "unchanged") {
        setDraft(storedText(stored));
      }
    });
    live.end();
  };
  // A keystroke writes nothing while emptied or refused, so the canvas keeps
  // the last valid value.
  const write = (text: string): boolean =>
    typedStyleText(text) !== undefined && onCommit(valueOf(text)) === "applied";
  const owning = useLineHeightLabelScrub({ draft, setDraft, stored, onCommit });
  return (
    <Input
      id={id}
      value={draft}
      placeholder={hint}
      // A value, not words: no list of earlier entries over the field.
      autoComplete="off"
      aria-describedby={described}
      aria-invalid={describedBy === undefined ? undefined : true}
      onChange={event => {
        if (typedLive) live.type(event.target.value, write);
        else setDraft(event.target.value);
      }}
      // Nothing of its own is written while a drag on the label owns it.
      onBlur={() => owning() || commit()}
      onKeyDown={event => {
        if (commitOnEnter(event, commit)) return;
        // An arrow steps the value as its kind steps, a number or a length,
        // through the same rule as every numeric field.
        const delta = arrowStep(event);
        const leaf = delta === null ? undefined : lineHeightLeafFor(draft);
        if (delta === null || leaf === undefined) return;
        const next = steppedValue(
          leaf,
          lineHeightFromText(draft) ?? undefined,
          delta
        );
        if (next === undefined) return;
        event.preventDefault();
        if (onCommit(next) !== "refused") setDraft(String(next));
      }}
    />
  );
}

/**
 * A line height offered to its row's label to drag, as its kind steps: a
 * number or a length. Written once on release, as a typed value is.
 *
 * @returns whether a drag owns the value now, so the field writes nothing of
 *   its own meanwhile
 */
function useLineHeightLabelScrub({
  draft,
  setDraft,
  stored,
  onCommit,
}: {
  draft: string;
  setDraft: (value: string) => void;
  stored: StyleValue | undefined;
  onCommit: (value: StyleValue | null) => CommitOutcome;
}): () => boolean {
  const inherited = React.useContext(InheritedValue);
  return useLabelScrub({
    origin: lineHeightScrubOrigin(draft, inherited),
    at: (from, delta) => {
      const leaf = lineHeightLeafFor(String(from));
      return leaf === undefined ? undefined : scrubbedValue(leaf, from, delta);
    },
    draft,
    show: setDraft,
    reset: () => setDraft(storedText(stored)),
    commit: value => {
      if (onCommit(value) === "unchanged") setDraft(storedText(stored));
    },
  });
}

/**
 * Properties whose free CSS has a field of its own, by CSS property: an aspect
 * ratio's menu and text decoration's icons, each with what it can draw.
 */
const OWN_FIELDS: Readonly<
  Record<
    string,
    {
      draws: (stored: StyleValue | undefined) => boolean;
      /** Given the control and the site's variables too, for a field that offers them. */
      Field: (
        props: Parameters<typeof AspectRatioField>[0] & {
          control: StyleControl;
          tokens: SiteTokenSet | undefined;
        }
      ) => React.JSX.Element;
      /** Whether its tab stop is a button a label's `for` would click. */
      buttons: boolean;
      /**
       * The kind of value it draws, where one CSS property is written by
       * several: `background-image` is both an image's address and a
       * gradient, and only the address is a file to choose.
       */
      leaf?: StyleControl["leaf"]["kind"];
    }
  >
> = {
  "aspect-ratio": {
    draws: drawsAspectRatio,
    Field: AspectRatioField,
    buttons: false,
  },
  "text-decoration": {
    draws: drawsDecoration,
    Field: DecorationField,
    buttons: true,
  },
  // A shadow is built with the shadow control, as a shadow variable is; a
  // held shadow variable keeps its chip.
  [BOX_SHADOW]: {
    draws: drawsShadow,
    Field: ShadowField,
    buttons: false,
  },
  // Any position: the nine points, or one written as CSS beside them.
  "object-position": {
    draws: stored => stored === undefined || typeof stored === "string",
    Field: FocalPointField,
    buttons: true,
  },
  // The background's image: the Media library, an upload or a link, rather
  // than an address typed as CSS.
  "background-image": {
    draws: stored => stored === undefined || typeof stored === "string",
    Field: BackgroundImageField,
    buttons: false,
    leaf: "url",
  },
  // Where the background image sits, as the object position does.
  "background-position": {
    draws: stored => stored === undefined || typeof stored === "string",
    Field: BackgroundPositionField,
    buttons: true,
  },
  // How it is sized: Cover, Fit or Tile, each with the repeat it needs, or
  // any other size written as CSS.
  "background-size": {
    draws: stored => stored === undefined || typeof stored === "string",
    Field: BackgroundSizeField,
    buttons: true,
  },
};

/**
 * The field of its own a control is drawn with, if any: found by the CSS
 * property it writes, and by the kind of value where an entry names one.
 */
function ownFieldFor(
  leaf: StyleControl["leaf"]
): (typeof OWN_FIELDS)[string] | undefined {
  const own = OWN_FIELDS[leaf.cssProperty];
  return own === undefined || (own.leaf !== undefined && own.leaf !== leaf.kind)
    ? undefined
    : own;
}

/**
 * Whether a field's label only moves focus: where the control drawn is a
 * group of buttons, whose tab stop a label's `for` would click. Read from the
 * same decision that picks the control, so the two never disagree.
 */
export function labelFocusOnly(
  leaf: StyleControl["leaf"],
  stored: StyleValue | undefined
): boolean {
  if (drawsIcons(leaf)) return true;
  const own = ownFieldFor(leaf);
  return own !== undefined && own.buttons && own.draws(stored);
}

/** The edited container's flow; CSS's defaults until it is measured or read. */
export const AlignmentFlow: React.Context<Flow> = React.createContext<Flow>({
  writingMode: "horizontal-tb",
  rtl: false,
  flex: false,
  direction: "row",
});

/**
 * The icon buttons a keyword control draws, when its property is one drawn as
 * icons, in the flow of the container being edited.
 */
function useAlignmentGroup(control: StyleControl) {
  const flow = React.useContext(AlignmentFlow);
  return control.leaf.kind === "keyword"
    ? alignmentGroupFor(control.leaf.cssProperty, control.leaf.values, flow)
    : undefined;
}

/**
 * The control a leaf's kind resolves to.
 *
 * A keyword leaf carries a closed vocabulary: two values get a toggle and more
 * than two get a select over them. Every other kind is drawn as a text field
 * that accepts whatever the catalog judges — `length`, `number`, `color`, `css`
 * and `url` all store a scalar — with the numeric affordances layered on top
 * where the stored value is a single measurement.
 *
 * Layered rather than substituted, which is the decision worth keeping. A field
 * that MODELLED a length as a number and a unit could not hold `auto`,
 * `clamp(...)`, a two-part shorthand or a token, and would write each of them
 * away on the first edit. So the text field remains the control and the stepper
 * and unit menu are affordances it grows when the value is simple enough to
 * carry them; `style-numeric.ts` decides when that is, and answers `undefined`
 * rather than guessing.
 */
export function ValueField({
  id,
  labelledBy,
  control,
  stored,
  actionName,
  tokens,
  describedBy,
  onCommit,
}: {
  id: string;
  /** The field label's id, so a group of buttons can be named by it. */
  labelledBy: string;
  control: StyleControl;
  stored: StyleValue | undefined;
  /** What this control's clear action removes, named for the property. */
  actionName: string;
  /** The site's variables, which a field offers where its property takes one. */
  tokens: SiteTokenSet | undefined;
  /**
   * The id of the message explaining why this control's last value was refused,
   * or `undefined` when nothing was. Also what marks the control invalid: the
   * two travel together because a control described by an error message and not
   * marked invalid reads as one carrying a hint.
   */
  describedBy: string | undefined;
  onCommit: (value: StyleValue | null) => CommitOutcome;
}): React.JSX.Element {
  // Decided BEFORE the menu, because every keyword leaf resolves to the
  // `select` control kind — so a branch on that kind placed first would return
  // for all of them and the toggle could never be reached.
  // Both read before any branch, as hooks must be.
  const fold = React.useContext(FoldedUnion);
  // Alignment and direction as icons that follow the container's flow.
  const alignment = useAlignmentGroup(control);
  if (fold !== undefined) {
    return (
      <FoldedField
        id={id}
        fold={fold}
        leaf={variableLeafOf(control.leaf, fold)}
        stored={stored}
        actionName={actionName}
        tokens={tokens}
        describedBy={describedBy}
        onCommit={onCommit}
      />
    );
  }
  if (alignment !== undefined) {
    return (
      <IconChoiceField
        id={id}
        labelledBy={labelledBy}
        group={alignment}
        stored={stored}
        actionName={actionName}
        describedBy={describedBy}
        onCommit={onCommit}
      />
    );
  }
  // A property with a field of its own, where the stored value is one that
  // field can draw; any other spelling keeps the text field.
  const own = ownFieldFor(control.leaf);
  if (own !== undefined && own.draws(stored)) {
    return (
      <own.Field
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
  const toggle = toggleOptionsFor(control.leaf);
  if (toggle !== undefined && toggleShows(toggle, stored)) {
    return (
      <ToggleField
        id={id}
        labelledBy={labelledBy}
        options={toggle}
        cssProperty={control.leaf.cssProperty}
        stored={stored}
        describedBy={describedBy}
        onCommit={onCommit}
      />
    );
  }

  // A keyword vocabulary too wide for a toggle is a menu. Narrowed here rather
  // than inside the component so the leaf carries its own kind through.
  if (control.kind === "select" && control.leaf.kind === "keyword") {
    return (
      <SelectField
        id={id}
        control={{ ...control, leaf: control.leaf }}
        stored={stored}
        describedBy={describedBy}
        onCommit={onCommit}
      />
    );
  }
  if (MILLISECOND_PROPERTIES.has(control.leaf.cssProperty)) {
    return (
      <MillisecondsField
        id={id}
        control={control}
        stored={stored}
        actionName={actionName}
        tokens={tokens}
        describedBy={describedBy}
        onCommit={onCommit}
      />
    );
  }
  const scale = PERCENT_SCALES[control.leaf.cssProperty];
  if (scale !== undefined) {
    return (
      <PercentField
        scale={scale}
        id={id}
        control={control}
        stored={stored}
        actionName={actionName}
        tokens={tokens}
        describedBy={describedBy}
        onCommit={onCommit}
      />
    );
  }
  return (
    <NumericField
      id={id}
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
 * A fraction as a percent, and back: multiplied or divided by 100 and no
 * more, to twelve significant figures, which drops the binary noise of the
 * division (`12.345 / 100` is `0.12345000000000001`) without rounding a
 * value an author typed.
 */
function percentOf(fraction: number): number {
  return Number((fraction * 100).toPrecision(12));
}

function fractionOf(percent: number): number {
  return Number((percent / 100).toPrecision(12));
}

/**
 * How a value an author reads in percent is stored: opacity as the fraction
 * CSS takes, an overlay's strength as the percent itself; and where the
 * slider rests while nothing is set.
 */
interface PercentScale {
  readonly fraction: boolean;
  readonly unset: number;
}

/** The values drawn in percent, by CSS property. */
const PERCENT_SCALES: Readonly<Record<string, PercentScale>> = {
  opacity: { fraction: true, unset: 100 },
  [OVERLAY_STRENGTH]: { fraction: false, unset: 50 },
};

/** A stored value as the percent the field shows; anything else as stored. */
function toPercent(
  value: StyleValue | undefined,
  scale: PercentScale
): StyleValue | undefined {
  return typeof value === "number" && scale.fraction ? percentOf(value) : value;
}

/**
 * What the percent field commits, as the fraction CSS takes. A number, or a
 * number typed as text, is divided by 100; a CSS-wide keyword is a whole
 * value and passes through unscaled.
 */
function fromPercent(
  value: StyleValue | null,
  scale: PercentScale
): StyleValue | null {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? textNumber(value)
        : undefined;
  if (number === undefined) return value;
  return scale.fraction ? fractionOf(number) : number;
}

/** The values stored as whole milliseconds, by CSS property. */
const MILLISECOND_PROPERTIES: ReadonlySet<string> = new Set([
  APPEAR_DURATION_PROPERTY,
  APPEAR_DELAY_PROPERTY,
]);

/**
 * A time stored as a number of milliseconds: the ordinary number field, with
 * its unit beside it, since the number alone does not say what it counts.
 */
function MillisecondsField(
  props: React.ComponentProps<typeof NumericField>
): React.JSX.Element {
  const unitId = React.useId();
  return (
    <div className="nx-style-inspector__unit-field">
      <UnitWords.Provider value={unitId}>
        <NumericField {...props} />
      </UnitWords.Provider>
      <span className="nx-style-inspector__unit" aria-hidden="true">
        ms
      </span>
      {/* The sign is not read; these words are, as the field's description. */}
      <span id={unitId} className="sr-only">
        milliseconds
      </span>
    </div>
  );
}

/**
 * Opacity, which an author thinks of in percent: a slider for "more or
 * less" and the number field beside it for an exact value, both 0 to 100.
 *
 * The number field is the ordinary one, handed the value and its range in
 * percent and converting what it commits back, so every behaviour it has (a
 * draft held while its menu opens, a refused value said beside it, a keyword
 * passed through, the variables at its end) is the same here. The inherited
 * value it shows as a hint is converted the same way.
 */
function PercentField({
  scale,
  ...props
}: React.ComponentProps<typeof NumericField> & {
  scale: PercentScale;
}): React.JSX.Element {
  const { control, stored, actionName, describedBy, onCommit } = props;
  const unitId = React.useId();
  const { shown, inheritedShown, resting } = percentReading(
    stored,
    React.useContext(InheritedValue),
    scale
  );
  const leaf = control.leaf;
  const percentControl =
    leaf.kind === "number"
      ? { ...control, leaf: { ...leaf, min: 0, max: 100 } }
      : control;
  return (
    <div className="nx-style-inspector__opacity">
      {resting === undefined ? null : (
        <PercentSlider
          resting={resting}
          actionName={actionName}
          describedBy={describedBy}
          onCommit={next => onCommit(fromPercent(next, scale))}
        />
      )}
      <InheritedValue.Provider value={inheritedShown}>
        <UnitWords.Provider value={unitId}>
          <NumericField
            {...props}
            control={percentControl}
            stored={shown}
            onCommit={value => onCommit(fromPercent(value, scale))}
          />
        </UnitWords.Provider>
      </InheritedValue.Provider>
      <span className="nx-style-inspector__percent" aria-hidden="true">
        %
      </span>
      {/* The sign is not read; these words are, as the field's description. */}
      <span id={unitId} className="sr-only">
        percent
      </span>
    </div>
  );
}

/**
 * An opacity as the field shows it: the stored value in percent, the
 * inherited one in percent as its hint, and where the slider's thumb rests.
 *
 * The thumb rests on the value set here, else the one inherited, else the
 * 100% of an unset opacity. A keyword (`inherit`) is none of these, so it has
 * no resting place and no slider: no position stands for it, and a nudge
 * would replace it with a number built from a position it never had.
 */
function percentReading(
  stored: StyleValue | undefined,
  inherited: string | undefined,
  scale: PercentScale
): {
  shown: StyleValue | undefined;
  inheritedShown: string | undefined;
  resting: number | undefined;
} {
  const shown = toPercent(stored, scale);
  const inheritedNumber =
    inherited === undefined ? undefined : textNumber(inherited);
  const inheritedPercent =
    inheritedNumber === undefined
      ? undefined
      : scale.fraction
        ? percentOf(inheritedNumber)
        : inheritedNumber;
  const unsetResting =
    inheritedPercent ?? (inherited === undefined ? scale.unset : undefined);
  return {
    shown,
    inheritedShown:
      inheritedPercent === undefined ? inherited : String(inheritedPercent),
    resting:
      typeof shown === "number"
        ? shown
        : shown === undefined
          ? unsetResting
          : undefined,
  };
}

/**
 * A percent's slider, 0 to 100: the thumb follows a drag, and the value is
 * written once it settles.
 */
function PercentSlider({
  resting,
  actionName,
  describedBy,
  onCommit,
}: {
  resting: number;
  actionName: string;
  describedBy: string | undefined;
  onCommit: (value: StyleValue | null) => CommitOutcome;
}): React.JSX.Element {
  // The refusal, and the CSS names while they are shown.
  const described = useFieldDescription(describedBy);
  const [preview, setPreview] = React.useState<number | undefined>(undefined);
  // Held with its section, as the fieldset holds the form controls; a
  // slider's thumb is not one, so it is told.
  const held = React.useContext(SectionHeld);
  const at = preview ?? resting;
  return (
    <Slider
      value={[at]}
      min={0}
      max={100}
      step={1}
      disabled={held}
      onValueChange={([next]) => setPreview(next)}
      onValueCommit={([next]) => {
        setPreview(undefined);
        if (next !== undefined) onCommit(next);
      }}
      thumbs={[
        {
          "aria-label": `${actionName} slider`,
          "aria-valuetext": `${at} percent`,
          // A refusal said for the field is said for the slider too, which
          // may hold the focus when it arrives.
          ...(describedBy === undefined
            ? {}
            : { "aria-describedby": described }),
        },
      ]}
    />
  );
}

/**
 * Two keywords as two buttons, with the current one pressed.
 *
 * `aria-pressed` rather than a radio group: these are two states of one
 * property rather than a choice among options that includes "neither", and the
 * clear affordance beside them is what expresses unset. Labelled by the field's
 * own label, so a screen reader reads the property name before the state.
 */
function ToggleField({
  id,
  labelledBy,
  options,
  cssProperty,
  stored,
  describedBy,
  onCommit,
}: {
  id: string;
  labelledBy: string;
  options: readonly string[];
  /** The property the options are keywords of, for their words. */
  cssProperty: string;
  stored: StyleValue | undefined;
  describedBy: string | undefined;
  onCommit: (value: StyleValue | null) => CommitOutcome;
}): React.JSX.Element {
  // The refusal, and the CSS names while they are shown.
  const described = useFieldDescription(describedBy);
  // What each option writes, from the field it is drawn in.
  const optionWrites = React.useContext(OptionWrites);
  return (
    <div
      // The field's id sits on the GROUP rather than on any one button. The
      // field label carries `htmlFor`, and a label pointing at a button
      // forwards a click to it — so naming the first option that way would make
      // clicking the property label press it, or clear it when already pressed,
      // and write an edit the author never asked for. A `div` is not labelable,
      // so the association is inert and the group is named by `aria-labelledby`
      // instead, which is what a screen reader reads either way.
      id={id}
      className="nx-style-inspector__toggle"
      role="group"
      aria-labelledby={labelledBy}
      aria-describedby={described}
    >
      {options.map(option => {
        const pressed = stored === option;
        return (
          // What this option writes, on hover or keyboard focus.
          <CssHint
            key={option}
            writes={optionWrites?.(option) ?? `${cssProperty}: ${option}`}
          >
            <button
              type="button"
              aria-pressed={pressed}
              // Marked on the BUTTONS rather than on the group, which carries the
              // description. `aria-invalid` is not a state `role="group"`
              // supports, so setting it there would be an attribute a screen
              // reader is entitled to ignore — and the file's own rule is that a
              // control described by a refusal must also read as invalid, or it
              // announces the message as a hint rather than as a failure.
              aria-invalid={describedBy === undefined ? undefined : true}
              // Pressing the pressed option CLEARS rather than re-writing it,
              // which is the only way a group of options can reach unset without
              // spending a button on "neither".
              onClick={() => onCommit(pressed ? null : option)}
            >
              {keywordLabel(cssProperty, option)}
            </button>
          </CssHint>
        );
      })}
    </div>
  );
}
