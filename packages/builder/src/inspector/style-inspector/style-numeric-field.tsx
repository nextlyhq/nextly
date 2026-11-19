"use client";

/**
 * The numeric field: a number with its unit, the keywords offered beside
 * it, scrubbing its label, and how a unit is read, shown and described.
 *
 * @module style-numeric-field
 */
import {
  trimCssWhitespace,
  type SiteTokenSet,
  type StyleLeaf,
  type StyleValue,
} from "@nextlyhq/blocks-engine";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@nextlyhq/ui";
import * as React from "react";

import { useCanvasTokenMode } from "../../canvas/prefers-dark";
import type { SiteVariable } from "../../style-colour";
import type { StyleControl } from "../../style-controls";
import {
  CSS_NUMBER,
  measurementOf,
  measurementOfText,
  scrubbedValue,
  scrubOrigin,
  steppedValue,
  unitChoicesFor,
  withDefaultUnit,
  withUnit,
} from "../../style-numeric";
import {
  focusVariableAfterPick,
  pickedVariable,
  useOfferedVariables,
  VariableSelectItems,
} from "../../variable-choice";
import { useFieldDescription } from "../css-hint";

import { InheritedValue } from "./inherited-value";
import { useLabelScrub } from "./label-scrub";
import { CompactSides } from "./spacing-box";
import type { CommitOutcome } from "./style-field-surroundings";
import { keywordLabel } from "./style-keyword-labels";
import {
  useDraft,
  useHeldBlur,
  commitDraft,
  TextField,
  storedText,
  placeholderFor,
  useTypesLive,
} from "./style-text-field";

/**
 * Keywords a menu leaves out, still accepted when typed and still shown when
 * stored: a font size's absolute sizes say no size an author can picture
 * ("x-large"), where the type scale above them does.
 */
const UNOFFERED_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  "font-size": [
    "xx-small",
    "x-small",
    "small",
    "medium",
    "large",
    "x-large",
    "xx-large",
    "xxx-large",
  ],
};

/**
 * A number written as text, as CSS reads one (`0.5`, `1e-7`), with only the
 * whitespace CSS trims around it: not JavaScript's `\s`, which also takes a
 * no-break space the engine refuses. `undefined` for anything else.
 */
export function textNumber(text: string): number | undefined {
  const trimmed = trimCssWhitespace(text);
  return CSS_NUMBER.test(trimmed) ? Number(trimmed) : undefined;
}

/**
 * What describes a number field: its own description, and the words for its
 * unit while what it shows is a number, or nothing at all. What it shows is
 * the draft, or, while that is empty, the inherited value it hints. A keyword
 * such as `inherit` has no unit to be said in.
 */
export function describedWithUnit(
  describedBy: string | undefined,
  unitWords: string | undefined,
  draft: string,
  inherited: string | undefined
): string | undefined {
  const shown = trimCssWhitespace(draft) === "" ? (inherited ?? "") : draft;
  const keyword =
    trimCssWhitespace(shown) !== "" && textNumber(shown) === undefined;
  return unitWords === undefined || keyword
    ? describedBy
    : [describedBy, unitWords].filter(Boolean).join(" ");
}

/**
 * The id of words naming a field's unit for a screen reader, where the unit
 * shows only as a sign beside it (opacity's %). Read by the number field and
 * added to what describes it, never to what marks it invalid.
 */
export const UnitWords: React.Context<string | undefined> = React.createContext<
  string | undefined
>(undefined);

/**
 * The text field, plus the affordances a value that is one measurement earns.
 *
 * The input stays a TEXT field whatever the value is, which is the whole design:
 * `auto`, `clamp(...)`, a shorthand and a token all remain typeable and none is
 * rewritten. The numeric behaviour is LAYERED on — arrow keys step the quantity
 * and a menu swaps the unit — and both disengage silently when the current value
 * is not a single measurement, so nothing an author can express is taken away by
 * the field being clever about the common case.
 */
