"use client";

import { Alert, AlertDescription, AlertTitle, Button } from "@nextlyhq/ui";
import type { JSX } from "react";
import { useMemo, useState } from "react";

import { AlertCircle } from "@admin/components/icons";
import {
  EMAIL_PROVIDER_READ_PERMISSIONS,
  EMAIL_TEMPLATE_READ_PERMISSIONS,
  holdsAny,
} from "@admin/constants/email-hub";
import {
  useEmailActivity,
  useQueuedEmailOverdue,
} from "@admin/hooks/queries/useEmailActivity";
import { useEmailProviders } from "@admin/hooks/queries/useEmailProviders";
import { useEmailTemplates } from "@admin/hooks/queries/useEmailTemplates";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";

import type { ActivityFilter, ActivityRow } from "./activity-model";
import {
  ActivityFilters,
  DEFAULT_ACTIVITY_FILTER,
  isFiltered,
  type ProviderOption,
  type TemplateOption,
} from "./ActivityFilters";
import { ActivityList, type ActivityNames } from "./ActivityList";
import { OverdueBanner } from "./OverdueBanner";

/** The most providers the name lookup and the provider filter read at once. */
const PROVIDERS_READ = 100;

/**
 * The providers the filter offers: every stored one, by name, and each
 * deleted one the loaded rows name, by the type the log kept for it.
 */
function providerOptions(
  stored: ReadonlyArray<{ id: string; name: string }> | undefined,
  rows: readonly ActivityRow[]
): ProviderOption[] | undefined {
  if (!stored) return undefined;
  const options: ProviderOption[] = stored.map(provider => ({
    choice: { id: provider.id },
    label: provider.name,
  }));
  const deleted = new Set<string>();
  for (const row of rows) {
    if (row.source === "delivery" && row.provider.id === null) {
      deleted.add(row.provider.type);
    }
  }
  for (const type of [...deleted].sort()) {
    options.push({ choice: { type }, label: `${type} (deleted)` });
  }
  return options;
}

/**
 * The Email hub's Activity tab: the late-queue banner, the filters and the
 * newest-first list of every delivery and queued email.
 *
 * Templates and providers are named from the hub's own lists when the reader
 * may read them, and by their slug or type otherwise.
 */
export function ActivityScreen(): JSX.Element {
  const [filter, setFilter] = useState<ActivityFilter>(DEFAULT_ACTIVITY_FILTER);
  const { hasPermission } = useCurrentUserPermissions();
  const readsTemplates = holdsAny(
    hasPermission,
    EMAIL_TEMPLATE_READ_PERMISSIONS
  );
  const readsProviders = holdsAny(
    hasPermission,
    EMAIL_PROVIDER_READ_PERMISSIONS
  );

  const activity = useEmailActivity(filter);
  const overdue = useQueuedEmailOverdue();
  const templates = useEmailTemplates({ enabled: readsTemplates });
  const providers = useEmailProviders(
    { page: 0, pageSize: PROVIDERS_READ, search: "" },
    { enabled: readsProviders }
  );

  const templateNames = useMemo(
    () => new Map((templates.data ?? []).map(t => [t.slug, t.name])),
    [templates.data]
  );
  const providerNames = useMemo(
    () => new Map((providers.data?.data ?? []).map(p => [p.id, p.name])),
    [providers.data]
  );
  const names: ActivityNames = {
    template: slug => templateNames.get(slug),
    provider: id => providerNames.get(id),
  };
  const templateOptions: TemplateOption[] | undefined = templates.data
    ? templates.data
        .map(t => ({ slug: t.slug, label: t.name }))
        .sort((a, b) => a.label.localeCompare(b.label))
    : undefined;
  const filtered = isFiltered(filter);

  return (
    <div className="space-y-4">
      <OverdueBanner overdue={overdue.data} />
      <ActivityFilters
        filter={filter}
        onChange={setFilter}
        templates={templateOptions}
        providers={providerOptions(providers.data?.data, activity.rows)}
      />
      {filter.provider && (
        <p className="text-xs text-muted-foreground">
          Queued email waiting for its first attempt has no provider yet, so it
          isn’t listed while a provider is chosen.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <span>
          {activity.rows.length}
          {activity.hasMore ? "+" : ""} shown, newest first
          {filtered ? " · filtered" : ""}
        </span>
        {filtered && (
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0"
            onClick={() =>
              setFilter({ ...DEFAULT_ACTIVITY_FILTER, window: filter.window })
            }
          >
            Clear filters
          </Button>
        )}
      </div>
      {activity.isError ? (
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
      ) : (
        <ActivityList
          rows={activity.rows}
          names={names}
          now={new Date()}
          isLoading={activity.isLoading}
          filtered={filtered}
          hasMore={activity.hasMore}
          isLoadingMore={activity.isLoadingMore}
          onLoadMore={activity.loadMore}
        />
      )}
    </div>
  );
}
