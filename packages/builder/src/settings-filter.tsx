"use client";

/**
 * "Find a setting" and "Only changed" at the top of the block panel: the
 * search and filter state, the row they are typed in, and what every tab asks
 * of them to draw only the settings that match.
 *
 * The query and the toggle are panel state, kept while the author selects one
 * block after another, until cleared. What they keep is read from the
 * settings index (`settings-index`) once per selection; each tab then hides
 * the rows and sections with no match, and opens the ones with one, without
 * touching the folds the author left.
 *
 * @module settings-filter
 */
import { Search, X } from "lucide-react";
import * as React from "react";

import { isElement } from "./dom-kind";
import type { ParentArrangement } from "./plain-layout";
import {
  filterEntries,
  filtering,
  resultsAnnouncement,
  SETTING_TABS,
  tabCounts,
  TAB_WORDS,
  type SettingEntry,
  type SettingsFilter,
  type SettingTab,
} from "./settings-index";
import type { StyleSection } from "./style-inspector";

/** The search and the toggle, and their setters. */
interface FilterState extends SettingsFilter {
  readonly setQuery: (query: string) => void;
  readonly setOnlyChanged: (on: boolean) => void;
}

const NO_FILTER: FilterState = {
  query: "",
  onlyChanged: false,
  setQuery: () => {},
  setOnlyChanged: () => {},
};

const FilterStateContext = React.createContext<FilterState>(NO_FILTER);

/**
 * Holds the search and the toggle for the panel, above the selection, so both
 * stay while the author selects other blocks.
 */
export function SettingsFilterProvider({
  children,
  initial,
}: {
  children: React.ReactNode;
  /** What the panel opens filtered by; nothing unless said. */
  initial?: Partial<SettingsFilter>;
}): React.JSX.Element {
  const [query, setQuery] = React.useState(initial?.query ?? "");
  const [onlyChanged, setOnlyChanged] = React.useState(
    initial?.onlyChanged ?? false
  );
  const value = React.useMemo(
    () => ({ query, onlyChanged, setQuery, setOnlyChanged }),
    [query, onlyChanged]
  );
  return (
    <FilterStateContext.Provider value={value}>
      <SearchFoldsProvider active={filtering(value)}>
        {children}
      </SearchFoldsProvider>
    </FilterStateContext.Provider>
  );
}

/** The panel's search and toggle. */
export function useFilterState(): FilterState {
  return React.useContext(FilterStateContext);
}

/** What the filter keeps for the selected block. */
export interface SettingsMatch {
  /** Whether anything is filtered: a query typed, or Only changed on. */
  readonly active: boolean;
  /** The query, as typed, so a tab's opened sections follow it. */
  readonly query: string;
  readonly onlyChanged: boolean;
  /** Each tab's kept settings, by id. */
  readonly kept: ReadonlyMap<SettingTab, ReadonlySet<string>>;
  /** Each tab's sections holding a kept setting, by key. */
  readonly sections: ReadonlyMap<SettingTab, ReadonlySet<string>>;
  readonly counts: Readonly<Record<SettingTab, number>>;
}

const NO_MATCH: SettingsMatch = {
  active: false,
  query: "",
  onlyChanged: false,
  kept: new Map(),
  sections: new Map(),
  counts: { content: 0, style: 0, advanced: 0 },
};

const MatchContext = React.createContext<SettingsMatch>(NO_MATCH);

/** What the filter keeps of a block's settings. */
export function settingsMatch(
  entries: readonly SettingEntry[],
  filter: SettingsFilter
): SettingsMatch {
  if (!filtering(filter)) return NO_MATCH;
  const kept = filterEntries(entries, filter);
  const byTab = (key: (entry: SettingEntry) => string) =>
    new Map(
      SETTING_TABS.map(tab => [
        tab,
        new Set(kept.filter(entry => entry.tab === tab).map(key)),
      ])
    );
  return {
    active: true,
    query: filter.query,
    onlyChanged: filter.onlyChanged,
    kept: byTab(entry => entry.id),
    sections: byTab(entry => entry.section),
    counts: tabCounts(kept),
  };
}

/** Lends a block's match to every tab. */
export const SettingsMatchProvider: React.Provider<SettingsMatch> =
  MatchContext.Provider;