export function NumericField({
  id,
  control,
  stored,
  actionName,
  tokens,
  describedBy,
  onCommit,
  onType,
  seed,
  offerVariables = true,
}: {
  id: string;
  control: StyleControl;
  stored: StyleValue | undefined;
  tokens: SiteTokenSet | undefined;
  /**
   * What the field starts with in place of the stored value, as if typed:
   * the digit that opened a spacing side's popover.
   */
  seed?: string | undefined;
  /**
   * Whether its unit menu lists the site's variables first; a spacing
   * side's popover lists them as its presets instead.
   */
  offerVariables?: boolean;
  /**
   * This control's own name, position included.
   *
   * Taken from the caller rather than derived from the property here: a
   * composite draws one of these per side, and a name built from the property
   * alone would give all four of `padding`'s menus the same accessible name,
   * leaving a screen reader no way to tell which side one edits.
   */
  actionName: string;
  describedBy: string | undefined;
  onCommit: (value: StyleValue | null) => CommitOutcome;
  /**
   * The write a keystroke or a label drag makes where the panel writes as it
   * is typed, where it differs from the commit: a Design value is drawn on
   * the canvas meanwhile and stored once, by the commit, when the edit ends.
   * `onCommit` when omitted. Given the value as the commit would be: a bare
   * number with the unit shown.
   */
  onType?: ((value: StyleValue | null) => CommitOutcome) | undefined;
}): React.JSX.Element {
  // The refusal, and the CSS names while they are shown.
  const described = useFieldDescription(describedBy);
  // Words for a unit shown only as a sign beside the field, for its description.
  const unitWords = React.useContext(UnitWords);
  // The value reaching the field from another tier, which it shows as a hint.
  const inheritedHint = React.useContext(InheritedValue);
  const units = unitChoicesFor(control.leaf);
  // The draft lives HERE rather than inside the text field, because two
  // controls edit one value and the unit menu was reading the other copy. An
  // author who types `20` over `12px` and then picks `rem` had the blur refuse
  // the unitless draft, leaving `12px` stored — and the menu composed from
  // THAT, committing `12rem` and discarding the 20 they were looking at.
  // Owned here rather than by the field, so the suffix can step aside while
  // the field shows a unit being typed. Escape ends that typing too, so the
  // value it puts back shows its unit in the suffix again.
  const [typing, setTyping] = React.useState(false);
  const { draft, setDraft, live } = useDraft(stored, () => setTyping(false));
  useSeededDraft(seed, setDraft);
  // Read from the DRAFT, so the menu offers units for the quantity on screen
  // and swaps the unit on that quantity rather than on a superseded one.
  const measurement = measurementOfText(draft);
  // The menu is shown only where it can act. Rendered against a value it cannot
  // decompose, every choice in it would be a no-op, and a disabled-looking
  // control that silently does nothing is worse than one that is not there.
  //
  // A UNITLESS draft keeps the menu rather than losing it, because typing the
  // quantity and then choosing the unit is an ordinary way to write one — and a
  // control that vanishes mid-edit is worse than one showing no selection. A
  // leaf with no units to offer never reaches this: `unitChoicesFor` answers
  // empty for anything that is not a dimension, so `line-height` as a number
  // has no menu to gain a unit from.
  // Not in the spacing box, whose sides take the unit as typed.
  const compact = React.useContext(CompactSides);
  const unitMenu = useFieldUnit({
    leaf: control.leaf,
    stored,
    draft,
    setDraft,
    onCommit,
  });
  const { unit, keywords } = unitMenu;
  const showUnits = !compact && unitMenu.acts;
  const hold = useHeldBlur(storedText(stored));
  const suffix = suffixState(unitMenu, typing, measurement);
  const menu = useValueMenu({
    // None in a side of the box, or where the caller lists them itself.
    offered: offerVariables && !compact,
    control,
    tokens,
    showUnits,
    suffix,
    hold,
    // A unit picked straight after typing finishes the same edit: one undo
    // step takes the number and its unit back together.
    chooseUnit: choice => {
      live.join(() => unitMenu.choose(choice));
      live.end();
    },
    onCommit,
  });
  // A stored unit the candidate list does not carry — `ch`, or an uppercase
  // `PX` the validator folds — is live and compiles while matching no item, and
  // a controlled select over it renders an EMPTY trigger above a value that is
  // doing something. Offered verbatim as its own item, which is what the
  // keyword select above already does for a value outside its vocabulary.
  const extraUnit = unlistedUnit(measurement, units);
  const typed = typedWrite(onType, control, unit);
  const commitText = useNumericLabelScrub({
    control,
    stored,
    draft,
    unit,
    setDraft,
    setTyping,
    onCommit,
    onType: typed.onType,
  });

  return (
    <div className="nx-style-inspector__numeric">
      <TextField
        id={id}
        control={control}
        stored={stored}
        draft={draft}
        setDraft={setDraft}
        tokens={tokens}
        describedBy={describedWithUnit(
          describedBy,
          unitWords,
          draft,
          inheritedHint
        )}
        invalid={describedBy !== undefined}
        // With no menu drawn there is nothing to hold for: its refs are empty.
        editing={{ holdBlur: hold.holdBlur, typing, setTyping }}
        live={live}
        {...typed}
        onCommit={commitText}
        // The unit shown in the suffix is left out of the field.
        {...suffixedText(control, unit, unitMenu.isKeyword, showUnits)}
        onStep={(draft, delta) => {
          const next = steppedValue(
            control.leaf,
            withDefaultUnit(control.leaf, draft, unit) ?? draft,
            delta
          );
          // `undefined` means this value cannot be stepped or the result would
          // be refused, so the key does nothing rather than writing a value the
          // document then rejects.
          if (next === undefined) return null;
          onCommit(next);
          return String(next);
        }}
      />
      <UnitMenu
        unitsShown={showUnits}
        {...menu}
        hold={hold}
        actionName={actionName}
        described={described}
        invalid={describedBy !== undefined}
        extraUnit={extraUnit}
        units={units}
        cssProperty={control.leaf.cssProperty}
        keywords={keywords}
        draft={draft}
      />
    </div>
  );
}

