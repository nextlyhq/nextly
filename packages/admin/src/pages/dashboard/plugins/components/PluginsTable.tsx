"use client";

import type { Column } from "@revnixhq/ui";
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  ResponsiveTable,
} from "@revnixhq/ui";
import { useSuspenseQuery } from "@tanstack/react-query";
import type React from "react";
import { useCallback, useMemo, useState } from "react";

import { BulkActionBar } from "@admin/components/features/entries/EntryList/BulkActionBar";
import * as Icons from "@admin/components/icons";
import { Columns, Package } from "@admin/components/icons";
import { BulkSelectCheckbox } from "@admin/components/shared/bulk-select-checkbox";
import { Pagination } from "@admin/components/shared/pagination";
import { SearchBar } from "@admin/components/shared/search-bar";
import { toast } from "@admin/components/ui";
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

/**
 * PluginsTable Component
 *
 * Displays a responsive table/card view of installed plugins with search, selection, and pagination.
 * Follows the standard table pattern used across the admin dashboard.
 */
export default function PluginsTable() {
  const { data: branding } = useSuspenseQuery<AdminBranding>({
    queryKey: ["admin-meta"],
    queryFn: () => publicApi.get<AdminBranding>("/admin-meta"),
    staleTime: 5 * 60 * 1000,
  });

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, UI.SEARCH_DEBOUNCE_MS);

  // Pagination state
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
    let result = pluginsWithId;
    if (debouncedSearch) {
      const query = debouncedSearch.toLowerCase();
      result = result.filter(
        plugin =>
          plugin.name.toLowerCase().includes(query) ||
          plugin.appearance?.label?.toLowerCase().includes(query) ||
          plugin.description?.toLowerCase().includes(query)
      );
    }
    return result;
  }, [pluginsWithId, debouncedSearch]);

  const totalCount = filteredPlugins.length;

  const paginatedPlugins = useMemo(() => {
    const start = page * pageSize;
    return filteredPlugins.slice(start, start + pageSize);
  }, [filteredPlugins, page, pageSize]);

  const {
    selectedCount,
    toggleSelection,
    selectAllOnPage,
    deselectAllOnPage,
    clearSelection,
    isSelected,
    getSelectedCountOnPage,
  } = useRowSelection();

  const toggleColumn = useCallback((key: string) => {
    setHiddenColumns(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const pagePluginIds = useMemo(
    () => paginatedPlugins.map(p => p.id),
    [paginatedPlugins]
  );
  const selectedOnPage = getSelectedCountOnPage(pagePluginIds);
  const selectAllCheckboxState: boolean | "indeterminate" =
    selectedOnPage === 0
      ? false
      : selectedOnPage === pagePluginIds.length
        ? true
        : "indeterminate";

  const handleToggleSelectAllOnPage = useCallback(() => {
    if (selectedOnPage === pagePluginIds.length) {
      deselectAllOnPage(pagePluginIds);
    } else {
      selectAllOnPage(pagePluginIds);
    }
  }, [selectedOnPage, pagePluginIds, deselectAllOnPage, selectAllOnPage]);

  const handleBulkDelete = useCallback(() => {
    toast.info("Bulk delete is not available for plugins yet.");
  }, []);

  const columnDefs: Column<PluginWithId>[] = useMemo(() => {
    const conversion = (v: unknown): string =>
      typeof v === "string" ? v : "—";

    return [
      {
        key: "select" as keyof PluginWithId,
        label: (
          <BulkSelectCheckbox
            checked={selectAllCheckboxState}
            onCheckedChange={handleToggleSelectAllOnPage}
            rowId="select-all"
            rowLabel="Select all plugins on page"
          />
        ),
        hideLabelOnMobile: true,
        render: (_, plugin) => (
          <BulkSelectCheckbox
            checked={isSelected(plugin.id)}
            onCheckedChange={() => toggleSelection(plugin.id)}
            rowId={plugin.id}
            rowLabel={plugin.name}
          />
        ),
      },
      {
        key: "name",
        label: "NAME",
        render: (_: unknown, plugin: PluginWithId) => {
          const iconName = plugin.appearance?.icon || "Package";
          const IconComponent =
            (Icons as Record<string, React.ElementType>)[iconName] || Package;

          return (
            <div className="flex items-center gap-3">
              <div className="table-row-icon-cover">
                <IconComponent className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1 flex flex-col">
                <span className="font-medium text-sm text-foreground truncate text-left cursor-pointer">
                  {plugin.appearance?.label ?? plugin.name}
                </span>
                {plugin.description && (
                  <span className="text-xs text-muted-foreground truncate">
                    {plugin.description}
                  </span>
                )}
              </div>
            </div>
          );
        },
      },
      {
        key: "version",
        label: "VERSION",
        render: (version: unknown) => (
          <span className="text-muted-foreground text-sm font-mono">
            {conversion(version)}
          </span>
        ),
      },
      {
        key: "placement",
        label: "PLACEMENT",
        render: (placement: unknown) => (
          <Badge
            variant="default"
            className="text-xs capitalize text-muted-foreground font-normal"
          >
            {PLACEMENT_LABELS[String(placement)] ?? String(placement)}
          </Badge>
        ),
      },
    ];
  }, [
    selectAllCheckboxState,
    handleToggleSelectAllOnPage,
    isSelected,
    toggleSelection,
  ]);

  const columns = useMemo(
    () =>
      columnDefs.filter(
        col =>
          col.key === ("select" as keyof PluginWithId) ||
          !hiddenColumns.has(String(col.key))
      ),
    [columnDefs, hiddenColumns]
  );

  return (
    <div className="space-y-4">
      {/* Bulk selection toolbar */}
      {selectedCount > 0 && (
        <BulkActionBar
          selectedCount={selectedCount}
          collection={undefined}
          onDelete={handleBulkDelete}
          onClear={clearSelection}
          itemLabel="plugin"
        />
      )}

      {/* Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="Search plugins..."
          className="w-full md:max-w-sm bg-background text-foreground border-primary/5"
        />
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="md"
                className="bg-background text-foreground border-primary/5 hover:bg-accent/10"
              >
                <Columns className="mr-2 h-4 w-4" />
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {columnDefs
                .filter(col => col.key !== ("select" as keyof PluginWithId))
                .map(col => (
                  <DropdownMenuCheckboxItem
                    key={String(col.key)}
                    checked={!hiddenColumns.has(String(col.key))}
                    onCheckedChange={() => toggleColumn(String(col.key))}
                  >
                    {col.label}
                  </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Boxed table and Pagination Card */}
      <div className="rounded-none  border border-primary/5 bg-card overflow-hidden">
        <ResponsiveTable
          data={paginatedPlugins}
          columns={columns}
          emptyMessage={
            debouncedSearch
              ? "No plugins found matching your search."
              : "No plugins installed."
          }
          ariaLabel="Installed plugins table"
          tableWrapperClassName="border-0 rounded-none shadow-none"
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
    </div>
  );
}
