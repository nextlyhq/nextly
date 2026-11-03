/**
 * The inspector's Font control: choose from what the site can draw.
 *
 * Choose-only, with no box to type a family into. A typed name is a guess the
 * page may not be able to keep: a family the site has no file for renders in
 * whatever the reader's device has, and nothing says so. The list offers three
 * kinds of choice, each of which the published page can draw:
 *
 * - the site's font variables, stored as a reference so a change to the
 *   variable reaches every block using it;
 * - the families the site has files for, stored as the family followed by the
 *   generic family of its category, so a reader still gets a sensible face
 *   while the file loads;
 * - the system families, which every browser resolves.
 *
 * Every choice is drawn in itself. A value stored before, or written by the
 * API, that is none of these is shown as it is and can be cleared.
 *
 * @module font-family-field
 */
import {
  GENERIC_FONT_FAMILIES,
  isTokenRef,
  readFamilyList,
  resolveSiteTokens,
  tokenDisplayLabel,
  tokenIdentity,
  type FontFaceDef,
  type SiteTokenSet,
  type StyleValue,
} from "@nextlyhq/blocks-engine";
import { Input, Popover, PopoverContent, PopoverTrigger } from "@nextlyhq/ui";
import { ChevronDown, Search } from "lucide-react";
import * as React from "react";

import { familyStack, siteFamilies } from "./font-library";

export interface FontFamilyFieldProps {
  /** The control's id, so its label can point at it. */
  id?: string;
  /** The id of the element naming the property. */
  labelledBy?: string;
  /** What the block stores now. */
  stored: StyleValue | undefined;
  /** The site's variables, whose font variables are offered first. */
  tokens: SiteTokenSet | undefined;
  /**
   * The faces the page loads, or `undefined` while the site's style is being
   * read. Families with files are offered from them.
   */
  faces: readonly FontFaceDef[] | undefined;
  /** The faces the site's code supplies, which the editor cannot remove. */
  fromCode: readonly FontFaceDef[];
  /** Store a choice, or `null` to clear the property. */
  onCommit: (value: StyleValue | null) => void;
  /** Open Design's fonts, where fonts are added. Absent, no link shows. */
  onManageFonts?: () => void;
}

/**
 * What the inspector's host knows about the site's fonts: the faces the page
 * loads, the ones the site's code supplies, and a way to Design's fonts.
 */
export interface FontChoices {
  /** The faces the page loads, or `undefined` while they are being read. */
  readonly faces: readonly FontFaceDef[] | undefined;
  /** The faces the site's code supplies. */
  readonly fromCode: readonly FontFaceDef[];
  /** Open Design's fonts. */
  readonly onManageFonts?: () => void;
}

/**
 * The site's fonts, for the Font control wherever the inspector draws it.
 *
 * A context rather than a prop threaded through each section and field: only
 * one control reads it, and every layer between the panel and that control
 * would otherwise carry a value it never uses.
 */
export const FontChoicesContext: React.Context<FontChoices | undefined> =
  React.createContext<FontChoices | undefined>(undefined);

/** Whether a stored value is one this control can show: none, a stack, a reference. */
export function fontFamilyShowable(stored: StyleValue | undefined): boolean {
  return (
    stored === undefined || typeof stored === "string" || isTokenRef(stored)
  );
}

/** One entry in the list. */
interface FontChoice {
  readonly key: string;
  readonly group: ChoiceGroup;
  readonly label: string;
  /** The stack the entry is drawn in, when one can be drawn. */
  readonly drawn: string | undefined;
  /** What picking it stores. */
  readonly value: StyleValue;
}

type ChoiceGroup = "variables" | "site" | "system";

const GROUPS: ReadonlyArray<{ group: ChoiceGroup; heading: string }> = [
  { group: "variables", heading: "Font variables" },
  { group: "site", heading: "On this site" },
  { group: "system", heading: "System" },
];

/** The generic families in an author's words, the common ones first. */
const GENERIC_LABELS: Readonly<Record<string, string>> = {
  "system-ui": "System UI",
  "sans-serif": "Sans serif",
  serif: "Serif",
  monospace: "Monospace",
  cursive: "Cursive",
  fantasy: "Fantasy",
  "ui-sans-serif": "System sans serif",
  "ui-serif": "System serif",
  "ui-monospace": "System monospace",
  "ui-rounded": "System rounded",
  math: "Math",
  emoji: "Emoji",
  fangsong: "Fangsong",
};

