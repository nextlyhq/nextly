"use client";

import { Alert, AlertDescription, AlertTitle, Button } from "@nextlyhq/ui";
import type { JSX } from "react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { AlertCircle } from "@admin/components/icons";
import {
  EMAIL_PROVIDER_READ_PERMISSIONS,
  EMAIL_TEMPLATE_READ_PERMISSIONS,
  EMAIL_TEMPLATE_UPDATE_PERMISSIONS,
  holdsAny,
} from "@admin/constants/email-hub";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import {
  useEmailActivity,
  useQueuedEmailOverdue,
  type EmailActivityResult,
  type AddressSearchRequest,
  type OpenActivity,
} from "@admin/hooks/queries/useEmailActivity";
import { useEmailProviders } from "@admin/hooks/queries/useEmailProviders";
import { useEmailTemplates } from "@admin/hooks/queries/useEmailTemplates";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import type { EmailProviderRecord } from "@admin/services/emailProviderApi";
import type { EmailTemplateRecord } from "@admin/services/emailTemplateApi";

import { providerTypeChoices, templateChoices } from "./activity-choices";
import type { ActivityFilter } from "./activity-model";
import { ActivityDetailSheet } from "./ActivityDetailSheet";
import {
  ActivityFilters,
  DEFAULT_ACTIVITY_FILTER,
  isFiltered,
} from "./ActivityFilters";
import { ActivityList, type ActivityNames } from "./ActivityList";
import { AddressSearch } from "./AddressSearch";
import { OverdueBanner } from "./OverdueBanner";

/** The most providers the name lookup and the provider filter read at once. */
const PROVIDERS_READ = 100;

/** How often the list's relative times are worked out again while it is open. */
const CLOCK_TICK_MS = 30_000;

/**
 * The time, read again every `CLOCK_TICK_MS`, so "10 min ago" and "Next
 * attempt in 10 min" stay true on a page left open, whether or not anything
 * else renders it again.
 */
export function useTickingNow(intervalMs = CLOCK_TICK_MS): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/**
 * The Email hub's Activity tab: the late-queue banner, the filters and the
 * newest-first merged Activity of queued email and unqueued sends, or, after
 * a search by one exact address, only what went to it, under the same filters.
 *
 * Templates and providers are named from the hub's own lists when the reader
 * may read them, and by their slug or type otherwise; the filters offer them
 * either way (`activity-choices`).
 */
export function ActivityScreen(): JSX.Element {
  const [filter, setFilter] = useState<ActivityFilter>(DEFAULT_ACTIVITY_FILTER);
  // The search the list shows, if any. Each search gets its own number, so
  // the same address searched again is read again, and the address itself
  // is held only here, never in the page's address or a cache key.
  const [search, setSearch] = useState<AddressSearchRequest | null>(null);
  const searches = useRef(0);
  // This mount's own name for its searches, so a screen mounted again never
  // reads an earlier mount's search under the same number.
  const scope = useId();
  const activity = useEmailActivity(filter, { search: search ?? undefined });
  // A filter changed on a search's results asks again, as a search of its
  // own: each is recorded, so none is made but by the reader's own change.
  const changeFilter = (next: ActivityFilter) => {
    setFilter(next);
    // A choice that changes nothing (the window already chosen, say) asks
    // nothing again.
    if (search && !sameFilter(next, search.filter)) {
      searches.current += 1;
      setSearch({ ...search, id: searches.current, filter: next });
    }
  };
  const overdue = useQueuedEmailOverdue();
  const lists = useActivityLists();
  const now = useTickingNow();
  const filtered = isFiltered(filter);
  const [open, setOpen] = useState<OpenActivity | null>(null);

  return (
    <div className="space-y-4">
      <OverdueBanner overdue={overdue.data} />
      <AddressSearch
        searching={search !== null}
        onSearch={address => {
          searches.current += 1;
          setSearch({ scope, id: searches.current, address, filter });
        }}
        onClear={() => setSearch(null)}
      />
      <ActivityFilters
        filter={filter}
        onChange={changeFilter}
        templates={templateChoices(
          lists.templates,
          activity.rows,
          filter.template
        )}
        providers={providerTypeChoices(
          lists.providers,
          activity.rows,
          filter.providerType
        )}
      />
      {search && activity.notice && (
        // The server's word on which records a search by address can't reach.
        <Alert variant="info" role="note">
          <AlertDescription>{activity.notice}</AlertDescription>
        </Alert>
      )}
      <ActivityCount
        shown={activity.rows.length}
        more={activity.hasMore}
        searching={search !== null}
        // No count for a search not answered yet, or one that failed with
        // nothing found: it has found nothing to count.
        pending={
          search !== null &&
          (activity.isLoading ||
            (activity.isError && activity.rows.length === 0))
        }
        filtered={filtered}
        onClear={() =>
          changeFilter({ ...DEFAULT_ACTIVITY_FILTER, window: filter.window })
        }
      />
      <ActivityBody
        activity={activity}
        names={lists.names}
        now={now}
        filtered={filtered}
        searching={search !== null}
        onOpen={setOpen}
      />
      <ActivityDetailSheet
        open={open}
        onClose={() => setOpen(null)}
        names={lists.names}
        now={now}
        fixTemplateHref={lists.fixTemplateHref}
      />
    </div>
  );
}

