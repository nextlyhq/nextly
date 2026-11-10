/**
 * Choosing a site variable for a style field that is not a colour: a font
 * size, a line height, a gap, a radius, a shadow.
 *
 * Three pieces, each its own export, so a field can place them where its own
 * layout wants them: the ◇ button that opens the list ({@link VariableChoice}),
 * a menu item that opens the same list from a unit menu
 * ({@link VariablesMenuItem}), and the chip that stands in place of the typed
 * value once a variable is chosen ({@link VariableChip}).
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
import type { SiteTokenSet, StyleLeaf } from "@nextlyhq/blocks-engine";
import {
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@nextlyhq/ui";
import { Diamond, X } from "lucide-react";
import * as React from "react";

import { ChoiceList } from "./choice-list";
import { useCanvasTokenMode } from "./prefers-dark";
import {
  variableFor,
  variableLabel,
  variablesFor,
  type SiteVariable,
} from "./style-colour";
import { variableSample, variableValueText } from "./style-variables";
import {
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
  /** Whether the field holds a variable now, which keeps the ◇ in view. */
  readonly bound: boolean;
  /**
   * Whether the field holds nothing, which also keeps the ◇ in view: on an
   * empty field it is what says a variable may be chosen. Left out, it shows
   * only on hover or focus.
   */
  readonly empty?: boolean;
  /** The identity the field holds, marked in the list, if it holds one. */
  readonly current: string | undefined;
  /** The field's name, for the button's and the list's names: "Font size". */
  readonly label: string;
  /** A variable was picked: its identity, to store as `{ $token }`. */
  readonly onPick: (identity: string) => void;
  /**
   * The held variable's name, drawn as the trigger in place of the ◇, as a
   * colour's trigger names its variable. For a field too narrow for both a
   * name and a ◇: a side of the spacing box.
   */
  readonly named?: string;
}

/** What {@link VariablesMenuItem} is given: the same, less `bound`. */
export type VariablesMenuItemProps = Omit<
  VariableChoiceProps,
  "bound" | "empty"
>;

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
  /** The field's name, for the remove button's name: "Font size". */
  readonly label: string;
  readonly onClear: () => void;
  /**
   * The id of the field's visible label, to name the chip by. Without it the
   * chip is named by {@link label}; with it, by the words an author sees.
   */
  readonly labelledBy?: string;
  /**
   * Makes the variable's name the way to choose another, for a field with no
   * room for a ◇ beside the chip. Left out, the name is text alone.
   */
  readonly onPick?: (identity: string) => void;
  /** A factor the variable is scaled by (a Small button's padding), shown after its name. */
  times?: number | undefined;
}

/**
 * The variables offered at this leaf in the mode the canvas is showing, read
 * from the one source the colour picker reads too: the canvas's theme marker,
 * else the device's preference, so the list shows the values the canvas draws.
 */
function useOffered(
  leaf: StyleLeaf,
  tokens: SiteTokenSet | undefined
): readonly SiteVariable[] {
  return variablesFor(leaf, tokens, useCanvasTokenMode());
}

/**
 * The ◇ button beside a field, and the list of variables it opens.
 *
 * Renders NOTHING when the leaf takes no variable or the site has none of the
 * kinds it takes, so a field can mount it unconditionally and never shows an
 * empty list. Picking closes the list, and Escape closes it without a pick.
 */
