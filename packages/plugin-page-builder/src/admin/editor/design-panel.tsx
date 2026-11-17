"use client";

/**
 * The Design panel: the site's look, as four tabs by kind under one header —
 * Colours, Type, Spacing and Styles — with one search across them and groups
 * that fold and stay folded for the author.
 *
 * One place for the site's look rather than three rail items: an author
 * setting up a page's style moves between them, and three panels made each
 * move a trip back to the rail that also closed what they were looking at.
 *
 * Which tab shows is the shell's to keep, with its other preferences, so the
 * tab an author left is the one they come back to — and a request from
 * elsewhere (the fonts tab sending an author to fix a variable) can name the
 * tab along with the panel.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/design-panel
 */
import type { PanelView, PreferenceStore } from "@nextlyhq/builder";
import {
  EDITOR_WORDS,
  FontChoicesContext,
  GroupToggle,
  stylesTabMatches,
  type DesignTab,
  type FontChoices,
  type GroupFolds,
} from "@nextlyhq/builder/shell";
import { Input, Tabs, TabsContent, TabsList, TabsTrigger } from "@nextlyhq/ui";
import { Search } from "lucide-react";
import * as React from "react";

import {
  RemountOnStyleReplay,
  StyleRevisionContext,
} from "./site-style-history";

/**
 * The panel's tabs, by kind, in the order the panel shows them, named with
 * the editor's words.
 */
const DESIGN_VIEWS: ReadonlyArray<{
  readonly value: DesignTab;
  readonly label: string;
}> = [
  { value: "colours", label: EDITOR_WORDS.colours },
  { value: "type", label: EDITOR_WORDS.type },
  { value: "spacing", label: EDITOR_WORDS.spacing },
  { value: "styles", label: EDITOR_WORDS.styles },
];

export type DesignView = DesignTab;

/**
 * The tab to show for a stored view. Anything this panel does not name, as
 * none chosen yet or a name an earlier panel stored, opens on the first tab,
 * Colours, as a fresh profile does.
 */
export function designViewOf(view: string | null): DesignView {
  return DESIGN_VIEWS.find(entry => entry.value === view)?.value ?? "colours";
}

/** How many matches a search found in each tab, for the tabs that report. */
type DesignMatches = Partial<Record<DesignView, number>>;

/**
 * What the open tab and the frame read of the panel: the search, which is
 * one across every tab, the folded groups, and where a part that lists
 * things reports how many of them the search matches in each tab.
 */
interface DesignBrowse {
  readonly search: string;
  readonly setSearch: (search: string) => void;
  /** The search field, where focus goes once a listed thing is removed. */
  readonly searchRef: React.RefObject<HTMLInputElement | null>;
  /** Opens a group the author folded and brings it into view, focused. */
  readonly reveal: (group: string) => void;
  readonly folds: GroupFolds | undefined;
  readonly reportMatches: (matches: DesignMatches) => void;
}

const DesignBrowseContext = React.createContext<DesignBrowse>({
  search: "",
  setSearch: () => undefined,
  searchRef: { current: null },
  reveal: () => undefined,
  folds: undefined,
  reportMatches: () => undefined,
});

/** The panel's search and folds, for a tab or the frame inside it. */
export function useDesignBrowse(): DesignBrowse {
  return React.useContext(DesignBrowseContext);
}

/**
 * The folded groups, read from and written to the author's own store, so a
 * group stays folded across reloads. Without a store every group is open,
 * and folding lasts only as long as the panel.
 */
function useFolds(store: PreferenceStore | undefined): GroupFolds {
  const [kept, setKept] = React.useState(() => ({
    store,
    folded: foldsRead(store),
  }));
  // A store arriving after the panel mounted, as once the author is known,
  // is read then, so a toggle builds on the folds it holds rather than
  // writing over them.
  if (kept.store !== store) {
    setKept({ store, folded: foldsRead(store) });
  }
  const folded = kept.store === store ? kept.folded : foldsRead(store);
  const onFold = React.useCallback(
    (group: string, fold: boolean) => {
      setKept(current => {
        const next = new Set(current.folded);
        if (fold) next.add(group);
        else next.delete(group);
        store?.write(JSON.stringify([...next]));
        return { store, folded: next };
      });
    },
    [store]
  );
  return React.useMemo(() => ({ folded, onFold }), [folded, onFold]);
}

/**
 * Opens a group of the open tab and brings it into view with focus on its
 * heading, as a part sending the author to it asks: once drawn, since a
 * folded group's rows are not.
 */
