/**
 * Choosing a site variable for a style field that is not a colour: a font
 * size, a line height, a gap, a radius, a shadow; and showing one once it is
 * chosen.
 *
 * The site's variables are reached through the field's own value menu, never
 * through a button of their own beside it:
 *
 * - a field with a unit menu lists them first in that menu
 *   ({@link VariableSelectItems}: "Your spacing", "Your sizes", then units);
 * - a field with no menu of its own (a line height, a shadow, a width) draws
 *   one, a chevron at its end, that opens the list ({@link VariableChoice});
 * - a field holding a variable shows it as a green chip
 *   ({@link VariableChip}): its name opens the same list to choose another,
 *   its tooltip says what the variable is, and "Unlink" keeps its value as a
 *   plain one.
 *
 * The list is the colour picker's own `ChoiceList`, so every picker in the
 * inspector answers the keyboard the same way and searches past the same
 * length. What is offered is `variablesFor`, the one projection of the site's
 * variables the colour picker reads too, so a field can never offer a
 * variable the canvas does not declare.
 *
 * A pick hands back the variable's IDENTITY, which the field stores as
 * `{ $token }` exactly as a colour does. The page then follows the variable:
 * change its value in Design and every block holding the reference changes
 * with it, because the reference compiles to the variable's custom property
 * rather than to the value it had when it was picked.
 *
 * @module variable-choice
 */
import {
  resolveTokenPrefix,
  tokenCustomProperty,
  type SiteTokenSet,
  type StyleLeaf,
  type StyleValue,
  type TokenMode,
} from "@nextlyhq/blocks-engine";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  TooltipProvider,
} from "@nextlyhq/ui";
import { ChevronDown, Unlink2 } from "lucide-react";
import * as React from "react";

import { useCanvasTokenMode } from "./canvas/prefers-dark";
import { ChoiceList } from "./choice-list";
import { ChromeTooltip } from "./chrome-tooltip";
import { pickedTypeSize } from "./site-text-rows";
import {
  variableFor,
  variableLabel,
  variablesFor,
  type SiteVariable,
} from "./style-colour";
import { measurementOfText } from "./style-numeric";
import { variableSample, variableValueText } from "./style-variables";
import {
  lengthFamilyOf,
  variableGroupHeadings,
  variableGroupOf,
  type VariableGroup,
} from "./tokens-studio";

/** What {@link VariableChoice} is given. */
export interface VariableChoiceProps {
  /** The catalog leaf the field edits; its `tokenKinds` decide what is offered. */
  readonly leaf: StyleLeaf;
  /** The site's variables, or `undefined` when the host supplied none. */
  readonly tokens: SiteTokenSet | undefined;
  /** The identity the field holds, marked in the list, if it holds one. */
  readonly current: string | undefined;
  /** The field's name, for the button's and the list's names: "Font size". */
  readonly label: string;
  /** A variable was picked: its identity, to store as `{ $token }`. */
  readonly onPick: (identity: string) => void;
  /**
   * The held variable's name, drawn as the trigger in place of the chevron
   * alone, as a colour's trigger names its variable: a chip's name.
   */
  readonly named?: string;
  /** What the named trigger's tooltip says: see {@link variableTip}. */
  readonly tip?: string;
}

/** What {@link VariableChip} is given. */
export interface VariableChipProps {
  /**
   * The catalog leaf the field edits: the chip names its variable as the
   * field's list does, qualified where another listed variable shares the name.
   */
  readonly leaf: StyleLeaf;
  readonly tokens: SiteTokenSet | undefined;
  /** The identity the field stores. */
  readonly identity: string;
  /** The field's name, for the chip's and its buttons' names: "Font size". */
  readonly label: string;
  /**
   * The id of the field's visible label, to name the chip by. Without it the
   * chip is named by {@link label}; with it, by the words an author sees.
   */
  readonly labelledBy?: string;
  /** Another variable was picked from the chip's name. */
  readonly onPick: (identity: string) => void;
  /**
   * "Unlink" was pressed: the variable's value, resolved in the mode the
   * canvas shows and scaled as the reference is, to store as a plain value.
   */
  readonly onUnlink: (value: StyleValue) => void;
  /** A factor the variable is scaled by (a Small button's padding), shown after its name. */
  readonly times?: number | undefined;
}

