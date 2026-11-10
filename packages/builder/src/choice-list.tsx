/**
 * A list to choose one entry from, for the inspector's pickers: the Font
 * control's families and the colour control's variables.
 *
 * One list for both, so the two pickers answer the keyboard the same way:
 * the arrow keys, Home and End move, Enter picks, and a search appears once
 * the list is long enough to need one. Focus sits on the search when there is
 * one and on the list when there is not; either way the active entry is named
 * by `aria-activedescendant`, so a screen reader announces it as it moves.
 *
 * @module choice-list
 */
import { Input } from "@nextlyhq/ui";
import { Search } from "lucide-react";
import * as React from "react";

/** One entry: what keys it, what it is called, and the group it sits in. */
export interface ListedChoice {
  readonly key: string;
  readonly label: string;
  /** The group it is listed under, when the list has groups. */
  readonly group?: string;
}

/** How many entries the list holds before it offers a search. */
const SEARCH_FROM = 8;

export interface ChoiceListProps<C extends ListedChoice> {
  readonly choices: readonly C[];
  /** The entry the stored value is, marked in the list. */
  readonly currentKey: string | undefined;
  readonly onPick: (choice: C) => void;
  /** What the list is called: "Fonts". */
  readonly label: string;
  /** What the search is called, and says while empty: "Search fonts". */
  readonly searchLabel: string;
  /** What the list says when the search matches nothing. */
  readonly noMatch: string;
  /**
   * The headings of the groups, in the order they are listed. Without them
   * the list is one run of entries.
   */
  readonly groups?: ReadonlyArray<{ group: string; heading: string }>;
  /** What an entry draws: its label unless said otherwise. */
  readonly renderChoice?: (choice: C) => React.ReactNode;
  /**
   * An entry's tooltip: its label unless said otherwise, such as a label and
   * a value the row may cut short.
   */
  readonly choiceTitle?: (choice: C) => string;
  /** An entry's own style, such as a family drawn in itself. */
  readonly choiceStyle?: (choice: C) => React.CSSProperties | undefined;
  /** A class each entry carries beside the list's own. */
  readonly choiceClassName?: string;
  /**
   * How many entries the list holds before it offers a search, when a list
   * needs a figure of its own rather than the pickers' shared one.
   */
  readonly searchFrom?: number;
  /**
   * Drawn between the search and the rows: a group with nothing to offer,
   * said where its rows would be.
   */
  readonly leading?: React.ReactNode;
}

/**
 * The entries matching `query`, ignoring case, in the order the rows are
 * DRAWN: grouped, a list draws group by group, and the row it opens on and
 * the one an arrow moves to have to be the ones the author sees there, not
 * the next in the order they were given.
 */
function drawnChoices<C extends ListedChoice>(
  choices: readonly C[],
  query: string,
  groups: ChoiceListProps<C>["groups"]
): readonly C[] {
  const needle = query.trim().toLowerCase();
  const matching =
    needle === ""
      ? choices
      : choices.filter(choice => choice.label.toLowerCase().includes(needle));
  return groups === undefined
    ? matching
    : groups.flatMap(({ group }) =>
        matching.filter(choice => choice.group === group)
      );
}

export function ChoiceList<C extends ListedChoice>({
  choices,
  currentKey,
  onPick,
  label,
  searchLabel,
  noMatch,
  groups,
  renderChoice,
  choiceTitle,
  choiceStyle,
  choiceClassName,
  searchFrom = SEARCH_FROM,
  leading,
}: ChoiceListProps<C>): React.JSX.Element {
  const listId = React.useId();
  const [query, setQuery] = React.useState("");
  const searchable = choices.length > searchFrom;
  const shown = drawnChoices(choices, query, groups);
  const [active, setActive] = React.useState(() =>
    Math.max(
      0,
      shown.findIndex(choice => choice.key === currentKey)
    )
  );
  const activeChoice = shown[Math.min(active, shown.length - 1)];
  const optionId = (choice: C): string =>
    `${listId}-${choice.key.replace(/[^a-z0-9-]/gi, "_")}`;

  const list = React.useRef<HTMLUListElement>(null);
  const search = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    (searchable ? search.current : list.current)?.focus();
  }, [searchable]);
  React.useEffect(() => {
    if (activeChoice === undefined) return;
    document.getElementById(optionId(activeChoice))?.scrollIntoView({
      block: "nearest",
    });
  });

  const onKeyDown = (event: React.KeyboardEvent): void => {
    const last = shown.length - 1;
    const moves: Record<string, number> = {
      ArrowDown: Math.min(active + 1, last),
      ArrowUp: Math.max(active - 1, 0),
      Home: 0,
      End: last,
    };
    const next = moves[event.key];
    if (next !== undefined) {
      event.preventDefault();
      setActive(next);
      return;
    }
    if (event.key === "Enter" && activeChoice !== undefined) {
      event.preventDefault();
      onPick(activeChoice);
    }
  };

  const describedActive =
    activeChoice === undefined ? undefined : optionId(activeChoice);

  const option = (choice: C): React.JSX.Element => (
    <li
      key={choice.key}
      id={optionId(choice)}
      role="option"
      aria-selected={choice === activeChoice}
      data-current={choice.key === currentKey ? "" : undefined}
      className={
        choiceClassName === undefined
          ? "nx-font-pick__option"
          : `nx-font-pick__option ${choiceClassName}`
      }
      // Cut with an ellipsis when long: whole on hover.
      title={choiceTitle === undefined ? choice.label : choiceTitle(choice)}
      style={choiceStyle?.(choice)}
      onMouseMove={() => setActive(shown.indexOf(choice))}
      onClick={() => onPick(choice)}
    >
      {renderChoice === undefined ? choice.label : renderChoice(choice)}
    </li>
  );

  return (
    <>
      {searchable ? (
        <div className="nx-vars__search nx-font-pick__search">
          <Search aria-hidden="true" size={16} />
          <Input
            ref={search}
            type="search"
            role="combobox"
            aria-label={searchLabel}
            aria-controls={listId}
            aria-expanded="true"
            aria-activedescendant={describedActive}
            placeholder={searchLabel}
            value={query}
            onChange={event => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
        </div>
      ) : null}
      {leading}
      <ul
        ref={list}
        id={listId}
        role="listbox"
        aria-label={label}
        className="nx-font-pick__list"
        tabIndex={searchable ? -1 : 0}
        aria-activedescendant={searchable ? undefined : describedActive}
        onKeyDown={onKeyDown}
      >
        {shown.length === 0 ? (
          <li className="nx-vars__note nx-font-pick__none" role="presentation">
            {noMatch}
          </li>
        ) : null}
        {groups === undefined
          ? shown.map(option)
          : groups.map(({ group, heading }) => {
              const members = shown.filter(choice => choice.group === group);
              if (members.length === 0) return null;
              return (
                <li key={group} role="presentation">
                  <span
                    className="nx-vars__group-name nx-font-pick__heading"
                    aria-hidden="true"
                  >
                    {heading}
                  </span>
                  <ul
                    role="group"
                    aria-label={heading}
                    className="nx-font-pick__group"
                  >
                    {members.map(option)}
                  </ul>
                </li>
              );
            })}
      </ul>
    </>
  );
}