function useReveal(
  root: React.RefObject<HTMLElement | null>,
  folds: GroupFolds
): (group: string) => void {
  return React.useCallback(
    (group: string) => {
      if (folds.folded.has(group)) folds.onFold(group, false);
      window.setTimeout(() => {
        const section = [
          ...(root.current?.querySelectorAll<HTMLElement>("[data-group]") ??
            []),
        ].find(element => element.dataset.group === group);
        section?.scrollIntoView({ block: "nearest" });
        section?.querySelector<HTMLElement>("button")?.focus();
      }, 0);
    },
    [root, folds]
  );
}

/**
 * The panel's way to bring a group into view, for a part drawn inside a tab
 * that sends the author to it, such as the fonts' "Edit this variable".
 */
export function DesignReveal({
  children,
}: {
  children: (reveal: (group: string) => void) => React.ReactNode;
}): React.JSX.Element {
  return <>{children(useDesignBrowse().reveal)}</>;
}

/** The stored folds, or none: a store that holds nothing or no list of names. */
function foldsRead(store: PreferenceStore | undefined): ReadonlySet<string> {
  const text = store?.read() ?? null;
  if (text === null) return new Set();
  try {
    const parsed: unknown = JSON.parse(text);
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((entry): entry is string => typeof entry === "string")
        : []
    );
  } catch {
    return new Set();
  }
}

/**
 * Where controls go in the panel's header, beside the title: the preview
 * switch and the import-and-export menu, drawn there by the panel's frame so
 * they stay whichever tab is open. `null` until the header has mounted.
 */
const DesignHeaderSlot = React.createContext<HTMLElement | null>(null);

/** The header element the open tab can draw its own controls into. */
export function useDesignHeaderSlot(): HTMLElement | null {
  return React.useContext(DesignHeaderSlot);
}

/** The tabs as they are, for a panel with nothing around them. */
function noFrame(tabs: React.ReactNode): React.ReactNode {
  return tabs;
}

