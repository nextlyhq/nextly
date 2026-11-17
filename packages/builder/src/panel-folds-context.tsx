"use client";

/**
 * The block panel's section folds, lent to the panel: the shell's, held with
 * its other preferences, or the panel's own where it is mounted alone, which
 * then forgets on reload.
 *
 * @module panel-folds-context
 */
import * as React from "react";

import { sectionShown, useSettingsMatch } from "./settings-filter";
import {
  sectionOpens,
  withSectionFold,
  type SectionFolds,
} from "./panel-folds";

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

/** One section of a tab, as its folding needs to know it. */
export interface FoldedSection {
  /** What the accordion knows the section by. */
  readonly key: string;
  /** What it is called, which its fold is remembered by. */
  readonly label: string;
  readonly holdsValue: boolean;
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
  // While the panel is filtered, the sections holding a match open on their
  // own, and what the author opens or closes then is kept for that search
  // alone: the folds they left come back as they were once it is cleared.
  const matchedKeys = sections
    .filter(section => sectionShown(match, tab, section.key))
    .map(section => section.key);
  // What a search's own folds belong to: the words and the toggle, and the
  // sections they keep, so a new device, state, block or search starts from
  // its matches again.
  const searching = [
    match.query,
    String(match.onlyChanged),
    ...matchedKeys,
  ].join("\u0000");
  const [during, setDuring] = React.useState<{
    readonly search: string;
    readonly open: string[];
  } | null>(null);
  // Dropped once the filter is off, so the same search typed again opens
  // its matches afresh.
  React.useEffect(() => {
    if (!match.active && during !== null) setDuring(null);
  }, [match.active, during]);
  if (match.active) {
    return {
      open: during?.search === searching ? during.open : matchedKeys,
      onOpenChange: next => setDuring({ search: searching, open: next }),
    };
  }
  const open = sections
    .filter((section, index) =>
      sectionOpens(folds, tab, section.label, {
        holdsValue: section.holdsValue,
        first: index === 0,
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