/**
 * The hub's own lists of templates and providers, read only where the reader
 * may read them, and the names the list shows from them.
 */
function useActivityLists(): {
  templates: EmailTemplateRecord[] | undefined;
  providers: EmailProviderRecord[] | undefined;
  names: ActivityNames;
  fixTemplateHref: (slug: string) => string | undefined;
} {
  const { hasPermission } = useCurrentUserPermissions();
  const readsTemplates = holdsAny(
    hasPermission,
    EMAIL_TEMPLATE_READ_PERMISSIONS
  );
  const readsProviders = holdsAny(
    hasPermission,
    EMAIL_PROVIDER_READ_PERMISSIONS
  );
  const templateRead = useEmailTemplates({ enabled: readsTemplates });
  const providerRead = useEmailProviders(
    { page: 0, pageSize: PROVIDERS_READ, search: "" },
    { enabled: readsProviders }
  );
  // Used only while the reader still holds the grant: a disabled query keeps
  // answering from its cache, so a grant that ended would otherwise leave the
  // names it read on screen.
  const templates = readsTemplates ? templateRead.data : undefined;
  const providers = readsProviders ? providerRead.data?.data : undefined;
  const templateNames = useMemo(
    () => new Map((templates ?? []).map(t => [t.slug, t.name])),
    [templates]
  );
  const providerNames = useMemo(
    () => new Map((providers ?? []).map(p => [p.id, p.name])),
    [providers]
  );
  // "Fix template" opens the template's own edit page, so it is offered only
  // to a reader who may edit templates, for a template the hub's list holds.
  const editsTemplates = holdsAny(
    hasPermission,
    EMAIL_TEMPLATE_UPDATE_PERMISSIONS
  );
  const templateIds = useMemo(
    () => new Map((templates ?? []).map(t => [t.slug, t.id])),
    [templates]
  );
  return {
    templates,
    providers,
    fixTemplateHref: slug => {
      const id = editsTemplates ? templateIds.get(slug) : undefined;
      return id ? buildRoute(ROUTES.EMAIL_MESSAGES_EDIT, { id }) : undefined;
    },
    names: {
      template: slug => templateNames.get(slug),
      provider: id => providerNames.get(id),
    },
  };
}

/**
 * How many rows are shown, whether they are a search's, whether filtered,
 * and the way to clear the filters.
 */
function ActivityCount({
  shown,
  more,
  searching,
  pending,
  filtered,
  onClear,
}: {
  shown: number;
  more: boolean;
  searching: boolean;
  pending: boolean;
  filtered: boolean;
  onClear: () => void;
}): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
      <span hidden={pending}>
        {shown}
        {more ? "+" : ""} {searching ? "found for this address" : "shown"},
        newest first
        {filtered ? " · filtered" : ""}
      </span>
      {filtered && (
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0"
          onClick={onClear}
        >
          Clear filters
        </Button>
      )}
    </div>
  );
}

/**
 * The list, or the error in its place. A read that fails with nothing loaded
 * leaves nothing to show; one that fails later (a refresh, Load more) keeps
 * what has loaded, with a short note.
 */
function ActivityBody({
  activity,
  names,
  now,
  filtered,
  searching,
  onOpen,
}: {
  activity: EmailActivityResult;
  names: ActivityNames;
  now: Date;
  filtered: boolean;
  searching: boolean;
  onOpen: (open: OpenActivity) => void;
}): JSX.Element {
  if (activity.isError && activity.rows.length === 0) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" aria-hidden />
        <AlertTitle>
          {searching
            ? "The search couldn’t be made"
            : "Activity couldn’t be loaded"}
        </AlertTitle>
        <AlertDescription>
          <p>{activity.error?.message ?? "Try again in a moment."}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={activity.refetch}
          >
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <>
      {activity.isError && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground"
        >
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
          <span>Couldn’t refresh, so this shows what loaded before.</span>
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0"
            onClick={activity.refetch}
          >
            Try again
          </Button>
        </div>
      )}
      <ActivityList
        rows={activity.rows}
        names={names}
        now={now}
        isLoading={activity.isLoading}
        filtered={filtered}
        searching={searching}
        hasMore={activity.hasMore}
        isLoadingMore={activity.isLoadingMore}
        onLoadMore={activity.loadMore}
        onOpen={onOpen}
      />
    </>
  );
}

/** Whether two filter choices ask the same of the Activity. */
function sameFilter(a: ActivityFilter, b: ActivityFilter): boolean {
  return (
    a.outcome === b.outcome &&
    a.template === b.template &&
    a.providerType === b.providerType &&
    a.providerOrigin === b.providerOrigin &&
    a.window === b.window
  );
}