/** The selected block's match. */
export function useSettingsMatch(): SettingsMatch {
  return React.useContext(MatchContext);
}

/** The tab a row is drawn in, for rows drawn the same way on two tabs. */
export const SettingTabContext: React.Context<SettingTab | undefined> =
  React.createContext<SettingTab | undefined>(undefined);

/** Whether any of a row's settings is kept on its tab. */
function useSettingShown(ids: readonly string[], tab?: SettingTab): boolean {
  const match = useSettingsMatch();
  const drawnOn = React.useContext(SettingTabContext);
  const on = tab ?? drawnOn;
  if (!match.active || on === undefined) return true;
  const kept = match.kept.get(on);
  return ids.some(id => kept?.has(id) === true);
}

/** Whether a section holds a kept setting. */
export function sectionShown(
  match: SettingsMatch,
  tab: string,
  key: string
): boolean {
  if (!match.active) return true;
  return match.sections.get(tab as SettingTab)?.has(key) === true;
}

/**
 * A row the filter may hide. Hidden rather than taken away, so a field's
 * unsaved text and its focus outlive a search typed and cleared. Marked with
 * its settings' ids, so a setting asked for from outside the panel (a page
 * check's fix) finds the row it is drawn in.
 */
export function SettingSlot({
  ids,
  tab,
  children,
}: {
  ids: readonly string[];
  tab?: SettingTab;
  children: React.ReactNode;
}): React.JSX.Element {
  const shown = useSettingShown(ids, tab);
  return (
    <div className="nx-setting" data-setting={ids.join(" ")} hidden={!shown}>
      {children}
    </div>
  );
}

/** Whether a key press is typed into a field rather than sent to the panel. */
function typedIntoField(target: EventTarget | null): boolean {
  if (!isElement(target)) return false;
  if (
    target.closest('[contenteditable="true"], [contenteditable=""]') !== null
  ) {
    return true;
  }
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * The panel's "/" shortcut: from anywhere in the panel outside a text field,
 * to "Find a setting".
 */
export function useFindShortcut(): {
  readonly field: React.RefObject<HTMLInputElement | null>;
  readonly onKeyDown: (event: React.KeyboardEvent) => void;
} {
  const field = React.useRef<HTMLInputElement | null>(null);
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "/" || event.defaultPrevented) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (typedIntoField(event.target)) return;
    event.preventDefault();
    field.current?.focus();
  };
  return { field, onKeyDown };
}

/** How long typing pauses before the result is announced. */
const ANNOUNCE_AFTER_MS = 600;

