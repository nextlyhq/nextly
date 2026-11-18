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
import { ChevronRight, Search } from "lucide-react";
import * as React from "react";

/** One entry: what keys it, what it is called, and the group it sits in. */
export interface ListedChoice {
  readonly key: string;
  readonly label: string;
  /** The group it is listed under, when the list has groups. */
  readonly group?: string;
  /**
   * What the search matches it by, when not its label alone: a label and
   * the line drawn under it, so what is searched is what is seen.
   */
  readonly search?: string;
  /**
   * Listed, and reached by the arrow keys, but never picked: a choice whose
   * row says why it can't be had yet.
   */
  readonly disabled?: boolean;
}

/** One group of a grouped list: what keys it, and its heading. */
export interface ChoiceGroup {
  readonly group: string;
  readonly heading: string;
  /**
   * Set to start the group folded: drawn as one row, `label`, which opens
   * it in place, under `heading`, which folded groups listed together share
   * ("Singles · Site"). A search shows a folded group's matching entries.
   */
  readonly fold?: {
    readonly heading: string;
    readonly label: string;
    /**
     * What choosing the folded row does, said to a screen reader as the
     * row's description: an option may not say it is expanded.
     */
    readonly hint?: string;
  };
}

/** What a folded row's description says where its group gives none. */
const FOLD_HINT = "Opens its entries here.";

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
   * the list is one run of entries. An empty heading draws none.
   */
  readonly groups?: ReadonlyArray<ChoiceGroup>;
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
 * One row as the list draws it: an entry, or a folded group's one row.
 */
type DrawnRow<C extends ListedChoice> =
  | { readonly kind: "choice"; readonly key: string; readonly choice: C }
  | {
      readonly kind: "fold";
      readonly key: string;
      readonly group: ChoiceGroup;
    };

/** The entries matching `query`, ignoring case, in the order given. */
function matchingChoices<C extends ListedChoice>(
  choices: readonly C[],
  query: string
): readonly C[] {
  const needle = query.trim().toLowerCase();
  return needle === ""
    ? choices
    : choices.filter(choice =>
        (choice.search ?? choice.label).toLowerCase().includes(needle)
      );
}

/**
 * The rows matching `query`, ignoring case, in the order they are DRAWN:
 * grouped, a list draws group by group, and the row it opens on and the one
 * an arrow moves to have to be the ones the author sees there, not the next
 * in the order they were given. A folded group with entries to show is one
 * row in their place.
 */
function drawnRows<C extends ListedChoice>(
  matching: readonly C[],
  groups: ChoiceListProps<C>["groups"],
  isFolded: (group: ChoiceGroup) => boolean
): readonly DrawnRow<C>[] {
  const row = (choice: C): DrawnRow<C> => ({
    kind: "choice",
    key: choice.key,
    choice,
  });
  if (groups === undefined) return matching.map(row);
  return groups.flatMap((group): DrawnRow<C>[] => {
    const members = matching.filter(choice => choice.group === group.group);
    if (members.length === 0) return [];
    return isFolded(group)
      ? [{ kind: "fold", key: `\u0000fold:${group.group}`, group }]
      : members.map(row);
  });
}

/**
 * The groups as drawn, in order: each open group on its own, and each run of
 * folded groups together under the headings they share.
 */
