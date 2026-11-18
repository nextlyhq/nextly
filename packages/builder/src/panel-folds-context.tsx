"use client";

/**
 * The block panel's section folds, lent to the panel: the shell's, held with
 * its other preferences, or the panel's own where it is mounted alone, which
 * then forgets on reload.
 *
 * @module panel-folds-context
 */
import * as React from "react";

import {
  sectionOpens,
  withSectionFold,
  type SectionFolds,
} from "./panel-folds";
import {
  useSearchFolds,
  useSettingsMatch,
  type SearchFold,
} from "./settings-filter";
import type { SettingTab } from "./settings-index";

/** The folds and the way to change them. */
export interface PanelFolds {
  readonly folds: SectionFolds;
  readonly change: (next: (current: SectionFolds) => SectionFolds) => void;
}

/** The shell's folds, for a panel inside the shell. */
export const PanelFoldsContext: React.Context<PanelFolds | undefined> =
  React.createContext<PanelFolds | undefined>(undefined);

/** The folds lent from above, or none where nothing lends them. */
const NO_PANEL_FOLDS: PanelFolds = { folds: {}, change: () => {} };

/** The folds the panel folds by: the shell's, or its own. */
export function usePanelFolds(): PanelFolds {
  return React.useContext(PanelFoldsContext) ?? NO_PANEL_FOLDS;
}

/**
 * Lends folds to the panel inside it: the ones lent from above where there
 * are any (the shell's), else its own, held here at the panel's root so a
 * section list drawn again for another block or target keeps them.
 */
export function PanelFoldsProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const above = React.useContext(PanelFoldsContext);
  const [own, setOwn] = React.useState<SectionFolds>({});
  const change = React.useCallback(
    (next: (current: SectionFolds) => SectionFolds) => setOwn(next),
    []
  );
  const value = React.useMemo<PanelFolds>(
    () => above ?? { folds: own, change },
    [above, own, change]
  );
  return (
    <PanelFoldsContext.Provider value={value}>
      {children}
    </PanelFoldsContext.Provider>
  );
}

/**
 * Whether a section drawn above this list is the tab's first, as the Style
 * tab's Block style is above the editing bar: the list's own first section
 * then opens only when it holds a value, so the tab opens on one section.
 */
export const FirstSectionAbove: React.Context<boolean> =
  React.createContext(false);

/** One section of a tab, as its folding needs to know it. */
export interface FoldedSection {
  /** What the accordion knows the section by. */
  readonly key: string;
  /** What it is called, which its fold is remembered by. */
  readonly label: string;
  readonly holdsValue: boolean;
  /**
   * `false` for a section that stays folded until the author opens it even
   * while it holds a value, as Custom CSS does: its dot still shows, but its
   * value is no reason to open it.
   */
  readonly opensWithValue?: false;
}

/**
 * A tab's open sections, as an accordion of independent sections reads them,
 * and the change that records which the author opened or closed.
 */
export function useTabFolds(
  tab: string,
  sections: readonly FoldedSection[]
): {
  readonly open: string[];
  readonly onOpenChange: (open: string[]) => void;
} {
  const { folds, change } = usePanelFolds();
  const match = useSettingsMatch();
  const firstAbove = React.useContext(FirstSectionAbove);
  const searchFolds = useSearchFolds();
  if (match.active) return searchedFolds(tab, sections, match, searchFolds);
  const open = sections
    .filter((section, index) =>
      sectionOpens(folds, tab, section.label, {
        // A section that opts out opens only as the author leaves it; its
        // heading's dot reads `holdsValue` on its own.
        holdsValue: section.holdsValue && section.opensWithValue !== false,
        first: index === 0 && !firstAbove,
      })
    )
    .map(section => section.key);
  const onOpenChange = (next: string[]) => {
    const now = new Set(next);
    const before = new Set(open);
    change(current =>
      sections.reduce(
        (folded, section) =>
          now.has(section.key) === before.has(section.key)
            ? folded
            : withSectionFold(folded, tab, section.label, now.has(section.key)),
        current
      )
    );
  };
  return { open, onOpenChange };
}

/**
 * A list's folds while the panel is filtered. The sections holding a match
 * open on their own, and what the author opens or closes then is kept for
 * that search alone: the folds they left come back as they were once it is
 * cleared.
 *
 * One record per tab, which every list the tab draws shares (the Style tab
 * draws Block style above the editing bar and the rest under it): its
 * signature is the tab's matches, not one list's, and a list's change
 * replaces only its own sections in it, so folding one list leaves the
 * other's folds as they were.
 */
function searchedFolds(
  tab: string,
  sections: readonly FoldedSection[],
  match: ReturnType<typeof useSettingsMatch>,
  searchFolds: ReturnType<typeof useSearchFolds>
): {
  readonly open: string[];
  readonly onOpenChange: (open: string[]) => void;
} {
  const mine = new Set(sections.map(section => section.key));
  const tabMatches = [...(match.sections.get(tab as SettingTab) ?? [])].sort();
  // What a search's own folds belong to: the words and the toggle, and the
  // sections the tab keeps, so a new device, state, block or search starts
  // from its matches again.
  const searching = [
    match.query,
    String(match.onlyChanged),
    ...tabMatches,
  ].join("\u0000");
  const fold = searchFolds.folds[tab];
  const tabOpen = filteredOpen(fold, searching, tabMatches);
  return {
    open: tabOpen.filter(key => mine.has(key)),
    onOpenChange: next =>
      searchFolds.set(tab, {
        kind: "chosen",
        search: searching,
        open: [
          ...tabOpen.filter(key => !mine.has(key)),
          ...next.filter(key => mine.has(key)),
        ],
      }),
  };
}

/**
 * The open sections while filtered: all or none from the panel's menu, those
 * the author chose during this search, else the matches.
 */
function filteredOpen(
  fold: SearchFold | undefined,
  searching: string,
  matched: string[]
): string[] {
  if (fold?.kind === "all") return fold.open ? matched : [];
  if (fold?.kind === "chosen" && fold.search === searching) {
    return [...fold.open];
  }
  return matched;
}
