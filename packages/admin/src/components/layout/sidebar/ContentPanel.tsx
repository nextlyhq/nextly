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
import { ROUTES } from "@admin/constants/routes";
import {
  useSidebarCollectionList,
  useSidebarSingleList,
} from "@admin/hooks/useSidebarContentLists";
import {
  searchSidebarCollections,
  searchSidebarSingles,
} from "@admin/lib/sidebar-landing";
import { cn } from "@admin/lib/utils";

import type { ContentSection } from "./lib/content-rail";
import { SidebarSearch } from "./SidebarSearch";

import { SidebarMenu } from "./index";

const PART: Record<
  ContentSection,
  { label: string; href: string; noun: string }
> = {
  collections: {
    label: "Collections",
    href: ROUTES.COLLECTIONS,
    noun: "collections",
  },
  singles: { label: "Singles", href: ROUTES.SINGLES, noun: "Singles" },
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
  const matches: Record<ContentSection, number> = {
    collections: searchSidebarCollections(collections.items, search).length,
    singles: searchSidebarSingles(singles.items, search).length,
  };
  const available: Record<ContentSection, boolean> = {
    collections: hasCollections,
    singles: hasSingles,
  };
  // With one kind to list there is nothing to choose between, so the control
  // goes and that kind's list shows alone.
  const shown: ContentSection = available[part]
    ? part
    : hasCollections
      ? "collections"
      : "singles";
  const other: ContentSection =
    shown === "collections" ? "singles" : "collections";
  const showControl = hasCollections && hasSingles;
  const otherHasMatches = showControl && search !== "" && matches[other] > 0;
  const shownIsEmpty =
    search !== "" &&
    matches[shown] === 0 &&
    !(shown === "collections" ? collections.isLoading : singles.isLoading);

  return (
    <div className="space-y-4 px-4 py-6">
      {showControl ? (
        <nav
          aria-label="Content type"
          className="mx-2 flex rounded-md bg-muted p-1"
        >
          {(["collections", "singles"] as const).map(id => {
            const current = id === shown;
            const dot = id === other && otherHasMatches;
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
                {dot ? (
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