/**
 * Each keystroke's and each drag move's write where it is not the commit
 * (`NumericField`'s `onType`), given the unit the field shows, as the commit
 * is: as props for the text field, empty where there is none.
 */
function typedWrite(
  onType: ((value: StyleValue | null) => CommitOutcome) | undefined,
  control: StyleControl,
  unit: string
): { onType?: (value: StyleValue | null) => CommitOutcome } {
  if (onType === undefined) return {};
  return {
    onType: value => onType(withDefaultUnit(control.leaf, value, unit)),
  };
}

/** No variables, as one value, for a field that offers none. */
const NO_VARIABLES: readonly SiteVariable[] = Object.freeze([]);

/**
 * What a numeric field's value menu holds and shows: the site's variables
 * the field takes, first, where it offers them; the unit in its trigger
 * while units are listed, and nothing there while only variables are; and
 * what a choice does: a unit or keyword goes to the unit's own choice, a
 * variable is stored as `{ $token }`, the field becoming its chip.
 */
function useValueMenu({
  offered,
  control,
  tokens,
  showUnits,
  suffix,
  hold,
  chooseUnit,
  onCommit,
}: {
  offered: boolean;
  control: StyleControl;
  tokens: SiteTokenSet | undefined;
  showUnits: boolean;
  suffix: { value: string; placeholder: string };
  hold: ReturnType<typeof useHeldBlur>;
  chooseUnit: (choice: string) => void;
  onCommit: (value: StyleValue | null) => CommitOutcome;
}): {
  variables: readonly SiteVariable[];
  value: string;
  placeholder: string;
  choose: (choice: string) => void;
} {
  const variables = useOfferedVariables(control.leaf, tokens);
  const shown = showUnits ? suffix : { value: "", placeholder: "" };
  return {
    variables: offered ? variables : NO_VARIABLES,
    ...shown,
    choose: choice => {
      const identity = pickedVariable(choice);
      if (identity === undefined) {
        chooseUnit(choice);
        return;
      }
      // The field becomes the variable's chip, and its menu goes with it.
      focusVariableAfterPick(hold.trigger.current);
      onCommit({ $token: identity });
    },
  };
}

/**
 * A length field's value menu: the site's variables it takes first ("Your
 * spacing", "Your sizes"), then its units, a stored unit it doesn't list, and
 * its keywords after a line.
 *
 * The units are listed only where a choice of one could act. Over a value
 * they cannot act on (`calc()`, an inherited `auto`) the menu still opens on
 * the variables, the one way to them; with neither, nothing is drawn.
 */