/**
 * The variables offered at this leaf in the mode the canvas is showing, read
 * from the one source the colour picker reads too: the canvas's theme marker,
 * else the device's preference, so the list shows the values the canvas draws.
 */
export function useOfferedVariables(
  leaf: StyleLeaf,
  tokens: SiteTokenSet | undefined
): readonly SiteVariable[] {
  return variablesFor(leaf, tokens, useCanvasTokenMode());
}

/**
 * What kind of variable this is, in words, for its tooltip: "Spacing",
 * "Type size". Read from the groups the Design panel lists it under, so the
 * tooltip and Design call one variable the same thing.
 */
function variableKindWord(variable: SiteVariable): string {
  const group = variableGroupOf(variable);
  if (group === "type") {
    return lengthFamilyOf(variable) === "line-height"
      ? "Line height"
      : "Type size";
  }
  if (group === "fonts") {
    return variable.kind === "fontWeight" ? "Font weight" : "Font";
  }
  return GROUP_KIND_WORDS[group];
}

/** Each group's variable in words; type and fonts are told apart above. */
const GROUP_KIND_WORDS: Readonly<Record<VariableGroup, string>> = {
  colours: "Colour",
  type: "Type size",
  fonts: "Font",
  spacing: "Spacing",
  radius: "Radius",
  shadows: "Shadow",
  content: "Size",
  other: "Size",
};

/**
 * A held variable's tooltip: what kind it is, its name, its value and the
 * CSS custom property the page reads it from, as
 * "Spacing variable XL · 64px · --nx-space-xl".
 *
 * The custom property is the engine's own spelling for the site's prefix,
 * so it is the name an author finds in the page's CSS.
 */
export function variableTip(
  variable: SiteVariable,
  name: string,
  tokens: SiteTokenSet | undefined
): string {
  const { prefix } = resolveTokenPrefix(tokens?.prefix);
  const css = tokenCustomProperty(variable.identity, prefix);
  return `${variableKindWord(variable)} variable ${name} · ${variable.value} · ${css}`;
}

/**
 * Whether a variable's value is kept as a number when unlinked: a number
 * variable, and a weight written as one ("700"), which a weight is stored as;
 * a weight's keyword ("bold") stays a word.
 */
function storedAsNumber(variable: SiteVariable): boolean {
  const numeric =
    variable.value.trim() !== "" && Number.isFinite(Number(variable.value));
  return (
    numeric && (variable.kind === "number" || variable.kind === "fontWeight")
  );
}

/** The fewest decimals a scaled length is written with, so 0.1 × 3 reads 0.3. */
const SCALED_DECIMALS = 4;

/**
 * The plain value a variable stands for, for "Unlink": its value in the mode
 * asked for, scaled as the reference is.
 *
 * A scaled measurement is multiplied out ("16px" × 0.75 is "12px"); any other
 * value, such as a fluid `clamp()`, is scaled by `calc()`, as the engine
 * scales the reference itself. A number variable, and a weight written as a
 * number, stay numbers, as a typed one is stored.
 */
export function unlinkedValue(
  variable: SiteVariable,
  times?: number
): StyleValue {
  const { value } = variable;
  if (storedAsNumber(variable)) return Number(value) * (times ?? 1);
  if (times === undefined) return value;
  const measurement = measurementOfText(value);
  if (measurement === undefined) return `calc(${value} * ${String(times)})`;
  const scaled = Number((measurement.number * times).toFixed(SCALED_DECIMALS));
  return `${String(scaled)}${measurement.unit}`;
}

/** An element's ancestors, nearest first. */
function ancestorsOf(element: Element | null): readonly Element[] {
  const chain: Element[] = [];
  for (let at = element?.parentElement; at; at = at.parentElement) {
    chain.push(at);
  }
  return chain;
}

/** What a field draws to choose a variable: its menu, or a chip's name. */
const CHOOSERS = ".nx-variable-menu, .nx-variable-chip__choose";