export function VariableChoice({
  leaf,
  tokens,
  bound,
  empty = false,
  current,
  label,
  onPick,
  named,
}: VariableChoiceProps): React.JSX.Element | null {
  const offered = useOffered(leaf, tokens);
  const [open, setOpen] = React.useState(false);
  const trigger = React.useRef<HTMLButtonElement>(null);
  // The trigger's ancestors at the moment of a pick, nearest first; `null`
  // while no pick is waiting for the list to close.
  const pickedFrom = React.useRef<readonly Element[] | null>(null);
  if (offered.length === 0) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {named === undefined ? (
          <button
            ref={trigger}
            type="button"
            className="nx-variable-choice"
            aria-label={`Variables for ${label}`}
            title="Use a variable"
            // Kept in view while the field holds a variable, so the way to
            // choose another is where the author last found it.
            data-bound={bound ? "" : undefined}
            data-empty={empty ? "" : undefined}
          >
            <Diamond aria-hidden="true" size={14} />
          </button>
        ) : (
          <button
            ref={trigger}
            type="button"
            className="nx-variable-chip__choose"
            // Named as a colour's trigger is: the field, then what it holds.
            aria-label={`Variables for ${label}: ${named}`}
            title={named}
          >
            {named}
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="nx-style-inspector__picker"
        // The list puts focus on its search or its entries itself.
        onOpenAutoFocus={event => event.preventDefault()}
        /*
         * Where focus goes once a pick closes the list.
         *
         * A pick usually REPLACES the field that drew this ◇ — a typed value
         * becomes a held variable — so the trigger focus would return to is
         * gone and focus would fall to the page. It is handed instead to the
         * ◇ the field draws now, found from the nearest ancestor still on the
         * page, after that field has drawn. A close without a pick returns to
         * the trigger as usual.
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

/** An element's ancestors, nearest first. */
function ancestorsOf(element: Element | null): readonly Element[] {
  const chain: Element[] = [];
  for (let at = element?.parentElement; at; at = at.parentElement) {
    chain.push(at);
  }
  return chain;
}

/**
 * Focus the ◇ a field draws after a pick: the same one when it survived the
 * pick, otherwise the first one inside the nearest ancestor still on the page.
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
  kept
    ?.querySelector<HTMLElement>(
      ".nx-variable-choice, .nx-variable-chip__choose"
    )
    ?.focus();
}

/**
 * "Use a variable…" as an item of a field's unit menu, opening the same list
 * beside the menu. For a field whose unit menu has room for it, in place of
 * the standalone ◇.
 *
 * NOT MOUNTED by any field yet: the inspector's fields still draw their units
 * in a select, which cannot hold a submenu, so they draw {@link VariableChoice}
 * instead. It is here for the unit menu that replaces that select, which must
 * render it inside its `DropdownMenuContent` and close itself in `onPick`,
 * since the menu's open state is the menu's own.
 *
 * Renders nothing when nothing would be offered, as the ◇ does.
 */
export function VariablesMenuItem({
  leaf,
  tokens,
  current,
  label,
  onPick,
}: VariablesMenuItemProps): React.JSX.Element | null {
  const offered = useOffered(leaf, tokens);
  if (offered.length === 0) return null;
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger aria-label={`Use a variable for ${label}`}>
        Use a variable…
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        className="nx-variable-choice__menu"
        // A menu opened by keyboard focuses its own content, after the list
        // has focused its search or entries; handed straight on to them, so
        // the arrow keys move through the variables rather than finding no
        // menu item to move to.
        onFocus={event => {
          if (event.target !== event.currentTarget) return;
          event.currentTarget
            .querySelector<HTMLElement>('input, [role="listbox"]')
            ?.focus();
        }}
      >
        <VariableList offered={offered} current={current} onPick={onPick} />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
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
 * The variable a field holds, shown in place of its typed value: the
 * variable's name and value, and a button that removes it.
 *
 * A variable the site no longer defines shows the identity the document holds
 * rather than an empty space. The reference still compiles, so it is still on
 * the page, and the author is owed the string that names it and a way to
 * remove it.
 */
export function VariableChip({
  leaf,
  tokens,
  identity,
  label,
  onClear,
  labelledBy,
  onPick,
  times,
}: VariableChipProps): React.JSX.Element {
  const mode = useCanvasTokenMode();
  const variable = variableFor(identity, tokens, mode);
  const offered = variablesFor(leaf, tokens, mode);
  // Named through the list's own rule, so two variables sharing a name read
  // here as they do there, and the chip says which one the document holds.
  const named =
    variable === undefined ? identity : variableLabel(variable, offered);
  // Scaled, the chip says by how much: "padding-y × 0.75".
  const name = times === undefined ? named : `${named} × ${String(times)}`;
  return (
    // A group, so it can carry a name: a bare paragraph maps to a role that
    // prohibits one. Focusable by script only, as the field's label targets it.
    <p
      className="nx-style-inspector__token nx-variable-chip"
      // The whole name and value on the chip, which never collapses, where the
      // value may be out of sight; its text, read out, holds both too.
      title={variable === undefined ? name : `${name} ${variable.value}`}
      role="group"
      {...(labelledBy === undefined
        ? { "aria-label": label }
        : { "aria-labelledby": labelledBy })}
      tabIndex={-1}
    >
      {/* One line: the name whole, and its value only while it fits; the
          whole of both is on the chip's tooltip. */}
      <span className="nx-variable-chip__text">
        {onPick === undefined || offered.length === 0 ? (
          <span className="nx-variable-chip__name">{name}</span>
        ) : (
          <VariableChoice
            leaf={leaf}
            tokens={tokens}
            bound
            current={identity}
            label={label}
            onPick={onPick}
            named={name}
          />
        )}
        {variable === undefined ? null : (
          <>
            {" "}
            <span className="nx-variable-chip__value">
              {variableValueText(variable)}
            </span>
          </>
        )}
      </span>
      <button
        type="button"
        onClick={onClear}
        // Named as the colour control's Clear is, by the field: several fields
        // can hold one variable, and a column of buttons all named for it
        // could not be told apart by a screen-reader user.
        aria-label={`Clear ${label}`}
        title={`Clear ${name}`}
      >
        <X aria-hidden="true" size={14} />
      </button>
    </p>
  );
}