function UnitMenu({
  unitsShown,
  variables,
  value,
  placeholder,
  hold,
  choose,
  actionName,
  described,
  invalid,
  extraUnit,
  units,
  cssProperty,
  keywords,
  draft,
}: {
  unitsShown: boolean;
  variables: readonly SiteVariable[];
  value: string;
  placeholder: string;
  hold: ReturnType<typeof useHeldBlur>;
  choose: (choice: string) => void;
  actionName: string;
  described: string | undefined;
  invalid: boolean;
  extraUnit: string | null;
  units: readonly string[];
  cssProperty: string;
  keywords: readonly string[];
  draft: string;
}): React.JSX.Element | null {
  if (!unitsShown && variables.length === 0) return null;
  return (
    <Select
      // The empty string, never `undefined`. Radix reads `""` as "no
      // selection" and shows the placeholder, while `undefined` switches it
      // from controlled to UNCONTROLLED — where it keeps whatever was last
      // picked, so a unit added and then undone leaves the trigger still
      // displaying it while the draft has none. The draft is the only unit
      // state, and passing `undefined` would give it a second one.
      value={value}
      onValueChange={hold.choosing(choose)}
      onOpenChange={hold.onOpenChange}
    >
      <SelectTrigger
        ref={hold.trigger}
        onBlur={hold.onTriggerBlur}
        className="nx-style-inspector__unit"
        // Named for what it changes: the unit where units are listed, the
        // variable where only variables are.
        aria-label={
          unitsShown ? `Unit for ${actionName}` : `Variables for ${actionName}`
        }
        // A unit change can be refused — a document at its byte limit, a
        // value the validator rejects — and the message that explains it is
        // rendered once for the field. Pointed at from HERE as well as from
        // the text input, because a screen-reader user who returns to the
        // menu is otherwise on the control that failed with nothing saying
        // so and no way to reach the reason.
        aria-describedby={described}
        aria-invalid={invalid ? true : undefined}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent ref={hold.content}>
        <VariableSelectItems offered={variables} before={unitsShown} />
        <UnitItems
          shown={unitsShown}
          extraUnit={extraUnit}
          units={units}
          cssProperty={cssProperty}
          keywords={keywords}
          draft={draft}
        />
      </SelectContent>
    </Select>
  );
}

/**
 * A unit menu's own choices: a stored unit it doesn't list, its units, and
 * its keywords after a line. Nothing where no unit choice could act.
 */
function UnitItems({
  shown,
  extraUnit,
  units,
  cssProperty,
  keywords,
  draft,
}: {
  shown: boolean;
  extraUnit: string | null;
  units: readonly string[];
  cssProperty: string;
  keywords: readonly string[];
  draft: string;
}): React.JSX.Element | null {
  if (!shown) return null;
  return (
    <>
      {extraUnit === null ? null : (
        <SelectItem value={extraUnit}>{extraUnit}</SelectItem>
      )}
      {units.map(choice => (
        <SelectItem key={choice} value={choice}>
          {choice}
        </SelectItem>
      ))}
      <KeywordItems
        cssProperty={cssProperty}
        keywords={keywords}
        draft={draft}
      />
    </>
  );
}

/**
 * The seed put in the draft once, after the draft has read the stored value:
 * the first character of a value typed on a spacing side, which opened it.
 */
function useSeededDraft(
  seed: string | undefined,
  setDraft: (value: string) => void
): void {
  const first = React.useRef(seed);
  React.useEffect(() => {
    if (first.current !== undefined) setDraft(first.current);
  }, [setDraft]);
}

/**
 * A unit menu's keywords after a line, in words with the CSS spelling in the
 * tooltip; see style-keyword-labels. Those a menu leaves out are left out
 * unless the field holds one.
 */
function KeywordItems({
  cssProperty,
  keywords,
  draft,
}: {
  cssProperty: string;
  keywords: readonly string[];
  draft: string;
}): React.JSX.Element | null {
  const unoffered = UNOFFERED_KEYWORDS[cssProperty] ?? [];
  const offered = keywords.filter(
    keyword => keyword === draft || !unoffered.includes(keyword)
  );
  if (offered.length === 0) return null;
  return (
    <>
      <SelectSeparator />
      {offered.map(keyword => (
        <SelectItem key={keyword} value={keyword} title={keyword}>
          {keywordLabel(cssProperty, keyword)}
        </SelectItem>
      ))}
    </>
  );
}

/**
 * The unit a measurement carries that the menu does not list, or `null`.
 * Its own function so the field reads as what it draws, not as the test.
 */
function unlistedUnit(
  measurement: ReturnType<typeof measurementOfText>,
  units: readonly string[]
): string | null {
  const unit = unitOf(measurement);
  return unit !== undefined && !units.includes(unit) ? unit : null;
}

/**
 * The number field's value, offered to its row's label to drag: shown in the
 * field while the pointer is down, written as it moves where the panel writes
 * as it is typed, and written on release through the same commit as a typed
 * value, the whole drag one undo step.
 *
 * @returns the field's own commit for its text: a bare number given the unit
 *   the field shows ("24" is 24px), and nothing written while a drag owns the
 *   value — a blur mid-drag would write the preview, and the release again.
 */