/**
 * Focus the variables trigger a field draws after a pick: the same one when
 * it survived the pick, otherwise the first one inside the nearest ancestor
 * still on the page.
 */
function focusAfterPick(
  trigger: HTMLElement | null,
  chain: readonly Element[]
): void {
  if (trigger?.isConnected === true) {
    trigger.focus();
    return;
  }
  const kept = chain.find(ancestor => ancestor.isConnected);
  kept?.querySelector<HTMLElement>(CHOOSERS)?.focus();
}

/**
 * After a variable is picked from a menu the pick replaces (a unit menu, whose
 * field becomes the chip), focus the chip's name once it is drawn, found from
 * the nearest of the menu's ancestors still on the page, rather than letting
 * focus fall to the page with the menu.
 */
export function focusVariableAfterPick(from: Element | null): void {
  const chain = ancestorsOf(from);
  requestAnimationFrame(() => focusAfterPick(null, chain));
}

/**
 * After Unlink, focus what the field draws in the chip's place once it is
 * drawn (its typed field, or the control that stayed), rather than letting
 * it fall to the page with the Unlink that held it.
 */
export function focusAfterUnlink(
  find: () => HTMLElement | null | undefined
): void {
  requestAnimationFrame(() => find()?.focus());
}

/**
 * A field's own way to its variables where it has no menu to list them in:
 * a chevron at its end, or a held variable's name, opening the list.
 *
 * Renders NOTHING when the leaf takes no variable or the site has none of the
 * kinds it takes, so a field can mount it unconditionally and never shows an
 * empty list. Picking closes the list, and Escape closes it without a pick.
 */
