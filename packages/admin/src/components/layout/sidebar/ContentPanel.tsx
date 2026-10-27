/**
 * The Content panel: Collections or Singles, switched with a segmented control,
 * under one search.
 *
 * The two parts are links, not tabs: each one is a URL (`/admin/collections`,
 * `/admin/singles`), and a `role="tab"` on a link breaks the tabs pattern's
 * keyboard and announcement contract. So they sit in a labelled `nav`, the
 * current one marked with `aria-current`.
 *
 * The search carries over between the parts. A dot on the other part says it
 * has matches too, and an empty part offers the other's matches, so a reader
 * who doesn't remember whether "Footer" is a collection or a Single still
 * finds it from either side.
 */
import type { JSX } from "react";

import { DynamicCollectionNav } from "@admin/components/features/dashboard/DynamicCollectionNav";
import { DynamicSingleNav } from "@admin/components/features/dashboard/DynamicSingleNav";
import { Link } from "@admin/components/ui/link";
import {
  useSidebarCollectionList,
  useSidebarSingleList,
} from "@admin/hooks/useSidebarContentLists";
import {
  searchSidebarCollections,
  searchSidebarSingles,
} from "@admin/lib/sidebar-landing";
import { cn } from "@admin/lib/utils";

import {
  CONTENT_SECTION_HREF,
  contentPanelView,
  type ContentSection,
} from "./lib/content-rail";
import { SidebarSearch } from "./SidebarSearch";

import { SidebarMenu } from "./index";

const PART: Record<
  ContentSection,
  { label: string; href: string; noun: string }
> = {
  collections: {
    label: "Collections",
    href: CONTENT_SECTION_HREF.collections,
    noun: "collections",
  },
  singles: {
    label: "Singles",
    href: CONTENT_SECTION_HREF.singles,
    noun: "Singles",
  },
};

interface ContentPanelProps {
  /** The part showing: the section of the current route. */
  part: ContentSection;
  search: string;
  onSearchChange: (value: string) => void;
  /** Whether the reader has collections to list. */
  hasCollections: boolean;
  /** Whether the reader has Singles to list. */
  hasSingles: boolean;
  isActive: (href?: string, exact?: boolean) => boolean;
}

export function ContentPanel({
  part,
  search,
  onSearchChange,
  hasCollections,
  hasSingles,
  isActive,
}: ContentPanelProps): JSX.Element {
  const collections = useSidebarCollectionList();
  const singles = useSidebarSingleList();

  // Matches come from the same search the lists draw with, so a count here can
  // never disagree with what a list shows.
  const { shown, other, showControl, otherHasMatches, shownIsEmpty } =
    contentPanelView({
      part,
      search,
      available: { collections: hasCollections, singles: hasSingles },
      matches: {
        collections: searchSidebarCollections(collections.items, search).length,
        singles: searchSidebarSingles(singles.items, search).length,
      },
      // Complete, not merely loaded: a search may say nothing matched only
      // once every page has arrived.
      loading: {
        collections: !collections.isComplete,
        singles: !singles.isComplete,
      },
    });

  return (
    <div className="space-y-4 px-4 py-6">
      {showControl ? (
        <ContentTypeControl
          shown={shown}
          dotOn={otherHasMatches ? other : null}
        />
      ) : null}

      <SidebarSearch
        placeholder={`Search ${PART[shown].noun}`}
        value={search}
        onChange={onSearchChange}
      />

      {shownIsEmpty ? (
        <div className="px-3 text-sm text-muted-foreground" role="status">
          <p>
            No {PART[shown].noun} match “{search}”.
          </p>
          {otherHasMatches ? (
            <Link
              href={PART[other].href}
              className="mt-2 inline-block font-semibold text-foreground underline underline-offset-2"
            >
              See matches in {PART[other].label}
            </Link>
          ) : null}
        </div>
      ) : (
        <SidebarMenu>
          {shown === "collections" ? (
            <DynamicCollectionNav isActive={isActive} search={search} />
          ) : (
            <DynamicSingleNav isActive={isActive} search={search} />
          )}
        </SidebarMenu>
      )}
    </div>
  );
}

/**
 * The segmented control: one link per part, the showing one current, and a dot
 * on the part named by `dotOn` saying it has matches too.
 */
function ContentTypeControl({
  shown,
  dotOn,
}: {
  shown: ContentSection;
  dotOn: ContentSection | null;
}): JSX.Element {
  return (
    <nav
      aria-label="Content type"
      className="mx-2 flex rounded-md bg-muted p-1"
    >
      {(["collections", "singles"] as const).map(id => {
        const current = id === shown;
        return (
          <Link
            key={id}
            href={PART[id].href}
            aria-current={current ? "page" : undefined}
            className={cn(
              "relative flex h-11 flex-1 items-center justify-center rounded-sm text-sm transition-colors lg:h-8",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              current
                ? "bg-background font-semibold text-foreground shadow-sm"
                : "font-medium text-muted-foreground hover:text-foreground"
            )}
          >
            {PART[id].label}
            {id === dotOn ? (
              <>
                <span
                  aria-hidden="true"
                  className="absolute right-2 top-1.5 h-1.5 w-1.5 rounded-full bg-foreground"
                />
                <span className="sr-only">, has matches</span>
              </>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