function useNumericLabelScrub({
  control,
  stored,
  draft,
  unit,
  setDraft,
  setTyping,
  onCommit,
  onType,
}: {
  control: StyleControl;
  stored: StyleValue | undefined;
  draft: string;
  unit: string;
  setDraft: (value: string) => void;
  setTyping: (typing: boolean) => void;
  onCommit: (value: StyleValue | null) => CommitOutcome;
  /** A move's write where it is not the commit; see `NumericField`. */
  onType: ((value: StyleValue | null) => CommitOutcome) | undefined;
}): (value: StyleValue | null) => CommitOutcome {
  const inherited = React.useContext(InheritedValue);
  const mode = useCanvasTokenMode();
  const commitText = (value: StyleValue | null): CommitOutcome =>
    onCommit(withDefaultUnit(control.leaf, value, unit));
  const typesLive = useTypesLive();
  const writeWith =
    (commit: (value: StyleValue | null) => CommitOutcome) =>
    (value: string | number): void => {
      commitDraft({
        draft: String(value),
        stored,
        kind: control.kind,
        leaf: control.leaf,
        // A drag writes a quantity, never a variable's name, so no variable
        // is matched against it.
        tokens: undefined,
        mode,
        onCommit: commit,
        setDraft,
      });
    };
  const write = writeWith(commitText);
  const owning = useLabelScrub({
    origin: scrubOrigin(control.leaf, draft, unit, inherited),
    at: (from, delta) => scrubbedValue(control.leaf, from, delta),
    draft,
    show: text => {
      // Shown as a value, not as typing, so the unit stays beside it.
      setTyping(false);
      setDraft(text);
    },
    reset: () => {
      setTyping(false);
      setDraft(storedText(stored));
    },
    commit: write,
    // Through the same commit as the release, past the field's own writes,
    // which wait while the drag owns the value.
    // A move is the field's own write unless it has one of its own.
    ...(typesLive
      ? { preview: onType === undefined ? write : writeWith(onType) }
      : {}),
  });
  // "refused" keeps the text on screen, which is the drag's live value.
  return value => (owning() ? "refused" : commitText(value));
}

/**
 * A field's hint while it shows its unit: what an unset value IS where the
 * property's initial value is a word ("Auto" for a width, a height or an
 * inset, "None" for a max size), so the hint never reads like a real default;
 * otherwise the leaf's own hint as a number alone ("16", a border's "1").
 * Margin allows `auto` but starts at 0, so it keeps a number.
 */
function bareNumberHint(control: StyleControl): string {
  const { leaf } = control;
  const keywords = leaf.kind === "dimension" ? (leaf.keywords ?? []) : [];
  const css = leaf.cssProperty;
  if (keywords.includes("none") && /^max-/.test(css)) return "None";
  if (keywords.includes("auto") && !/^(margin|padding)/.test(css)) {
    return "Auto";
  }
  return /^-?[\d.]+/.exec(placeholderFor(control))?.[0] ?? "";
}

/** A value that is one variable and nothing else: `var(--site-font-size-h2)`. */
const VARIABLE_ALONE = /^var\(\s*--[\w-]+\s*\)$/;

/**
 * Whether a choice in the unit menu can act: on a measurement, a keyword, or
 * any bare number the commit will give the unit (".5", "1e3" included, by the
 * same grammar). On an empty field only when what shows there is a
 * measurement or nothing: an inherited "auto" or "clamp(…)" beside "px"
 * would read as one value it is not. An inherited variable alone, a Site text
 * size, acts too: the field never shows it as text, and the next number takes
 * the unit chosen, as on any empty field.
 */
function unitActs(
  draft: string,
  measurement: ReturnType<typeof measurementOfText>,
  inherited: string | undefined,
  isKeyword: boolean
): boolean {
  const text = trimCssWhitespace(draft);
  if (text === "") {
    return (
      inherited === undefined ||
      measurementOfText(inherited) !== undefined ||
      VARIABLE_ALONE.test(trimCssWhitespace(inherited))
    );
  }
  return measurement !== undefined || isKeyword || CSS_NUMBER.test(text);
}

/** The first unit that says one, in order of precedence, else px. */
function shownUnit(candidates: readonly (string | undefined)[]): string {
  return candidates.find(candidate => candidate !== undefined) ?? "px";
}

/**
 * How the field reads beside its unit suffix: the unit left out of the value
 * and the hint ("2" beside "rem"), a keyword shown once, in the suffix, and a
 * hint that says what an unset value is. Nothing when no suffix is shown.
 */