export function VariableChoice({
  leaf,
  tokens,
  current,
  label,
  onPick,
  named,
  tip,
}: VariableChoiceProps): React.JSX.Element | null {
  const offered = useOfferedVariables(leaf, tokens);
  const [open, setOpen] = React.useState(false);
  const trigger = React.useRef<HTMLButtonElement>(null);
  // The trigger's ancestors at the moment of a pick, nearest first; `null`
  // while no pick is waiting for the list to close.
  const pickedFrom = React.useRef<readonly Element[] | null>(null);
  if (offered.length === 0) return null;
  const button =
    named === undefined ? (
      <button
        ref={trigger}
        type="button"
        className="nx-variable-menu"
        aria-label={`Variables for ${label}`}
      >
        <ChevronDown aria-hidden="true" size={14} />
      </button>
    ) : (
      <button
        ref={trigger}
        type="button"
        className="nx-variable-chip__choose"
        // Named as a colour's trigger is: the field, then what it holds.
        aria-label={`Variables for ${label}: ${named}`}
      >
        <span className="nx-variable-chip__name">{named}</span>
        <ChevronDown aria-hidden="true" size={12} />
      </button>
    );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <VariableTipped tip={tip ?? "Choose a variable"}>
        <PopoverTrigger asChild>{button}</PopoverTrigger>
      </VariableTipped>
      <PopoverContent
        align="end"
        className="nx-style-inspector__picker"
        // The list puts focus on its search or its entries itself.
        onOpenAutoFocus={event => event.preventDefault()}
        /*
         * Where focus goes once a pick closes the list.
         *
         * A pick usually REPLACES the field that drew this trigger — a typed
         * value becomes a held variable — so the trigger focus would return
         * to is gone and focus would fall to the page. It is handed instead
         * to the trigger the field draws now, found from the nearest ancestor
         * still on the page, after that field has drawn. A close without a
         * pick returns to the trigger as usual.
         */
        onCloseAutoFocus={event => {
          const chain = pickedFrom.current;
          pickedFrom.current = null;
          if (chain === null) return;
          event.preventDefault();
          requestAnimationFrame(() => focusAfterPick(trigger.current, chain));
        }}
      >
        <VariableList
          offered={offered}
          current={current}
          onPick={identity => {
            pickedFrom.current = ancestorsOf(trigger.current);
            onPick(identity);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/** What a variable's item in a select stores as its value: `var:<identity>`. */
const VARIABLE_ITEM = "var:";

/**
 * The identity a select's choice picks, or `undefined` for a choice that is
 * not a variable (a unit, a keyword, an option).
 */
export function pickedVariable(choice: string): string | undefined {
  return choice.startsWith(VARIABLE_ITEM)
    ? choice.slice(VARIABLE_ITEM.length)
    : undefined;
}

/** The heading a variable is listed under in a field's menu. */
type MenuHeading =
  | "Your spacing"
  | "Your sizes"
  | "Your weights"
  | "Your values";

/** The headings in the order a menu lists them, spacing first. */
const MENU_HEADINGS: readonly MenuHeading[] = [
  "Your spacing",
  "Your sizes",
  "Your weights",
  "Your values",
];

function menuHeadingOf(variable: SiteVariable): MenuHeading {
  if (variableGroupOf(variable) === "spacing") return "Your spacing";
  if (variable.kind === "dimension") return "Your sizes";
  return variable.kind === "fontWeight" ? "Your weights" : "Your values";
}

/**
 * The site's variables as the first items of a field's own select (a unit
 * menu, a weight list), under "Your spacing" and "Your sizes", with a line
 * after them where the field's own choices follow.
 *
 * Each item's value is `var:<identity>`, read back by {@link pickedVariable};
 * its name is the variable's and its value follows, as the list draws them.
 * Nothing where nothing is offered.
 */
export function VariableSelectItems({
  offered,
  before,
}: {
  offered: readonly SiteVariable[];
  /** Whether the field's own choices follow, which a line then divides. */
  before: boolean;
}): React.JSX.Element | null {
  if (offered.length === 0) return null;
  return (
    <>
      {MENU_HEADINGS.map(heading => {
        const listed = offered.filter(
          variable => menuHeadingOf(variable) === heading
        );
        if (listed.length === 0) return null;
        return (
          <SelectGroup key={heading}>
            <SelectLabel className="nx-variable-choice__heading">
              {heading}
            </SelectLabel>
            {listed.map(variable => (
              <SelectItem
                key={variable.identity}
                value={`${VARIABLE_ITEM}${variable.identity}`}
                className="nx-variable-choice__item"
              >
                {variableLabel(variable, offered)}{" "}
                <span className="nx-variable-choice__value">
                  {variableValueText(variable)}
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
        );
      })}
      {before ? <SelectSeparator /> : null}
    </>
  );
}

/** One variable as the list holds it. */
interface VariableEntry {
  readonly key: string;
  readonly label: string;
  readonly group: VariableGroup;
  readonly variable: SiteVariable;
}

/**
 * The variables by name, each with its value and a sample of it, grouped as
 * the Design panel groups them when more than one group is present.
 */
function VariableList({
  offered,
  current,
  onPick,
}: {
  offered: readonly SiteVariable[];
  current: string | undefined;
  onPick: (identity: string) => void;
}): React.JSX.Element {
  const entries: VariableEntry[] = offered.map(variable => ({
    // The identity, which a rename leaves alone, so a renamed row keeps its
    // place and its key never collides with a new variable's.
    key: variable.identity,
    // Qualified only where two listed variables share a name.
    label: variableLabel(variable, offered),
    group: variableGroupOf(variable),
    variable,
  }));
  const present = new Set(entries.map(entry => entry.group));
  // Headings only where they tell groups apart: one group under its own
  // heading is a heading saying nothing.
  const groups =
    present.size > 1
      ? variableGroupHeadings().filter(({ group }) => present.has(group))
      : undefined;
  return (
    <div className="nx-style-inspector__variables">
      <ChoiceList
        choices={entries}
        currentKey={current}
        onPick={entry => onPick(entry.variable.identity)}
        label="Variables"
        searchLabel="Search variables"
        noMatch="No variables match this search."
        {...(groups === undefined ? {} : { groups })}
        choiceClassName="nx-variable-choice__option"
        renderChoice={entry => <VariableRow entry={entry} />}
        // The whole name and value on the row, which never collapses, where
        // the value itself may be cut short or given way entirely.
        choiceTitle={entry => `${entry.label} ${entry.variable.value}`}
      />
    </div>
  );
}

/**
 * One row: the sample, the name, then the value in words.
 *
 * The space between name and value is a text node on purpose. The row's
 * accessible name is read from its text, and without it a screen reader hears
 * "Display48px" as one word.
 */
function VariableRow({ entry }: { entry: VariableEntry }): React.JSX.Element {
  const sample = variableSample(entry.variable);
  return (
    <>
      <span className="nx-variable-choice__sample" aria-hidden="true">
        {sample.kind === "bar" ? (
          <span
            className="nx-variable-choice__bar"
            data-sample-px={sample.px}
            style={{ inlineSize: `${String(sample.px)}px` }}
          />
        ) : null}
        {sample.kind === "fluid" ? (
          // No one size to scale to: a bar of its own, dashed.
          <span className="nx-variable-choice__bar" data-fluid="" />
        ) : null}
        {sample.kind === "shadow" ? (
          <span
            className="nx-vars__shadow"
            style={{ boxShadow: sample.value }}
          />
        ) : null}
      </span>
      <span
        className="nx-variable-choice__name"
        // A type size's name drawn at that size, so a scale reads as one.
        style={
          sample.kind === "type"
            ? { fontSize: `${String(sample.px)}px` }
            : undefined
        }
      >
        {entry.label}
      </span>{" "}
      <span className="nx-variable-choice__value">
        {variableValueText(entry.variable)}
      </span>
    </>
  );
}

/**
 * "Unlink", beside a value that comes from a variable: it keeps the value the
 * field shows now as a plain one, in one step, and the field stops following
 * the variable. Named by the field, since several fields can hold one
 * variable and a column of buttons named for it could not be told apart.
 *
 * An icon, its word in its tooltip and its name: a field's column is too
 * narrow for the variable's name, its value and a word beside them, and the
 * name is what the author reads first.
 */
export function UnlinkButton({
  label,
  onUnlink,
  ...rest
}: {
  label: string;
  onUnlink: () => void;
} & Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "onClick" | "type"
>): React.JSX.Element {
  return (
    <TooltipProvider delayDuration={300}>
      <ChromeTooltip content="Unlink">
        <button
          {...rest}
          type="button"
          className="nx-variable-unlink"
          onClick={onUnlink}
          aria-label={`Unlink ${label}`}
        >
          <Unlink2 aria-hidden="true" size={14} />
        </button>
      </ChromeTooltip>
    </TooltipProvider>
  );
}

/**
 * What a chip says: its name, the value shown beside it, and its tooltip.
 */
function chipWords({
  leaf,
  tokens,
  identity,
  times,
  mode,
  variable,
  offered,
}: {
  leaf: StyleLeaf;
  tokens: SiteTokenSet | undefined;
  identity: string;
  times: number | undefined;
  mode: TokenMode;
  variable: SiteVariable | undefined;
  offered: readonly SiteVariable[];
}): {
  name: string;
  shownValue: SiteVariable | undefined;
  tip: string | undefined;
} {
  // Named through the list's own rule, so two variables sharing a name read
  // here as they do there, and the chip says which one the document holds.
  const named =
    variable === undefined ? identity : variableLabel(variable, offered);
  // A type size in a font size field reads by its name and pair, "H2 ·
  // 28 / 1.2", which says its line height too; its value is in the pair.
  const typeSize =
    leaf.cssProperty === "font-size" && times === undefined
      ? pickedTypeSize(tokens, { $token: identity }, mode)
      : undefined;
  const name = chipName(named, typeSize?.pair, times);
  if (variable === undefined) {
    return { name, shownValue: undefined, tip: undefined };
  }
  // The pair already holds the value, so it is not said twice; the tooltip
  // says the value itself, so a type size is named plainly there.
  return typeSize === undefined
    ? { name, shownValue: variable, tip: variableTip(variable, name, tokens) }
    : {
        name,
        shownValue: undefined,
        tip: variableTip(variable, named, tokens),
      };
}

/**
 * What a chip names its variable: a type size by its name and pair, a
 * scaled variable by its scale ("padding-y × 0.75"), any other by name.
 */
function chipName(
  named: string,
  pair: string | undefined,
  times: number | undefined
): string {
  if (pair !== undefined) return `${named} · ${pair}`;
  return times === undefined ? named : `${named} × ${String(times)}`;
}

/**
 * The variable a field holds, shown in place of its typed value: a green chip
 * with the variable's name, which opens the list to choose another, its value,
 * and Unlink.
 *
 * A variable the site no longer defines shows the identity the document holds
 * rather than an empty space, and offers no Unlink: there is no value to keep.
 * The reference still compiles, so it is still on the page, and the row's
 * Reset removes it.
 */
export function VariableChip({
  leaf,
  tokens,
  identity,
  label,
  labelledBy,
  onPick,
  onUnlink,
  times,
}: VariableChipProps): React.JSX.Element {
  const mode = useCanvasTokenMode();
  const variable = variableFor(identity, tokens, mode);
  const offered = variablesFor(leaf, tokens, mode);
  const { name, shownValue, tip } = chipWords({
    leaf,
    tokens,
    identity,
    times,
    mode,
    variable,
    offered,
  });
  return (
    // A group, so it can carry a name: a bare paragraph maps to a role that
    // prohibits one. Focusable by script only, as the field's label targets it.
    <p
      className="nx-style-inspector__token nx-variable-chip"
      role="group"
      {...(labelledBy === undefined
        ? { "aria-label": label }
        : { "aria-labelledby": labelledBy })}
      tabIndex={-1}
    >
      {/* One line: the name whole, and its value only while it fits; the
          whole of both is in the name's tooltip. */}
      <span className="nx-variable-chip__text">
        {offered.length === 0 ? (
          <ChipName name={name} tip={tip} />
        ) : (
          <VariableChoice
            leaf={leaf}
            tokens={tokens}
            current={identity}
            label={label}
            onPick={onPick}
            named={name}
            {...(tip === undefined ? {} : { tip })}
          />
        )}
        {shownValue === undefined ? null : (
          <>
            {" "}
            <span className="nx-variable-chip__value">
              {variableValueText(shownValue)}
            </span>
          </>
        )}
      </span>
      {variable === undefined ? null : (
        <UnlinkButton
          label={label}
          onUnlink={() => onUnlink(unlinkedValue(variable, times))}
        />
      )}
    </p>
  );
}

/**
 * A held variable's control with its tooltip saying what the variable is, or
 * none while nothing is held. Kept mounted without one, so the control stays
 * one element and keeps its focus as a variable comes and goes.
 *
 * Wrap the control alone, never a list it opens: focus inside the list would
 * reach the tooltip through React's tree and open it over the list.
 *
 * Opened by the pointer and by keyboard focus, not by focus a script moves
 * after a pick made with the mouse (the field turning into its chip): shown
 * then, the tooltip covered the field just changed, and took the Escape that
 * leaves the panel. Whether focus is the keyboard's is the browser's own
 * `:focus-visible`.
 */
export function VariableTipped({
  tip,
  children,
}: {
  tip: string | undefined;
  children: React.ReactElement<React.HTMLAttributes<HTMLElement>>;
}): React.JSX.Element {
  const [quiet, setQuiet] = React.useState(false);
  const own = children.props;
  const trigger = React.cloneElement(children, {
    onFocus: event => {
      own.onFocus?.(event);
      setQuiet(!event.currentTarget.matches(":focus-visible"));
    },
    onPointerEnter: event => {
      own.onPointerEnter?.(event);
      setQuiet(false);
    },
  });
  return (
    <TooltipProvider delayDuration={300}>
      <ChromeTooltip content={tip} disabled={tip === undefined || quiet}>
        {trigger}
      </ChromeTooltip>
    </TooltipProvider>
  );
}

/** A held variable's name where no list offers another: text, with its tooltip. */
function ChipName({
  name,
  tip,
}: {
  name: string;
  tip: string | undefined;
}): React.JSX.Element {
  return (
    <VariableTipped tip={tip}>
      <span className="nx-variable-chip__name">{name}</span>
    </VariableTipped>
  );
}
