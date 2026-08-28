"use client";

import { Badge, Button } from "@nextlyhq/ui";
import { useEffect, useMemo, useState } from "react";

import { PluginIcon } from "@admin/components/shared/plugin-icon";
import type { NextlyColumn } from "@admin/components/ui/table/data-table";
import {
  ListView,
  useTableColumns,
} from "@admin/components/ui/table/list-view";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import { UI } from "@admin/constants/ui";
import {
  useBranding,
  useBrandingStatus,
} from "@admin/context/providers/BrandingProvider";
import { useDebouncedValue } from "@admin/hooks/useDebouncedValue";
import { usePagination } from "@admin/hooks/usePagination";
import { categoryLabel } from "@admin/lib/plugins/plugin-categories";
import { pluginSlug } from "@admin/lib/plugins/plugin-slug";
import type { PluginMetadata } from "@admin/types/branding";

import { InstalledPluginsUnavailable } from "./InstalledPluginsUnavailable";
import { PluginsTableSkeleton } from "./PluginsTableSkeleton";

type PluginWithId = PluginMetadata & { id: string };

type StatusFilter = "all" | "enabled" | "disabled";

/** Columns pinned as always-visible in the column toggle. */
const ALWAYS_VISIBLE = new Set(["name"]);

/**
 * Read-only Enabled/Disabled pill. Enabled state comes from the developer's
 * config, so the admin reports it rather than offering a toggle that the next
 * deploy would silently revert.
 */
