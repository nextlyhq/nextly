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
import { useCallback, useMemo, useState } from "react";

import { BulkActionBar } from "@admin/components/features/entries/EntryList/BulkActionBar";
import * as Icons from "@admin/components/icons";
import { Columns, Package } from "@admin/components/icons";
import { Pagination } from "@admin/components/shared/pagination";
import { SearchBar } from "@admin/components/shared/search-bar";
import { toast } from "@admin/components/ui";
import { DataTableView } from "@admin/components/ui/table/data-table";
import type {
  DataTableSelection,
  NextlyColumn,
} from "@admin/components/ui/table/data-table";
import { UI } from "@admin/constants/ui";
import { useDebouncedValue } from "@admin/hooks/useDebouncedValue";
import { useRowSelection } from "@admin/hooks/useRowSelection";
import { publicApi } from "@admin/lib/api/publicApi";
import type { PluginMetadata, AdminBranding } from "@admin/types/branding";

const PLACEMENT_LABELS: Record<string, string> = {
  collections: "Collections",
  singles: "Singles",
  users: "Users",
  settings: "Settings",
  plugins: "Plugins",
  standalone: "Standalone",
};

type PluginWithId = PluginMetadata & { id: string };

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Columns pinned as always-visible in the column toggle. */
const ALWAYS_VISIBLE = new Set(["name"]);

/**
 * PluginsTable
 *
 * Lists installed plugins with client-side search, pagination, column
 * visibility, and selection. Plugins are read-only previews (no row actions or
 * navigation); bulk operations are not yet available.
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
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());

  const pluginsWithId = useMemo(() => {
    return (branding?.plugins ?? []).map(plugin => ({
      ...plugin,
      id: toSlug(plugin.name),
    }));
  }, [branding?.plugins]);

  const filteredPlugins = useMemo(() => {
    if (!debouncedSearch) return pluginsWithId;
    const query = debouncedSearch.toLowerCase();
    return pluginsWithId.filter(
      plugin =>
        plugin.name.toLowerCase().includes(query) ||
        plugin.appearance?.label?.toLowerCase().includes(query) ||
        plugin.description?.toLowerCase().includes(query)
    );
  }, [pluginsWithId, debouncedSearch]);

  const totalCount = filteredPlugins.length;

  const paginatedPlugins = useMemo(() => {
    const start = page * pageSize;
    return filteredPlugins.slice(start, start + pageSize);
  }, [filteredPlugins, page, pageSize]);

  const {
    selectedIds,
    selectedCount,
    toggleSelection,
    selectAllOnPage,
    deselectAllOnPage,
    clearSelection,
  } = useRowSelection();

  const toggleColumn = useCallback((key: string) => {
    setHiddenColumns(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleBulkDelete = useCallback(() => {
    toast.info("Bulk delete is not available for plugins yet.");
  }, []);

  const allColumns = useMemo<NextlyColumn<PluginWithId>[]>(() => {
    const conversion = (v: unknown): string =>
      typeof v === "string" ? v : "—";

    return [
      {
        name: "name",
        header: "NAME",
        cell: ({ row }) => {
          const iconName = row.appearance?.icon || "Package";
          const IconComponent =
            (Icons as Record<string, React.ElementType>)[iconName] || Package;
          return (
            <div className="flex items-center gap-3">
              <div className="table-row-icon-cover">
                <IconComponent className="h-4 w-4" />
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium text-foreground">
                  {row.appearance?.label ?? row.name}
                </span>
                {row.description && (
                  <span className="truncate text-xs text-muted-foreground">
                    {row.description}
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
            {conversion(value)}
          </span>
        ),
      },
      {
        name: "placement",
        header: "PLACEMENT",
        cell: ({ value }) => (
          <Badge
            variant="default"
            className="text-xs font-normal capitalize text-muted-foreground"
          >
            {PLACEMENT_LABELS[String(value)] ?? String(value)}
          </Badge>
        ),
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

  const selection = useMemo<DataTableSelection<PluginWithId>>(
    () => ({
      selectedIds,
      onToggle: plugin => toggleSelection(plugin.id),
      onToggleAll: (rows, allSelected) => {
        const ids = rows.map(r => r.id);
        if (allSelected) deselectAllOnPage(ids);
        else selectAllOnPage(ids);
      },
    }),
    [selectedIds, toggleSelection, deselectAllOnPage, selectAllOnPage]
  );

  return (
    <div className="space-y-4">
      {selectedCount > 0 && (
        <BulkActionBar
          selectedCount={selectedCount}
          collection={undefined}
          onDelete={handleBulkDelete}
          onClear={clearSelection}
          itemLabel="plugin"
        />
      )}

      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="Search plugins..."
          className="w-full border-border bg-background text-foreground md:max-w-sm"
        />
        <div className="flex items-center gap-2">
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
        selection={selection}
        ariaLabel="Installed plugins table"
        emptyMessage={
          debouncedSearch
            ? "No plugins found matching your search."
            : "No plugins installed."
        }
      />
      {totalCount > 0 && (
        <Pagination
          currentPage={page}
          totalPages={Math.ceil(totalCount / pageSize)}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          totalItems={totalCount}
        />
      )}
    </div>
  );
}