function suffixedText(
  control: StyleControl,
  unit: string,
  isKeyword: boolean,
  shown: boolean
): { display?: (text: string) => string; fallbackHint?: string } {
  if (!shown) return {};
  const fallbackHint = bareNumberHint(control);
  return {
    display: isKeyword
      ? () => ""
      : text => {
          // A length in another unit (an inherited "2px" beside a pending
          // "rem") is not shown beside this one, which would read as one
          // value it is not; the plain hint takes its place.
          const other = unitOf(measurementOfText(text));
          return other !== undefined && other !== unit
            ? fallbackHint
            : withoutUnit(text, unit);
        },
    fallbackHint,
  };
}

/** A measurement's unit, or `undefined` for none or a bare number. */
function unitOf(
  measurement: ReturnType<typeof measurementOfText>
): string | undefined {
  return measurement === undefined || measurement.unit === ""
    ? undefined
    : measurement.unit;
}

/** A length's text without the unit shown beside it: "2rem" beside "rem" reads "2". */
function withoutUnit(text: string, unit: string): string {
  const trimmed = trimCssWhitespace(text);
  const number = trimmed.slice(0, trimmed.length - unit.length);
  return trimmed.toLowerCase().endsWith(unit.toLowerCase()) &&
    CSS_NUMBER.test(number)
    ? number
    : text;
}

/**
 * The unit a length field shows and a bare number takes: the one the draft
 * already carries, else the one the author last chose, else the leaf's first
 * (px). Its keywords, `auto` and the rest, are offered after the units.
 *
 * `acts` says whether a choice in the menu can do anything: an empty field,
 * whose bare number will take the unit shown, one measurement, or one of the
 * keywords. Over anything else — `calc()`, scientific notation — every choice
 * would be a no-op, and a control that silently does nothing is worse than
 * none.
 */
function useFieldUnit({
  leaf,
  stored,
  draft,
  setDraft,
  onCommit,
}: {
  leaf: StyleLeaf;
  stored: StyleValue | undefined;
  draft: string;
  setDraft: (value: string) => void;
  onCommit: (value: StyleValue | null) => CommitOutcome;
}): {
  unit: string;
  keywords: readonly string[];
  isKeyword: boolean;
  acts: boolean;
  value: string;
  choose: (choice: string) => void;
} {
  const [chosen, setChosen] = React.useState<string | undefined>(undefined);
  const measurement = measurementOfText(draft);
  const units = unitChoicesFor(leaf);
  const keywords = leaf.kind === "dimension" ? (leaf.keywords ?? []) : [];
  const inherited = React.useContext(InheritedValue);
  // The unit the draft says, else the one just chosen, else the stored
  // value's, else the inherited value's, so a new number keeps the unit the
  // author sees; px only when nothing says another.
  const unit = shownUnit([
    unitOf(measurement),
    chosen,
    unitOf(measurementOf(stored)),
    unitOf(inherited === undefined ? undefined : measurementOfText(inherited)),
    units[0],
  ]);
  const isKeyword = keywords.includes(draft);
  const write = (value: string) => {
    if (onCommit(value) !== "refused") setDraft(value);
  };
  return {
    unit,
    keywords,
    isKeyword,
    acts:
      units.length > 0 && unitActs(draft, measurement, inherited, isKeyword),
    // A unit chosen over a stored keyword shows at once, though nothing is
    // written until a number is typed.
    value: isKeyword && chosen === undefined ? draft : unit,
    choose: choice => {
      // A keyword is a whole value, written as chosen.
      if (keywords.includes(choice)) {
        setChosen(undefined);
        return write(choice);
      }
      setChosen(choice);
      // Composed from the draft, which is what the author is looking at;
      // with no number on screen yet, the unit waits for one.
      const next = withUnit(leaf, draft, choice);
      if (next !== undefined) write(next);
    },
  };
}

/**
 * What the unit suffix shows. While the field shows typed text that carries
 * its own unit or a keyword ("2ch", "auto"), nothing: the text says it once,
 * where the suffix beside it read as "2ch ch".
 */
function suffixState(
  unitMenu: { value: string; isKeyword: boolean },
  typing: boolean,
  measurement: ReturnType<typeof measurementOfText>
): { value: string; placeholder: string } {
  const typedOwn =
    typing && (unitMenu.isKeyword || unitOf(measurement) !== undefined);
  return typedOwn
    ? { value: "", placeholder: "" }
    : { value: unitMenu.value, placeholder: "unit" };
}