export function PluginStatusPill({ enabled }: { enabled: boolean }) {
  return (
    <Badge
      variant="outline"
      className={
        // Full-strength success border so the enabled pill's boundary is perceivable at the 3:1 UI minimum.
        enabled
          ? "text-xs font-normal border-success text-success"
          : "text-xs font-normal text-muted-foreground"
      }
    >
      <span
        aria-hidden
        className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${
          enabled ? "bg-success" : "bg-muted-foreground/60"
        }`}
      />
      {enabled ? "Enabled" : "Disabled"}
    </Badge>
  );
}

/**
 * PluginsTable
 *
 * Lists installed plugins with client-side search, a status filter,
 * pagination, and column visibility. Rows navigate to the plugin's detail
 * page. Plugins are installed and updated through npm + the Nextly config, so
 * the table exposes no mutation actions.
 */
export default function PluginsTable() {
  // Read through the provider rather than a second query of its own. The
  // plugin list is served by the session-gated route, and a duplicate reader
  // pointed at the public one shares the same cache key while asking a
  // question that route no longer answers — the table would render empty.
  const branding = useBranding();
  // `useBranding` neither suspends nor throws, so the Suspense boundary and
  // the error boundary around this table can no longer show their
  // fallbacks. Without these two branches an unanswered request renders the
  // definitive empty state: momentarily on a slow load, permanently after a
  // failure.
  const { isPending: pluginsPending, isUnavailable: pluginsUnavailable } =
    useBrandingStatus();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, UI.SEARCH_DEBOUNCE_MS);
  // 25 rather than the hook's default: an installed-plugins list is short and
  // read in one pass, so a smaller page would split most installations across
  // pages that no one needs to visit.
  const { page, pageSize, setPage, setPageSize, resetPage } = usePagination({
    initialPageSize: 25,
  });
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // Reset to the first page when the search term or status filter changes so
  // the slice does not fall out of range against the newly filtered list.
  useEffect(() => {
    resetPage();
  }, [debouncedSearch, statusFilter, resetPage]);

  const pluginsWithId = useMemo(() => {
    return (branding?.plugins ?? []).map(plugin => ({
      ...plugin,
      id: pluginSlug(plugin.name),
    }));
  }, [branding?.plugins]);

  const filteredPlugins = useMemo(() => {
    let result = pluginsWithId;
    if (statusFilter !== "all") {
      // Older servers omit `enabled`; a plugin whose behavior loads is enabled.
      result = result.filter(
        plugin => (plugin.enabled !== false) === (statusFilter === "enabled")
      );
    }
    if (debouncedSearch) {
      const query = debouncedSearch.toLowerCase();
      result = result.filter(
        plugin =>
          plugin.name.toLowerCase().includes(query) ||
          plugin.appearance?.label?.toLowerCase().includes(query) ||
          plugin.description?.toLowerCase().includes(query) ||
          plugin.author?.toLowerCase().includes(query)
      );
    }
    return result;
  }, [pluginsWithId, debouncedSearch, statusFilter]);

  const totalCount = filteredPlugins.length;

  const paginatedPlugins = useMemo(() => {
    const start = page * pageSize;
    return filteredPlugins.slice(start, start + pageSize);
  }, [filteredPlugins, page, pageSize]);

  const allColumns = useMemo<NextlyColumn<PluginWithId>[]>(() => {
    return [
      {
        name: "name",
        header: "PLUGIN",
        cell: ({ row }) => {
          // Secondary metadata (description, author) packs under the name so
          // the table stays two-scan-columns wide like an installed-list should.
          const secondary = [row.description, row.author && `by ${row.author}`]
            .filter(Boolean)
            .join(" · ");
          return (
            <div className="flex items-center gap-3">
              <div className="table-row-icon-cover">
                {/* Package, not Database: this surface presents a plugin as the
                    package you installed rather than as its collections. */}
                <PluginIcon
                  plugin={row}
                  fallback="Package"
                  className="h-4 w-4"
                />
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium text-foreground">
                  {row.appearance?.label ?? row.name}
                </span>
                {secondary && (
                  <span className="truncate text-xs text-muted-foreground">
                    {secondary}
                  </span>
                )}
              </div>
            </div>
          );
        },
      },
      {
        name: "version",
        header: "VERSION",
        cell: ({ value }) => (
          <span className="font-mono text-sm text-muted-foreground">
            {typeof value === "string" ? value : "—"}
          </span>
        ),
      },
      {
        name: "category",
        header: "CATEGORY",
        cell: ({ value }) =>
          typeof value === "string" && value ? (
            <Badge
              variant="default"
              className="text-xs font-normal text-muted-foreground"
            >
              {/* Falls back to the raw value for a third-party plugin that
                  declares a category outside the vocabulary. */}
              {categoryLabel(value)}
            </Badge>
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          ),
      },
      {
        name: "enabled",
        header: "STATUS",
        cell: ({ row }) => <PluginStatusPill enabled={row.enabled !== false} />,
      },
    ];
  }, []);

  const { columns, columnsControl } = useTableColumns({
    storageKey: "plugins",
    columns: allColumns,
    alwaysVisible: ALWAYS_VISIBLE,
  });

  // Before the table, because its empty state is a STATEMENT: "no plugins
  // installed" read from a request that has not answered is wrong while it is
  // in flight and stays wrong after it fails.
  if (pluginsPending) return <PluginsTableSkeleton />;
  if (pluginsUnavailable) return <InstalledPluginsUnavailable />;

  return (
    <ListView<PluginWithId>
      search={{
        value: search,
        onChange: setSearch,
        placeholder: "Search plugins...",
      }}
      inlineFilters={
        <div
          className="flex items-center gap-1"
          role="group"
          aria-label="Filter plugins by status"
        >
          {(["all", "enabled", "disabled"] as StatusFilter[]).map(f => (
            <Button
              key={f}
              variant={statusFilter === f ? "default" : "outline"}
              size="md"
              onClick={() => setStatusFilter(f)}
              className="capitalize"
            >
              {f}
            </Button>
          ))}
        </div>
      }
      columnsControl={columnsControl}
      columns={columns}
      rows={paginatedPlugins}
      rowHref={plugin => buildRoute(ROUTES.PLUGIN_DETAIL, { slug: plugin.id })}
      registryKey="plugins"
      ariaLabel="Installed plugins table"
      pagination={
        totalCount > 0
          ? {
              currentPage: page,
              totalPages: Math.ceil(totalCount / pageSize),
              pageSize,
              onPageChange: setPage,
              onPageSizeChange: setPageSize,
              totalItems: totalCount,
            }
          : undefined
      }
      emptyMessage={
        debouncedSearch || statusFilter !== "all"
          ? "No plugins match the current filters."
          : "No plugins installed. Add plugins to your Nextly config to extend functionality."
      }
    />
  );
}