export function DesignPanel({
  view,
  tabs,
  frame = noFrame,
  foldStore,
}: {
  view: PanelView;
  /** What fills each tab. Only the open tab's content is mounted. */
  tabs: Record<DesignView, () => React.ReactNode>;
  /** Where the author's folded groups are kept. Absent: they are not kept. */
  foldStore?: PreferenceStore;
  /**
   * What surrounds every tab, mounted for as long as the panel is: the place
   * for state the header and the tabs share, so changing tab neither drops
   * the header's controls nor resets them.
   */
  frame?: (tabs: React.ReactNode) => React.ReactNode;
}): React.JSX.Element {
  const current = designViewOf(view.current);
  // Read here because the header's controls are drawn into the slot from
  // inside the frame, outside the element the replay holds inert.
  const { settling } = React.useContext(StyleRevisionContext);
  // State rather than a ref, so a tab reading the slot renders again once the
  // header element exists.
  const [slot, setSlot] = React.useState<HTMLElement | null>(null);
  // Drawn once per tab and per set of tabs: the header's own update above
  // re-renders this panel, and that is no reason to rebuild the open tab.
  const open = React.useMemo(() => tabs[current](), [tabs, current]);
  const [search, setSearch] = React.useState("");
  const searchRef = React.useRef<HTMLInputElement>(null);
  const root = React.useRef<HTMLElement>(null);
  const [matches, setMatches] = React.useState<DesignMatches>({});
  const folds = useFolds(foldStore);
  // Parts report the counts they list; only the counts that changed land.
  const reportMatches = React.useCallback((reported: DesignMatches) => {
    setMatches(current =>
      Object.entries(reported).every(
        ([tab, count]) => current[tab as DesignView] === count
      )
        ? current
        : { ...current, ...reported }
    );
  }, []);
  const reveal = useReveal(root, folds);
  const browse = React.useMemo(
    () => ({ search, setSearch, searchRef, reveal, folds, reportMatches }),
    [search, reveal, folds, reportMatches]
  );
  const searching = search.trim() !== "";
  return (
    <section
      ref={root}
      className="nx-pb-design"
      aria-label={`${EDITOR_WORDS.design} panel`}
    >
      <Tabs
        value={current}
        onValueChange={view.choose}
        className="nx-pb-design__tabs-root"
      >
        <div className="nx-pb-design__head">
          <div className="nx-pb-design__title-row">
            <h2 className="nx-pb-design__title">{EDITOR_WORDS.design}</h2>
            <div
              className="nx-pb-design__actions"
              ref={setSlot}
              inert={settling}
            />
          </div>
          <TabsList
            aria-label={EDITOR_WORDS.design}
            className="nx-pb-design__tabs"
          >
            {DESIGN_VIEWS.map(entry => (
              <TabsTrigger
                key={entry.value}
                value={entry.value}
                className="nx-pb-design__tab"
              >
                {entry.label}
                <TabMatches shown={searching} count={matches[entry.value]} />
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="nx-pb-design__search">
            <Search aria-hidden="true" size={16} />
            <Input
              ref={searchRef}
              type="search"
              aria-label={`Search ${EDITOR_WORDS.design}`}
              placeholder="Search"
              value={search}
              onChange={event => setSearch(event.target.value)}
            />
          </div>
        </div>
        <DesignBrowseContext.Provider value={browse}>
          <DesignHeaderSlot.Provider value={slot}>
            {/* A style change undone or redone is written behind the frame's
              and the open tab's back, so both are mounted afresh to read it. */}
            <RemountOnStyleReplay>
              {frame(
                DESIGN_VIEWS.map(entry => (
                  <TabsContent
                    key={entry.value}
                    value={entry.value}
                    className="nx-pb-design__body"
                  >
                    {entry.value === current ? open : null}
                  </TabsContent>
                ))
              )}
            </RemountOnStyleReplay>
          </DesignHeaderSlot.Provider>
        </DesignBrowseContext.Provider>
      </Tabs>
    </section>
  );
}

/**
 * How many matches a tab holds while a search is on, beside its name; said
 * with the name, as "Colours, 3 matches". Nothing while no search is on, or
 * for a tab that has not reported.
 */
function TabMatches({
  shown,
  count,
}: {
  shown: boolean;
  count: number | undefined;
}): React.JSX.Element | null {
  if (!shown || count === undefined) return null;
  return (
    <span className="nx-pb-design__tab-count">
      <span className="sr-only">, </span>
      {count}
      <span className="sr-only">{count === 1 ? " match" : " matches"}</span>
    </span>
  );
}

/**
 * A group of a Design tab that another panel fills, such as the site's fonts
 * under Type: its heading folds it and shows how many it holds, as the
 * variable groups' do, and it stays folded for the author. A part with no
 * search of its own steps aside while the panel's search is on, since none
 * of it can be said to match.
 */
export function DesignGroup({
  id,
  heading,
  count,
  children,
}: {
  /** The group's name in the author's folds. */
  id: string;
  heading: string;
  /** How many it holds, or absent while that is not known yet. */
  count: number | undefined;
  children: React.ReactNode;
}): React.JSX.Element | null {
  const { search, folds } = useDesignBrowse();
  const headingId = React.useId();
  if (search.trim() !== "") return null;
  const folded = folds?.folded.has(id) === true;
  return (
    <section
      className="nx-vars__group nx-pb-design__group"
      aria-labelledby={headingId}
      data-folded={folded ? "" : undefined}
    >
      <div className="nx-vars__group-head">
        <h3 className="nx-vars__group-name" id={headingId}>
          <GroupToggle
            heading={heading}
            count={count ?? 0}
            open={!folded}
            onToggle={
              folds === undefined ? undefined : () => folds.onFold(id, !folded)
            }
          />
        </h3>
      </div>
      {folded ? null : children}
    </section>
  );
}

/** The Type tab's group of the site's fonts, which "Manage fonts…" opens. */
export const SITE_FONTS_GROUP = "site-fonts";

/**
 * The site's fonts for Design's Font and Weight controls, given as the block
 * panel is given them: the faces the canvas loads, those the site's code
 * supplies, and the way to the site's fonts. In Design that way is its Type
 * tab with the site's Fonts group opened and brought into view, since an
 * author may already be on the tab, with the group folded or scrolled away.
 */
export function DesignFonts({
  faces,
  fromCode,
  onManageFonts,
  children,
}: FontChoices & { children: React.ReactNode }): React.JSX.Element {
  const { reveal } = useDesignBrowse();
  const fonts = React.useMemo<FontChoices>(
    () => ({
      faces,
      fromCode,
      onManageFonts: () => {
        onManageFonts?.();
        reveal(SITE_FONTS_GROUP);
      },
    }),
    [faces, fromCode, onManageFonts, reveal]
  );
  return (
    <FontChoicesContext.Provider value={fonts}>
      {children}
    </FontChoicesContext.Provider>
  );
}

/**
 * Reports how many of the Styles tab's styles the panel's search matches,
 * for the count beside the tab's name whichever tab is open: drawn in the
 * panel's frame, which every tab shares, from what the Styles tab lists.
 */
export function ReportStylesMatches({
  library,
  suppliedClassIds,
  styleContext,
}: {
  library: Parameters<typeof stylesTabMatches>[0];
  suppliedClassIds: Parameters<typeof stylesTabMatches>[1];
  styleContext: Parameters<typeof stylesTabMatches>[3];
}): null {
  const { search, reportMatches } = useDesignBrowse();
  const count = React.useMemo(
    () => stylesTabMatches(library, suppliedClassIds, search, styleContext),
    [library, suppliedClassIds, search, styleContext]
  );
  React.useEffect(() => {
    reportMatches({ styles: count });
  }, [count, reportMatches]);
  return null;
}