function drawnSections(
  groups: ReadonlyArray<ChoiceGroup>,
  isFolded: (group: ChoiceGroup) => boolean
): ReadonlyArray<{ readonly heading: string; readonly groups: ChoiceGroup[] }> {
  const sections: { heading: string; groups: ChoiceGroup[] }[] = [];
  for (const group of groups) {
    const last = sections.at(-1);
    if (isFolded(group) && last !== undefined && isFolded(last.groups[0])) {
      last.groups.push(group);
      continue;
    }
    sections.push({ heading: group.heading, groups: [group] });
  }
  return sections.map(section =>
    isFolded(section.groups[0])
      ? {
          ...section,
          heading: [
            ...new Set(section.groups.map(group => group.fold!.heading)),
          ].join(" · "),
        }
      : section
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
  // The folded groups the author opened; a search shows every group.
  const [opened, setOpened] = React.useState<ReadonlySet<string>>(
    () => new Set()
  );
  const searchable = choices.length > searchFrom;
  const isFolded = (group: ChoiceGroup): boolean =>
    group.fold !== undefined && query.trim() === "" && !opened.has(group.group);
  const matching = matchingChoices(choices, query);
  const shown = drawnRows(matching, groups, isFolded);
  const [active, setActive] = React.useState(() =>
    Math.max(
      0,
      shown.findIndex(row => row.key === currentKey)
    )
  );
  const activeRow = shown[Math.min(active, shown.length - 1)];
  const rowId = (row: DrawnRow<C>): string =>
    `${listId}-${row.key.replace(/[^a-z0-9-]/gi, "_")}`;

  const list = React.useRef<HTMLUListElement>(null);
  const search = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    (searchable ? search.current : list.current)?.focus();
  }, [searchable]);
  React.useEffect(() => {
    if (activeRow === undefined) return;
    document.getElementById(rowId(activeRow))?.scrollIntoView({
      block: "nearest",
    });
  });

  /**
   * A folded group opened in place, the author moved onto its first entry,
   * so the keyboard goes on from where the row was.
   */
  const open = (group: ChoiceGroup): void => {
    const next = new Set(opened).add(group.group);
    setOpened(next);
    const rows = drawnRows(
      matching,
      groups,
      each =>
        each.fold !== undefined && query.trim() === "" && !next.has(each.group)
    );
    setActive(
      Math.max(
        0,
        rows.findIndex(
          row => row.kind === "choice" && row.choice.group === group.group
        )
      )
    );
  };

  /** What pressing a row does: pick an entry, or open a folded group. */
  const press = (row: DrawnRow<C>): void => {
    if (row.kind === "fold") open(row.group);
    else if (row.choice.disabled !== true) onPick(row.choice);
  };

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
    if (event.key === "Enter" && activeRow !== undefined) {
      event.preventDefault();
      press(activeRow);
    }
  };

  const describedActive =
    activeRow === undefined ? undefined : rowId(activeRow);

  /** The id of a folded row's description. */
  const foldHintId = (row: DrawnRow<C>): string => `${rowId(row)}-hint`;

  const option = (row: DrawnRow<C>): React.JSX.Element => {
    if (row.kind === "fold") {
      const { fold } = row.group;
      return (
        <li
          key={row.key}
          id={rowId(row)}
          role="option"
          aria-selected={row === activeRow}
          // An option may not carry aria-expanded, so what choosing it
          // does is its description, drawn outside the list.
          aria-describedby={foldHintId(row)}
          className="nx-font-pick__option nx-choice-fold"
          title={`Show ${row.group.heading}`}
          onMouseMove={() => setActive(shown.indexOf(row))}
          onClick={() => press(row)}
        >
          <span className="nx-choice-fold__label">{fold?.label}</span>
          <ChevronRight
            aria-hidden="true"
            className="nx-choice-fold__icon"
            size={14}
          />
        </li>
      );
    }
    const { choice } = row;
    return (
      <li
        key={row.key}
        id={rowId(row)}
        role="option"
        aria-selected={row === activeRow}
        aria-disabled={choice.disabled === true ? "true" : undefined}
        data-current={choice.key === currentKey ? "" : undefined}
        className={
          choiceClassName === undefined
            ? "nx-font-pick__option"
            : `nx-font-pick__option ${choiceClassName}`
        }
        // Cut with an ellipsis when long: whole on hover.
        title={choiceTitle === undefined ? choice.label : choiceTitle(choice)}
        style={choiceStyle?.(choice)}
        onMouseMove={() => setActive(shown.indexOf(row))}
        onClick={() => press(row)}
      >
        {renderChoice === undefined ? choice.label : renderChoice(choice)}
      </li>
    );
  };

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
          : drawnSections(groups, isFolded).map(({ heading, groups: held }) => {
              const members = shown.filter(row =>
                held.some(group =>
                  row.kind === "fold"
                    ? row.group.group === group.group
                    : row.choice.group === group.group
                )
              );
              if (members.length === 0) return null;
              return (
                <li key={held[0].group} role="presentation">
                  {/* A group with no heading leads the list unnamed: one
                      entry standing apart from the groups under it. */}
                  {heading === "" ? null : (
                    <span
                      className="nx-vars__group-name nx-font-pick__heading"
                      aria-hidden="true"
                    >
                      {heading}
                    </span>
                  )}
                  <ul
                    role="group"
                    aria-label={heading === "" ? undefined : heading}
                    className="nx-font-pick__group"
                  >
                    {members.map(option)}
                  </ul>
                </li>
              );
            })}
      </ul>
      {/* Each folded row's description, outside the list, so it is read as
          the row's description and never as a row or part of its name. */}
      {shown.map(row =>
        row.kind === "fold" ? (
          <span
            key={`${row.key}-hint`}
            id={foldHintId(row)}
            className="nx-sr-only"
          >
            {row.group.fold?.hint ?? FOLD_HINT}
          </span>
        ) : null
      )}
    </>
  );
}