/**
 * The families every browser resolves: exactly the generic keywords the
 * engine accepts, so no value it stores reads as unknown here. One without
 * words of its own is shown as written.
 */
const SYSTEM: ReadonlyArray<{ label: string; value: string }> = [
  ...Object.keys(GENERIC_LABELS).filter(value =>
    GENERIC_FONT_FAMILIES.includes(value)
  ),
  ...GENERIC_FONT_FAMILIES.filter(value => !(value in GENERIC_LABELS)),
].map(value => ({ label: GENERIC_LABELS[value] ?? value, value }));

/** How many entries the list holds before it offers a search. */
const SEARCH_FROM = 8;

/** A stack that draws, or nothing for one that only resolves on the page. */
function drawable(stack: string): string | undefined {
  return /var\s*\(/i.test(stack) ? undefined : stack;
}

/** Every entry the control offers, in the order it lists them. */
function choicesFor(
  tokens: SiteTokenSet | undefined,
  faces: readonly FontFaceDef[] | undefined,
  fromCode: readonly FontFaceDef[]
): FontChoice[] {
  const variables: FontChoice[] =
    tokens === undefined
      ? []
      : resolveSiteTokens(tokens)
          .tokens.filter(token => token.kind === "fontFamily")
          .map(token => {
            const identity = tokenIdentity(token);
            return {
              key: `variable:${identity}`,
              group: "variables",
              label: tokenDisplayLabel(token),
              drawn: drawable(token.values.light),
              value: { $token: identity },
            };
          });
  const site: FontChoice[] = siteFamilies(faces ?? [], fromCode).map(family => {
    const stack = familyStack(family.family, family.category);
    return {
      key: `site:${family.key}`,
      group: "site",
      label: family.family,
      drawn: stack,
      value: stack,
    };
  });
  const system: FontChoice[] = SYSTEM.map(entry => ({
    key: `system:${entry.value}`,
    group: "system",
    label: entry.label,
    drawn: entry.value,
    value: entry.value,
  }));
  return [...variables, ...site, ...system];
}

/** A stack written the way two equal stacks compare: no spacing, no case. */
function normalised(stack: string): string {
  return stack
    .replace(/\s*,\s*/g, ",")
    .trim()
    .toLowerCase();
}

/**
 * The entry a stored value is, or nothing when it is none of them.
 *
 * A family stored without its generic, or with another one, is still that
 * family: the first name in a stack is the author's choice.
 */
function currentChoice(
  stored: StyleValue | undefined,
  choices: readonly FontChoice[]
): FontChoice | undefined {
  if (stored === undefined) return undefined;
  if (isTokenRef(stored)) {
    return choices.find(
      choice =>
        isTokenRef(choice.value) && choice.value.$token === stored.$token
    );
  }
  if (typeof stored !== "string") return undefined;
  const exact = choices.find(
    choice =>
      typeof choice.value === "string" &&
      normalised(choice.value) === normalised(stored)
  );
  if (exact !== undefined) return exact;
  const reading = readFamilyList(stored);
  if (reading.kind !== "families") return undefined;
  const first = reading.parts[0]?.part.name.toLowerCase();
  return choices.find(
    choice => choice.group === "site" && choice.key === `site:${first ?? ""}`
  );
}

/** The stored value in words, for one the list does not hold. */
function storedText(stored: StyleValue): string {
  if (isTokenRef(stored)) return stored.$token;
  return typeof stored === "string" ? stored : JSON.stringify(stored);
}

export function FontFamilyField({
  id,
  labelledBy,
  stored,
  tokens,
  faces,
  fromCode,
  onCommit,
  onManageFonts,
}: FontFamilyFieldProps): React.JSX.Element {
  const choices = React.useMemo(
    () => choicesFor(tokens, faces, fromCode),
    [tokens, faces, fromCode]
  );
  const current = currentChoice(stored, choices);
  const unknown = stored !== undefined && current === undefined;
  const [open, setOpen] = React.useState(false);
  const shownValue = unknown
    ? `${storedText(stored)} · not on this site`
    : (current?.label ?? "Default");

  return (
    <div className="nx-font-pick" data-unknown={unknown ? "" : undefined}>
      <Popover open={open} onOpenChange={setOpen} modal={false}>
        <PopoverTrigger asChild>
          <button
            type="button"
            id={id}
            className="nx-font-pick__trigger"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-label={`Font, ${shownValue}`}
            aria-describedby={labelledBy}
          >
            <span
              className="nx-font-pick__value"
              data-placeholder={
                current === undefined && !unknown ? "" : undefined
              }
              style={
                current?.drawn === undefined
                  ? undefined
                  : { fontFamily: current.drawn }
              }
            >
              {shownValue}
            </span>
            <ChevronDown aria-hidden="true" size={14} />
          </button>
        </PopoverTrigger>
        {/* Aligned to the control's right edge: the list may be wider than
            the control, and the inspector sits at the window's right edge. */}
        <PopoverContent
          align="end"
          sideOffset={4}
          className="nx-font-pick__popover"
          onOpenAutoFocus={event => event.preventDefault()}
        >
          <FontList
            choices={choices}
            current={current}
            onPick={choice => {
              setOpen(false);
              onCommit(choice.value);
            }}
            onManageFonts={
              onManageFonts === undefined
                ? undefined
                : () => {
                    setOpen(false);
                    onManageFonts();
                  }
            }
          />
        </PopoverContent>
      </Popover>
      {unknown ? (
        <button
          type="button"
          className="nx-vars__link nx-font-pick__clear"
          aria-label="Clear Font"
          onClick={() => onCommit(null)}
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}

/**
 * The open list: an optional search, the three groups, and the link to
 * Design's fonts.
 *
 * Focus sits on the search when there is one and on the list when there is
 * not; either way the active entry is named by `aria-activedescendant`, so a
 * screen reader announces it as the arrow keys move.
 */
function FontList({
  choices,
  current,
  onPick,
  onManageFonts,
}: {
  choices: readonly FontChoice[];
  current: FontChoice | undefined;
  onPick: (choice: FontChoice) => void;
  onManageFonts: (() => void) | undefined;
}): React.JSX.Element {
  const listId = React.useId();
  const [query, setQuery] = React.useState("");
  const searchable = choices.length > SEARCH_FROM;
  const needle = query.trim().toLowerCase();
  const shown =
    needle === ""
      ? choices
      : choices.filter(choice => choice.label.toLowerCase().includes(needle));
  const [active, setActive] = React.useState(() =>
    Math.max(
      0,
      shown.findIndex(choice => choice.key === current?.key)
    )
  );
  const activeChoice = shown[Math.min(active, shown.length - 1)];
  const optionId = (choice: FontChoice): string =>
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

  return (
    <div className="nx-font-pick__body">
      {searchable ? (
        <div className="nx-vars__search nx-font-pick__search">
          <Search aria-hidden="true" size={16} />
          <Input
            ref={search}
            type="search"
            role="combobox"
            aria-label="Search fonts"
            aria-controls={listId}
            aria-expanded="true"
            aria-activedescendant={describedActive}
            placeholder="Search fonts"
            value={query}
            onChange={event => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
        </div>
      ) : null}
      <ul
        ref={list}
        id={listId}
        role="listbox"
        aria-label="Fonts"
        className="nx-font-pick__list"
        tabIndex={searchable ? -1 : 0}
        aria-activedescendant={searchable ? undefined : describedActive}
        onKeyDown={onKeyDown}
      >
        {shown.length === 0 ? (
          <li className="nx-vars__note nx-font-pick__none" role="presentation">
            No fonts match this search.
          </li>
        ) : null}
        {GROUPS.map(({ group, heading }) => {
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
                {members.map(choice => {
                  const isActive = choice === activeChoice;
                  return (
                    <li
                      key={choice.key}
                      id={optionId(choice)}
                      role="option"
                      aria-selected={isActive}
                      data-current={
                        choice.key === current?.key ? "" : undefined
                      }
                      className="nx-font-pick__option"
                      // Cut with an ellipsis when long: whole on hover.
                      title={choice.label}
                      style={
                        choice.drawn === undefined
                          ? undefined
                          : { fontFamily: choice.drawn }
                      }
                      onMouseMove={() => setActive(shown.indexOf(choice))}
                      onClick={() => onPick(choice)}
                    >
                      {choice.label}
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
      {onManageFonts === undefined ? null : (
        <div className="nx-font-pick__footer">
          <button
            type="button"
            className="nx-vars__link"
            onClick={onManageFonts}
          >
            Add or manage fonts…
          </button>
        </div>
      )}
    </div>
  );
}
