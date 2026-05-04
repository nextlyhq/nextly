"use client";

/**
 * Image Sizes Settings Page
 *
 * Manage named image sizes that are generated for every uploaded image.
 * Supports both code-defined sizes (read-only) and UI-created sizes.
 * Shows regeneration status when sizes change.
 */

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
  TableSkeleton,
} from "@revnixhq/ui";
import * as React from "react";

import {
  SettingsLayout,
  SettingsTableToolbar,
} from "@admin/components/features/settings";
import { Columns, Info, Plus } from "@admin/components/icons";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { Pagination } from "@admin/components/shared/pagination";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { SearchBar } from "@admin/components/shared/search-bar";
import { Link } from "@admin/components/ui/link";
import { ActionColumn } from "@admin/components/ui/table/ActionColumn";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import { navigateTo } from "@admin/lib/navigation";
import {
  deleteImageSize,
  fetchImageSizes,
  type ImageSize,
} from "@admin/services/imageSizesApi";

// ============================================================
// Fit mode display labels
// ============================================================

function getFitShortLabel(fit: string): string {
  switch (fit) {
    case "cover":
      return "Cover";
    case "inside":
      return "Fit";
    case "contain":
      return "Contain";
    case "fill":
      return "Stretch";
    default:
      return fit;
  }
}

// ============================================================
// Main Page Component
// ============================================================