/** The announcement, once the author stops typing. */
function useAnnouncement(match: SettingsMatch): string {
  const [said, setSaid] = React.useState("");
  const text = match.active ? resultsAnnouncement(match.counts) : "";
  React.useEffect(() => {
    const timer = window.setTimeout(() => setSaid(text), ANNOUNCE_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [text]);
  return said;
}

/**
 * The search row: "Find a setting", its clear button, and "Only changed".
 * Under the tabs, on every tab.
 */
export function SettingsSearchRow({
  field,
}: {
  field: React.RefObject<HTMLInputElement | null>;
}): React.JSX.Element {
  const { query, onlyChanged, setQuery, setOnlyChanged } = useFilterState();
  const match = useSettingsMatch();
  const announcement = useAnnouncement(match);
  return (
    <div className="nx-settings-search" role="search">
      <div className="nx-settings-search__field">
        <Search
          size={14}
          aria-hidden="true"
          className="nx-settings-search__icon"
        />
        <input
          ref={field}
          type="search"
          className="nx-settings-search__input"
          aria-label="Find a setting"
          placeholder="Find a setting"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => {
            if (event.key !== "Escape" || query === "") return;
            // Cleared here, and kept from the canvas, which would take
            // Escape as leaving the block.
            event.preventDefault();
            event.stopPropagation();
            setQuery("");
          }}
        />
        {query === "" ? null : (
          <button
            type="button"
            className="nx-settings-search__clear"
            aria-label="Clear search"
            onClick={() => {
              setQuery("");
              field.current?.focus();
            }}
          >
            <X size={14} aria-hidden="true" />
          </button>
        )}
      </div>
      <button
        type="button"
        className="nx-settings-search__toggle"
        aria-pressed={onlyChanged}
        onClick={() => setOnlyChanged(!onlyChanged)}
      >
        Only changed
      </button>
      {/* Polite, and a live region of its own rather than a status: the
          panel's other status lines say what one control is doing. */}
      <p className="nx-sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
    </div>
  );
}

/**
 * What a tab says while the filter keeps nothing on it: where the matches
 * are, with a link to each tab holding some, or that nothing matches.
 */
export function FilterNote({
  tab,
  onChoose,
}: {
  tab: SettingTab;
  onChoose: (tab: SettingTab) => void;
}): React.JSX.Element | null {
  const match = useSettingsMatch();
  if (!match.active || match.counts[tab] > 0) return null;
  const elsewhere = SETTING_TABS.filter(
    each => each !== tab && match.counts[each] > 0
  );
  const searching = match.query.trim() !== "";
  if (elsewhere.length === 0) {
    return (
      <p className="nx-settings-note">
        {searching
          ? "No setting matches. Try another word."
          : "Nothing changed on this block yet."}
      </p>
    );
  }
  return (
    <p className="nx-settings-note">
      {searching ? "No setting matches here." : "Nothing changed here."}{" "}
      {elsewhere.map((each, index) => (
        <React.Fragment key={each}>
          {index === 0 ? null : " · "}
          <button
            type="button"
            className="nx-settings-note__link"
            onClick={() => onChoose(each)}
          >
            {`${String(match.counts[each])} in ${TAB_WORDS[each]}`}
          </button>
        </React.Fragment>
      ))}
    </p>
  );
}

/** A tab's match count, drawn on its label while the filter is on. */
export function TabCount({
  tab,
}: {
  tab: SettingTab;
}): React.JSX.Element | null {
  const match = useSettingsMatch();
  if (!match.active) return null;
  const count = match.counts[tab];
  return (
    <span className="nx-inspector__tab-count">
      <span aria-hidden="true">{count}</span>
      <span className="nx-sr-only">
        {`, ${String(count)} ${count === 1 ? "match" : "matches"}`}
      </span>
    </span>
  );
}

/** A device or state the edited target holds values at, with how many. */
interface ElsewhereLink {
  readonly id: string;
  readonly label: string;
  readonly count: number;
}

/**
 * "Also changed on Tablet (2) · Hover (1)": while Only changed is on in
 * Style, where else the edited target holds values, each a link that shows
 * that device or state.
 */
export function ChangedElsewhere({
  devices,
  states,
  onDevice,
  onState,
}: {
  devices: readonly ElsewhereLink[];
  states: readonly ElsewhereLink[];
  onDevice: ((id: string) => void) | undefined;
  onState: ((id: string) => void) | undefined;
}): React.JSX.Element | null {
  const { onlyChanged } = useFilterState();
  if (!onlyChanged || devices.length + states.length === 0) return null;
  const link = (
    each: ElsewhereLink,
    go: ((id: string) => void) | undefined
  ) => {
    const words = `${each.label} (${String(each.count)})`;
    return go === undefined ? (
      <span key={each.id}>{words}</span>
    ) : (
      <button
        key={each.id}
        type="button"
        className="nx-settings-note__link"
        onClick={() => go(each.id)}
      >
        {words}
      </button>
    );
  };
  const links = [
    ...devices.map(each => link(each, onDevice)),
    ...states.map(each => link(each, onState)),
  ];
  return (
    <p className="nx-settings-note">
      Also changed on{" "}
      {links.map((each, index) => (
        <React.Fragment key={index}>
          {index === 0 ? null : " · "}
          {each}
        </React.Fragment>
      ))}
    </p>
  );
}

/** The Style tab's sections, as it draws them for the target it edits. */
export interface ReportedStyle {
  readonly nodeId: string;
  readonly sections: readonly StyleSection[];
  /** Whether a shared style is the target, which draws no block shortcuts. */
  readonly shared: boolean;
  /**
   * The target's own styles at every state and device: a shared style's
   * while one is edited, the block's otherwise. What "Also changed on" reads.
   */
  readonly styles: unknown;
  /** How the block's parent arranges it, which "Inside its parent" offers by. */
  readonly parent?: ParentArrangement | undefined;
  /**
   * Whether Arrange reads the Layout in plain words (not Custom), so its
   * Space between draws the space properties rather than CSS properties.
   */
  readonly arranges?: boolean | undefined;
}

/**
 * Where the Style tab says what it draws: the sections of the target it is
 * editing, a shared style's while one is chosen, so the filter keeps what
 * the controls show rather than what the block alone holds.
 */
export const StyleReportContext: React.Context<
  ((reported: ReportedStyle | undefined) => void) | undefined
> = React.createContext<
  ((reported: ReportedStyle | undefined) => void) | undefined
>(undefined);

/** What a section set says to the filter: each property, and whether set. */
function sectionsSignature(sections: readonly StyleSection[]): string {
  return sections
    .map(
      section =>
        `${section.key}:${section.properties
          .map(property => `${property.property}${property.set ? "+" : "-"}`)
          .join(",")}`
    )
    .join("|");
}

/**
 * Tells the panel what the Style tab draws, each time that changes, and that
 * it no longer draws anything once it closes.
 */
export function useReportStyle(
  nodeId: string | undefined,
  sections: readonly StyleSection[] | undefined,
  shared = false,
  styles: unknown = undefined,
  parent: ParentArrangement | undefined = undefined,
  arranges: boolean | undefined = undefined
): void {
  const report = React.useContext(StyleReportContext);
  // Told only while the panel is filtered: unfiltered, nothing reads it, and
  // a report would draw the panel a second time for every selection.
  const on = filtering(useFilterState());
  const latest = React.useRef({ sections, styles });
  latest.current = { sections, styles };
  // The target's other states and devices count too: a value there changes
  // "Also changed on" though no section shown here changes.
  const signature =
    sections === undefined || !on
      ? ""
      : `${sectionsSignature(sections)}\u0000${JSON.stringify(styles ?? null)}`;
  React.useEffect(() => {
    if (report === undefined || nodeId === undefined) return;
    const now = latest.current;
    report(
      on && now.sections !== undefined
        ? {
            nodeId,
            sections: now.sections,
            shared,
            styles: now.styles,
            parent,
            arranges,
          }
        : undefined
    );
  }, [report, nodeId, signature, on, shared, parent, arranges]);
  React.useEffect(() => () => report?.(undefined), [report]);
}

/**
 * What a tab's sections are while the panel is filtered, apart from the folds
 * the author left: those opened or closed during this search, or all opened
 * or all closed from the panel's menu. None at first: the matches open.
 */
export type SearchFold =
  | {
      readonly kind: "chosen";
      readonly search: string;
      readonly open: readonly string[];
    }
  | { readonly kind: "all"; readonly open: boolean };

/** Each tab's folds while filtered, and how to change one. */
interface SearchFolds {
  readonly folds: Readonly<Record<string, SearchFold | undefined>>;
  readonly set: (tab: string, fold: SearchFold) => void;
}

const NO_SEARCH_FOLDS: SearchFolds = { folds: {}, set: () => {} };

const SearchFoldsContext = React.createContext<SearchFolds>(NO_SEARCH_FOLDS);

/**
 * Holds the filtered folds under the filter, so the panel's menu folds what
 * the filter shows, and drops them once the filter is off: the same search
 * typed again opens its matches afresh, and the author's folds are untouched.
 */
function SearchFoldsProvider({
  active,
  children,
}: {
  active: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  const [folds, setFolds] = React.useState<
    Readonly<Record<string, SearchFold | undefined>>
  >({});
  React.useEffect(() => {
    if (!active)
      setFolds(current => (Object.keys(current).length === 0 ? current : {}));
  }, [active]);
  const value = React.useMemo<SearchFolds>(
    () => ({
      folds,
      set: (tab, fold) => setFolds(current => ({ ...current, [tab]: fold })),
    }),
    [folds]
  );
  return (
    <SearchFoldsContext.Provider value={value}>
      {children}
    </SearchFoldsContext.Provider>
  );
}

/** The panel's filtered folds. */
export function useSearchFolds(): SearchFolds {
  return React.useContext(SearchFoldsContext);
}
