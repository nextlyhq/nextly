"use client";

import { Alert, AlertDescription, AlertTitle, Button } from "@nextlyhq/ui";
import type { JSX } from "react";
import { useEffect, useMemo, useState } from "react";

import { AlertCircle } from "@admin/components/icons";
import {
  EMAIL_PROVIDER_READ_PERMISSIONS,
  EMAIL_TEMPLATE_READ_PERMISSIONS,
  holdsAny,
} from "@admin/constants/email-hub";
import {
  useEmailActivity,
  useQueuedEmailOverdue,
  type EmailActivityResult,
} from "@admin/hooks/queries/useEmailActivity";
import { useEmailProviders } from "@admin/hooks/queries/useEmailProviders";
import { useEmailTemplates } from "@admin/hooks/queries/useEmailTemplates";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import type { EmailProviderRecord } from "@admin/services/emailProviderApi";
import type { EmailTemplateRecord } from "@admin/services/emailTemplateApi";

import { providerChoices, templateChoices } from "./activity-choices";
import type { ActivityFilter } from "./activity-model";
import {
  ActivityFilters,
  DEFAULT_ACTIVITY_FILTER,
  isFiltered,
} from "./ActivityFilters";
import { ActivityList, type ActivityNames } from "./ActivityList";
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
 * newest-first list of every delivery and queued email.
 *
 * Templates and providers are named from the hub's own lists when the reader
 * may read them, and by their slug or type otherwise; the filters offer them
 * either way (`activity-choices`).
 */
export function ActivityScreen(): JSX.Element {
  const [filter, setFilter] = useState<ActivityFilter>(DEFAULT_ACTIVITY_FILTER);
  const activity = useEmailActivity(filter);
  const overdue = useQueuedEmailOverdue();
  const lists = useActivityLists();
  const now = useTickingNow();
  const filtered = isFiltered(filter);

  return (
    <div className="space-y-4">
      <OverdueBanner overdue={overdue.data} />
      <ActivityFilters
        filter={filter}
        onChange={setFilter}
        templates={templateChoices(
          lists.templates,
          activity.rows,
          filter.template
        )}
        providers={providerChoices(
          lists.providers,
          activity.rows,
          filter.provider
        )}
      />
      <ProviderFilterNote provider={filter.provider} />
      <ActivityCount
        shown={activity.rows.length}
        more={activity.hasMore}
        filtered={filtered}
        onClear={() =>
          setFilter({ ...DEFAULT_ACTIVITY_FILTER, window: filter.window })
        }
      />
      <ActivityBody
        activity={activity}
        names={lists.names}
        now={now}
        filtered={filtered}
      />
    </div>
  );
}

/** Shown while a provider is chosen: what that choice leaves out of the list. */
export function ProviderFilterNote({
  provider,
}: {
  provider: ActivityFilter["provider"];
}): JSX.Element | null {
  if (!provider) return null;
  return (
    <p className="text-xs text-muted-foreground">
      No queued email is listed while a provider is chosen: queued email can’t
      be narrowed by provider yet, so only the delivery log is.
    </p>
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
  return {
    templates,
    providers,
    names: {
      template: slug => templateNames.get(slug),
      provider: id => providerNames.get(id),
    },
  };
}

/** How many rows are shown, whether filtered, and the way to clear the filters. */
function ActivityCount({
  shown,
  more,
  filtered,
  onClear,
}: {
  shown: number;
  more: boolean;
  filtered: boolean;
  onClear: () => void;
}): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
      <span>
        {shown}
        {more ? "+" : ""} shown, newest first
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
}: {
  activity: EmailActivityResult;
  names: ActivityNames;
  now: Date;
  filtered: boolean;
}): JSX.Element {
  if (activity.isError && activity.rows.length === 0) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" aria-hidden />
        <AlertTitle>Activity couldn’t be loaded</AlertTitle>
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
        hasMore={activity.hasMore}
        isLoadingMore={activity.isLoadingMore}
        onLoadMore={activity.loadMore}
      />
    </>
  );
}
