"use client";

/**
 * The Content overview: every collection and Single the reader may open, in
 * two tables, at `/admin/content`; and the one table of each kind at
 * `/admin/collections` and `/admin/singles`.
 *
 * The lists are the Content panel's own (`useSidebarCollectionList`,
 * `useSidebarSingleList`): the same collections and Singles in the same order,
 * a hidden one left out of both. What each address shows of them is decided by
 * `overviewPlan`; this page only draws it. The search filters both tables by
 * name, as the panel's search does.
 *
 * @module components/features/content-overview/ContentOverview
 */
import { Input, PageHeader } from "@nextlyhq/ui";
import { useEffect, useId, useState, type JSX } from "react";

import { Search } from "@admin/components/icons";
import { PageContainer } from "@admin/components/layout/page-container";
import { Breadcrumbs } from "@admin/components/shared";
import { SectionErrorFallback } from "@admin/components/shared/error-fallbacks";
import { ROUTES } from "@admin/constants/routes";
import { useBranding } from "@admin/context/providers/BrandingProvider";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import {
  useSidebarCollectionList,
  useSidebarSingleList,
} from "@admin/hooks/useSidebarContentLists";
import { replaceTo } from "@admin/lib/navigation";

import { CollectionsTable } from "./CollectionsTable";
import { ContentEmptyState } from "./ContentEmptyState";
import {
  mayBuildCollections,
  OVERVIEW_TITLE,
  overviewPlan,
  overviewSummary,
  type OverviewScope,
} from "./overview-plan";
import { SinglesTable } from "./SinglesTable";

/** The trail above the page: Content, or Content and the one kind shown. */
function crumbsOf(scope: OverviewScope) {
  return scope === "all"
    ? [{ label: "Content" }]
    : [
        { label: "Content", href: ROUTES.CONTENT },
        { label: OVERVIEW_TITLE[scope] },
      ];
}

const SEARCH_LABEL: Readonly<Record<OverviewScope, string>> = {
  all: "Search content",
  collections: "Search collections",
  singles: "Search Singles",
};

/** The page's search over its tables, named for what it searches. */
function OverviewSearch({
  scope,
  value,
  onChange,
}: {
  scope: OverviewScope;
  value: string;
  onChange: (value: string) => void;
}): JSX.Element {
  const id = useId();
  const label = SEARCH_LABEL[scope];
  return (
    <div className="relative w-full sm:w-60">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        id={id}
        type="search"
        size="sm"
        placeholder={label}
        value={value}
        onChange={event => onChange(event.target.value)}
        className="pl-9"
      />
    </div>
  );
}

export function ContentOverview({
  scope,
}: {
  scope: OverviewScope;
}): JSX.Element {
  const collections = useSidebarCollectionList();
  const singles = useSidebarSingleList();
  const { content, retry, hasPermission } = useCurrentUserPermissions();
  const branding = useBranding();
  const [search, setSearch] = useState("");

  // Without the server's answer about what the reader may do, the lists are
  // filtered through nothing and read as empty: that is a failure to say, not
  // a reader with no content to redirect or tell so.
  const accessFailed = !content.hasAnswer && content.error !== null;
  const plan = overviewPlan({
    scope,
    // The lists are filtered through the server's answer about each entity,
    // so they are not settled until that answer is.
    settled:
      !collections.isLoading &&
      !singles.isLoading &&
      !content.isLoading &&
      !accessFailed,
    readable: {
      collections: collections.items.length > 0,
      singles: singles.items.length > 0,
    },
  });
  const redirectTo = plan.kind === "redirect" ? plan.to : null;
  useEffect(() => {
    // In place of the address it was asked at, so Back skips the bounce.
    if (redirectTo !== null) replaceTo(redirectTo);
  }, [redirectTo]);

  return (
    <PageContainer>
      <Breadcrumbs items={crumbsOf(scope)} className="mb-6" />
      <PageHeader
        title={OVERVIEW_TITLE[scope]}
        description={
          plan.kind === "tables"
            ? overviewSummary({
                scope,
                collections: collections.items.length,
                singles: singles.items.length,
              })
            : undefined
        }
        actions={
          plan.kind === "tables" ? (
            <OverviewSearch scope={scope} value={search} onChange={setSearch} />
          ) : undefined
        }
      />
      {accessFailed ? (
        <SectionErrorFallback
          title="Couldn't check your access"
          description="The admin couldn't load what you may do with collections and Singles, so it can't tell which ones to show."
          error={content.error ?? undefined}
          reset={retry}
        />
      ) : plan.kind === "tables" ? (
        <div className="space-y-10">
          {plan.collections ? (
            <CollectionsTable collections={collections.items} search={search} />
          ) : null}
          {plan.singles ? (
            <SinglesTable singles={singles.items} search={search} />
          ) : null}
        </div>
      ) : plan.kind === "empty" ? (
        <ContentEmptyState
          canBuild={mayBuildCollections(
            hasPermission,
            branding.showBuilder !== false
          )}
        />
      ) : (
        // Pending, or on the way to the other kind's address: nothing is
        // claimed of the lists yet.
        <div className="h-32" aria-hidden="true" />
      )}
    </PageContainer>
  );
}
