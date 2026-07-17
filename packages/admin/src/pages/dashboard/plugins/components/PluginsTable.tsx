"use client";

import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@nextlyhq/ui";
import { useSuspenseQuery } from "@tanstack/react-query";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import * as Icons from "@admin/components/icons";
import { Columns, Package } from "@admin/components/icons";
import { Pagination } from "@admin/components/shared/pagination";
import { SearchBar } from "@admin/components/shared/search-bar";
import { DataTableView } from "@admin/components/ui/table/data-table";
import type { NextlyColumn } from "@admin/components/ui/table/data-table";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import { UI } from "@admin/constants/ui";
import { useDebouncedValue } from "@admin/hooks/useDebouncedValue";
import { publicApi } from "@admin/lib/api/publicApi";
import type { PluginMetadata, AdminBranding } from "@admin/types/branding";

/** Human labels for the category vocabulary plugins declare. */
const CATEGORY_LABELS: Record<string, string> = {
  content: "Content",
  forms: "Forms",
  seo: "SEO",
  media: "Media",
  commerce: "Commerce",
  integration: "Integration",
  "dev-tools": "Dev Tools",
  other: "Other",
};

type PluginWithId = PluginMetadata & { id: string };

type StatusFilter = "all" | "enabled" | "disabled";

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

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
        enabled
          ? "text-xs font-normal border-success text-success"
          : "text-xs font-normal text-muted-foreground"
      }
    >
      <span
        aria-hidden
        className={`mr-1.5 inline-block h-1.5 w-1.5 ${
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
  const { data: branding } = useSuspenseQuery<AdminBranding>({
    queryKey: ["admin-meta"],
    queryFn: () => publicApi.get<AdminBranding>("/admin-meta"),
    staleTime: 5 * 60 * 1000,
  });

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, UI.SEARCH_DEBOUNCE_MS);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());

  // Reset to the first page when the search term or status filter changes so
  // the slice does not fall out of range against the newly filtered list.
  useEffect(() => {
    setPage(0);
  }, [debouncedSearch, statusFilter]);

  // Changing the page size can leave the current page index out of range; snap
  // back to the first page.
  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setPage(0);
  };

  const pluginsWithId = useMemo(() => {
    return (branding?.plugins ?? []).map(plugin => ({
      ...plugin,
      id: toSlug(plugin.name),
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

  const toggleColumn = useCallback((key: string) => {
    setHiddenColumns(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const allColumns = useMemo<NextlyColumn<PluginWithId>[]>(() => {
    return [
      {
        name: "name",
        header: "PLUGIN",
        cell: ({ row }) => {
          const iconName = row.appearance?.icon || "Package";
          const IconComponent =
            (Icons as Record<string, React.ElementType>)[iconName] || Package;
          // Secondary metadata (description, author) packs under the name so
          // the table stays two-scan-columns wide like an installed-list should.
          const secondary = [row.description, row.author && `by ${row.author}`]
            .filter(Boolean)
            .join(" · ");
          return (
            <div className="flex items-center gap-3">
              <div className="table-row-icon-cover">
                <IconComponent className="h-4 w-4" />
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
              {CATEGORY_LABELS[value] ?? value}
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

  const columns = useMemo(
    () =>
      allColumns.map(col => ({ ...col, hidden: hiddenColumns.has(col.name) })),
    [allColumns, hiddenColumns]
  );

  const toggleableColumns = useMemo(
    () => allColumns.filter(col => !ALWAYS_VISIBLE.has(col.name)),
    [allColumns]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="Search plugins..."
          className="w-full border-border bg-background text-foreground md:max-w-sm"
        />
        <div className="flex items-center gap-2">
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="md"
                className="border-border bg-background text-foreground hover:bg-accent/10"
              >
                <Columns className="h-4 w-4" />
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {toggleableColumns.map(col => (
                <DropdownMenuCheckboxItem
                  key={col.name}
                  checked={!hiddenColumns.has(col.name)}
                  onCheckedChange={() => toggleColumn(col.name)}
                >
                  {typeof col.header === "string" ? col.header : col.name}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <DataTableView<PluginWithId>
        columns={columns}
        rows={paginatedPlugins}
        rowHref={plugin =>
          buildRoute(ROUTES.PLUGIN_DETAIL, { slug: plugin.id })
        }
        registryKey="plugins"
        ariaLabel="Installed plugins table"
        emptyMessage={
          debouncedSearch || statusFilter !== "all"
            ? "No plugins match the current filters."
            : "No plugins installed. Add plugins to your Nextly config to extend functionality."
        }
      />
      {totalCount > 0 && (
        <Pagination
          currentPage={page}
          totalPages={Math.ceil(totalCount / pageSize)}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={handlePageSizeChange}
          totalItems={totalCount}
        />
      )}
    </div>
  );
}