function ImageSizesContent({
  search,
  setSearch,
}: {
  search: string;
  setSearch: (val: string) => void;
}) {
  const [sizes, setSizes] = React.useState<ImageSize[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [page, setPage] = React.useState(0);
  const [pageSize, setPageSize] = React.useState(10);
  const [hiddenColumns, setHiddenColumns] = React.useState<Set<string>>(
    new Set()
  );

  const toggleColumn = (key: string) => {
    setHiddenColumns(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // Fetch sizes on mount
  const loadSizes = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await fetchImageSizes();
      setSizes(data);
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadSizes();
  }, [loadSizes]);

  // Handle delete
  const handleDelete = React.useCallback(
    async (size: ImageSize) => {
      if (
        !window.confirm(
          `Are you sure you want to delete the "${size.name}" image size?`
        )
      ) {
        return;
      }
      try {
        await deleteImageSize(size.id);
        await loadSizes();
      } catch (error) {
        console.error("Failed to delete image size:", error);
      }
    },
    [loadSizes]
  );

  // Handle pagination (reset to first page on search)
  React.useEffect(() => {
    setPage(0);
  }, [search]);

  // Filtered sizes based on search
  const filteredSizes = React.useMemo(() => {
    if (!search.trim()) return sizes;
    const s = search.toLowerCase();
    return sizes.filter(size => size.name.toLowerCase().includes(s));
  }, [sizes, search]);

  // Paginated sizes
  const paginatedSizes = React.useMemo(() => {
    const start = page * pageSize;
    return filteredSizes.slice(start, start + pageSize);
  }, [filteredSizes, page, pageSize]);

  // Handle edit — navigate to dedicated edit page
  const handleEdit = React.useCallback((size: ImageSize) => {
    navigateTo(buildRoute(ROUTES.SETTINGS_IMAGE_SIZES_EDIT, { id: size.id }));
  }, []);

  // Columns definition for ResponsiveTable
  const ALWAYS_VISIBLE = new Set(["id", "name"]);

  const columnDefs: Column<ImageSize>[] = React.useMemo(
    () => [
      {
        key: "name",
        label: "NAME",
        render: (value, size) => (
          <div className="flex items-center gap-2">
            <span className="font-medium">{String(value)}</span>
            {size.isDefault && (
              <Badge variant="default" className="text-[10px] h-4 px-1">
                Config
              </Badge>
            )}
          </div>
        ),
      },
      {
        key: "width",
        label: "WIDTH",
        render: value => (
          <span className="text-muted-foreground">{value ?? "auto"}</span>
        ),
      },
      {
        key: "height",
        label: "HEIGHT",
        render: value => (
          <span className="text-muted-foreground">{value ?? "auto"}</span>
        ),
      },
      {
        key: "fit",
        label: "RESIZE",
        render: value => (
          <Badge variant="default" className="font-normal capitalize">
            {getFitShortLabel(String(value))}
          </Badge>
        ),
      },
      {
        key: "format",
        label: "FORMAT",
        render: value => (
          <span className="uppercase text-xs font-mono">{String(value)}</span>
        ),
      },
      {
        key: "quality",
        label: "QUALITY",
        render: value => (
          <span className="text-muted-foreground">{String(value)}%</span>
        ),
      },
      {
        key: "id",
        label: "ACTIONS",
        render: (_, size) => (
          <div className="flex justify-start">
            <ActionColumn
              item={size}
              callbacks={{
                onEdit: handleEdit,
                onDelete: size.isDefault
                  ? undefined
                  : item => {
                      void handleDelete(item);
                    },
              }}
            />
          </div>
        ),
      },
    ],
    [handleEdit, handleDelete]
  );

  const columns = React.useMemo(
    () => columnDefs.filter(col => !hiddenColumns.has(String(col.key))),
    [columnDefs, hiddenColumns]
  );

  const toggleableColumns = columnDefs.filter(
    col => !ALWAYS_VISIBLE.has(String(col.key))
  );

  return (
    <div className="space-y-4">
      {/* Search Bar & Columns Filter */}
      <SettingsTableToolbar
        search={
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search image sizes..."
            className="w-full bg-background text-foreground border-input"
            isLoading={isLoading}
          />
        }
        columns={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="md" className="bg-background">
                <Columns className="h-4 w-4" />
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {toggleableColumns.map(col => (
                <DropdownMenuCheckboxItem
                  key={String(col.key)}
                  checked={!hiddenColumns.has(String(col.key))}
                  onCheckedChange={() => toggleColumn(String(col.key))}
                >
                  {typeof col.label === "string" ? col.label : String(col.key)}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      {/* Table Wrapper */}
      <div className="table-wrapper rounded-none  border border-primary/5 bg-card overflow-hidden">
        {isLoading ? (
          <TableSkeleton columns={7} rowCount={pageSize} />
        ) : (
          <ResponsiveTable
            data={paginatedSizes}
            columns={columns}
            emptyMessage={
              search
                ? "No image sizes found matching your search."
                : "No image sizes configured."
            }
            ariaLabel="Image sizes table"
            tableWrapperClassName="border-0 rounded-none shadow-none"
            footer={
              (filteredSizes.length > 0 || isLoading) && (
                <Pagination
                  currentPage={page}
                  totalPages={Math.max(
                    1,
                    Math.ceil(filteredSizes.length / pageSize)
                  )}
                  totalItems={filteredSizes.length}
                  pageSize={pageSize}
                  onPageChange={setPage}
                  onPageSizeChange={setPageSize}
                  isLoading={isLoading}
                />
              )
            }
          />
        )}
      </div>

      {/* Info note about code-defined sizes */}
      {!isLoading && sizes.some(s => s.isDefault) && (
        <div className="flex items-start gap-2 text-xs text-muted-foreground px-1">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            Sizes marked as <strong>Config</strong> are defined in your
            nextly.config.ts and cannot be deleted here.
          </span>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Page Export
// ============================================================

export default function ImageSizesSettingsPage() {
  const [search, setSearch] = React.useState("");

  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer>
        <SettingsLayout
          actions={
            <Link href={ROUTES.SETTINGS_IMAGE_SIZES_CREATE}>
              <Button size="md" className="flex items-center gap-1.5">
                <Plus className="h-4 w-4" />
                <span>Add Size</span>
              </Button>
            </Link>
          }
        >
          <ImageSizesContent search={search} setSearch={setSearch} />
        </SettingsLayout>
      </PageContainer>
    </QueryErrorBoundary>
  );
}
