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

/**
 * The lists the page draws, what it shows of them, and the redirect that
 * follows when it sends the reader to the other kind's address.
 */
function useOverview(scope: OverviewScope) {
  const collections = useSidebarCollectionList();
  const singles = useSidebarSingleList();
  const { content, retry } = useCurrentUserPermissions();

  // Without the server's answer about what the reader may do, the lists are
  // filtered through nothing and read as empty: that is a failure to say, not
  // a reader with no content to redirect or tell so.
  const accessFailed = !content.hasAnswer && content.error !== null;
  // The lists are filtered through the server's answer about each entity, so
  // they are not settled until that answer is.
  const pending = [collections.isLoading, singles.isLoading, content.isLoading];
  const plan = overviewPlan({
    scope,
    settled: !pending.includes(true) && !accessFailed,
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

  return {
    collections: collections.items,
    singles: singles.items,
    plan,
    failure: accessFailed ? { error: content.error, retry } : null,
  };
}

type Overview = ReturnType<typeof useOverview>;

/** The empty state, offering to build a collection to a reader who may. */
function NothingToOpen(): JSX.Element {
  const { hasPermission } = useCurrentUserPermissions();
  const branding = useBranding();
  return (
    <ContentEmptyState
      canBuild={mayBuildCollections(
        hasPermission,
        branding.showBuilder !== false
      )}
    />
  );
}

/** What the page shows under its header, as the plan decides. */
function OverviewBody({
  overview,
  search,
}: {
  overview: Overview;
  search: string;
}): JSX.Element {
  const { plan, failure } = overview;
  if (failure !== null) {
    return (
      <SectionErrorFallback
        title="Couldn't check your access"
        description="The admin couldn't load what you may do with collections and Singles, so it can't tell which ones to show."
        error={failure.error ?? undefined}
        reset={failure.retry}
      />
    );
  }
  if (plan.kind === "empty") return <NothingToOpen />;
  if (plan.kind !== "tables") {
    // Pending, or on the way to the other kind's address: nothing is claimed
    // of the lists yet.
    return <div className="h-32" aria-hidden="true" />;
  }
  return (
    <div className="space-y-10">
      {plan.collections ? (
        <CollectionsTable collections={overview.collections} search={search} />
      ) : null}
      {plan.singles ? (
        <SinglesTable singles={overview.singles} search={search} />
      ) : null}
    </div>
  );
}

export function ContentOverview({
  scope,
}: {
  scope: OverviewScope;
}): JSX.Element {
  const overview = useOverview(scope);
  const [search, setSearch] = useState("");
  // The summary and the search only beside tables to summarize and search.
  const showsTables = overview.plan.kind === "tables";
  return (
    <PageContainer>
      <Breadcrumbs items={crumbsOf(scope)} className="mb-6" />
      <PageHeader
        title={OVERVIEW_TITLE[scope]}
        description={
          showsTables
            ? overviewSummary({
                scope,
                collections: overview.collections.length,
                singles: overview.singles.length,
              })
            : undefined
        }
        actions={
          showsTables ? (
            <OverviewSearch scope={scope} value={search} onChange={setSearch} />
          ) : undefined
        }
      />
      <OverviewBody overview={overview} search={search} />
    </PageContainer>
  );
}
