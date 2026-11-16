/**
 * The Content panel: collections under a Collections heading, then Singles
 * under a Singles heading, in one list under one search.
 *
 * Each heading shows how many items it lists for the search, and folds; the
 * folds are remembered for the person (`lib/content-folds`). A kind the
 * reader may not read has no heading at all, so a reader of Singles alone
 * sees Singles alone. Collections that name an `admin.sidebarGroup` are listed
 * under a sub-heading of that group (`ContentCollections`).
 */
import type { JSX } from "react";

import { DynamicSingleNav } from "@admin/components/features/dashboard/DynamicSingleNav";
import {
  PluginMenuItems,
  usePluginMatchCounts,
} from "@admin/components/features/dashboard/PluginMenuItems";
import {
  useSidebarCollectionList,
  useSidebarSingleList,
} from "@admin/hooks/useSidebarContentLists";
import {
  searchSidebarCollections,
  searchSidebarSingles,
} from "@admin/lib/sidebar-landing";
import { cn } from "@admin/lib/utils";

import { ContentCollections } from "./ContentCollections";
import { ContentFold } from "./ContentFold";
import { useContentFolds } from "./lib/content-folds";
import { contentPanelView } from "./lib/content-rail";
import { SidebarSearch } from "./SidebarSearch";

import { SidebarMenu } from "./index";

interface ContentPanelProps {
  search: string;
  onSearchChange: (value: string) => void;
  /** Whether the reader has collections to list. */
  hasCollections: boolean;
  /** Whether the reader has Singles to list. */
  hasSingles: boolean;
  isActive: (href?: string, exact?: boolean) => boolean;
}

export function ContentPanel({
  search,
  onSearchChange,
  hasCollections,
  hasSingles,
  isActive,
}: ContentPanelProps): JSX.Element {
  const collections = useSidebarCollectionList();
  // Singles are listed beside collections, so their pages are walked
  // whenever the reader may read any.
  const singles = useSidebarSingleList({ enabled: hasSingles });
  const folds = useContentFolds();

  // Counts come from the same search the lists draw with, so a heading's
  // count can never disagree with what it lists.
  const matchedCollections = searchSidebarCollections(
    collections.items,
    search
  );
  const pluginMatches = usePluginMatchCounts(search);
  const pluginTotals = usePluginMatchCounts("");
  const matches = {
    collections: matchedCollections.length + pluginMatches.collections,
    singles:
      searchSidebarSingles(singles.items, search).length +
      pluginMatches.singles,
  };
  const { shows, nothingMatches } = contentPanelView({
    search,
    available: { collections: hasCollections, singles: hasSingles },
    totals: {
      collections: collections.items.length + pluginTotals.collections,
      singles: singles.items.length + pluginTotals.singles,
    },
    matches,
    // Complete, not merely loaded: a search may say nothing matched only
    // once every page has arrived.
    complete: {
      collections: collections.isComplete,
      singles: singles.isComplete,
    },
  });

  return (
    <div className="space-y-4 px-4 py-6">
      <SidebarSearch
        placeholder="Search content"
        label="Search content"
        value={search}
        onChange={onSearchChange}
      />

      <nav aria-label="Content" className="space-y-4">
        {shows.collections ? (
          <ContentFold
            foldKey="collections"
            label="Collections"
            // Drawn once every page has arrived, as the empty-search line
            // waits: a count of a list still arriving would change under the
            // reader.
            count={collections.isComplete ? matches.collections : null}
            level="heading"
            folds={folds}
          >
            <ContentCollections
              matched={matchedCollections}
              pluginMatches={pluginMatches.collections}
              loading={collections.isLoading}
              search={search}
              isActive={isActive}
              folds={folds}
            />
          </ContentFold>
        ) : null}
        {shows.singles ? (
          <ContentFold
            foldKey="singles"
            label="Singles"
            count={singles.isComplete ? matches.singles : null}
            level="heading"
            folds={folds}
          >
            <SidebarMenu>
              <DynamicSingleNav isActive={isActive} search={search} />
              {/* The plugin menu items placed in Singles, as the narrow
                  sidebar lists them under Singles. */}
              <PluginMenuItems
                isActive={isActive}
                section="singles"
                search={search}
              />
            </SidebarMenu>
          </ContentFold>
        ) : null}
      </nav>

      {/* Always in the document, so the line is announced as it appears. */}
      <p
        role="status"
        className={cn(
          "px-3 text-sm text-muted-foreground",
          !nothingMatches && "sr-only"
        )}
      >
        {nothingMatches ? `Nothing matches “${search}”.` : null}
      </p>
    </div>
  );
}
