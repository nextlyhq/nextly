"use client";

/**
 * Image Sizes Settings Page
 *
 * Manage named image sizes that are generated for every uploaded image.
 * Supports both code-defined sizes (read-only) and UI-created sizes.
 * Shows regeneration status when sizes change.
 */

import { Alert, AlertDescription, Badge, Button } from "@nextlyhq/ui";
import * as React from "react";

import { SettingsLayout } from "@admin/components/features/settings";
import { Edit, Info, Plus, Trash2 } from "@admin/components/icons";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { Link } from "@admin/components/ui/link";
import type {
  NextlyColumn,
  RowAction,
} from "@admin/components/ui/table/data-table";
import {
  ListView,
  useTableColumns,
} from "@admin/components/ui/table/list-view";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import { usePagination } from "@admin/hooks/usePagination";
import { navigateTo } from "@admin/lib/navigation";
import {
  deleteImageSize,
  fetchImageProcessingAvailability,
  fetchImageSizes,
  type ImageProcessingAvailability,
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

/** Columns pinned as always-visible in the column toggle. */
const ALWAYS_VISIBLE = new Set(["name"]);

function ImageSizesContent({
  search,
  setSearch,
}: {
  search: string;
  setSearch: (val: string) => void;
}) {
  const [sizes, setSizes] = React.useState<ImageSize[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  // Starts as available so the page never accuses the server of a missing
  // package before it has heard back. Only a definite "no" renders the notice.
  const [imageProcessing, setImageProcessing] =
    React.useState<ImageProcessingAvailability>({ available: true });
  const { page, pageSize, setPage, setPageSize, resetPage } = usePagination();

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

  // Asked once on mount: whether the server can process images at all does not
  // change while the page is open, and the answer decides whether the sizes
  // listed below can ever be produced.
  React.useEffect(() => {
    void fetchImageProcessingAvailability().then(setImageProcessing);
  }, []);

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
    resetPage();
  }, [search, resetPage]);

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

  const allColumns = React.useMemo<NextlyColumn<ImageSize>[]>(
    () => [
      {
        name: "name",
        header: "NAME",
        cell: ({ row: size }) => (
          <div className="flex items-center gap-2">
            <span className="font-medium">{size.name}</span>
            {size.isDefault && (
              <Badge variant="default" className="h-4 px-1 text-xs">
                Config
              </Badge>
            )}
          </div>
        ),
      },
      {
        name: "width",
        header: "WIDTH",
        cell: ({ value }) => (
          <span className="text-muted-foreground">
            {typeof value === "number" ? value : "auto"}
          </span>
        ),
      },
      {
        name: "height",
        header: "HEIGHT",
        cell: ({ value }) => (
          <span className="text-muted-foreground">
            {typeof value === "number" ? value : "auto"}
          </span>
        ),
      },
      {
        name: "fit",
        header: "RESIZE",
        cell: ({ value }) => (
          <Badge variant="default" className="font-normal capitalize">
            {getFitShortLabel(String(value))}
          </Badge>
        ),
      },
      {
        name: "format",
        header: "FORMAT",
        cell: ({ value }) => (
          <span className="font-mono text-xs uppercase">{String(value)}</span>
        ),
      },
      {
        name: "quality",
        header: "QUALITY",
        cell: ({ value }) => (
          <span className="text-muted-foreground">{String(value)}%</span>
        ),
      },
    ],
    []
  );

  // Resolves persisted column visibility while ensuring the primary size name is always visible.
  const { columns, columnsControl } = useTableColumns({
    storageKey: "image-sizes",
    columns: allColumns,
    alwaysVisible: ALWAYS_VISIBLE,
  });

  const rowActions = React.useCallback(
    (size: ImageSize): RowAction<ImageSize>[] => {
      const actions: RowAction<ImageSize>[] = [
        {
          id: "edit",
          label: "Edit",
          icon: <Edit className="h-4 w-4" />,
          onSelect: () => handleEdit(size),
        },
      ];
      if (!size.isDefault) {
        actions.push({
          id: "delete",
          label: "Delete",
          icon: <Trash2 className="h-4 w-4" />,
          destructive: true,
          onSelect: () => void handleDelete(size),
        });
      }
      return actions;
    },
    [handleEdit, handleDelete]
  );

  return (
    <ListView<ImageSize>
      search={{
        value: search,
        onChange: setSearch,
        placeholder: "Search image sizes...",
        isLoading,
      }}
      columnsControl={columnsControl}
      slots={{
        // Above the toolbar rather than below the list: it explains why every
        // size on this page is inert, so it has to be read before them.
        beforeList: !imageProcessing.available && (
          <Alert variant="warning" className="mb-4">
            <AlertDescription>
              <p>
                This server cannot process images, so no sizes are generated.
                Existing uploads are unaffected and new uploads still succeed,
                they simply arrive without resized copies.
              </p>
              {imageProcessing.installCommand ? (
                <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-2">
                  <code className="font-mono text-xs">
                    {imageProcessing.installCommand}
                  </code>
                </pre>
              ) : null}
            </AlertDescription>
          </Alert>
        ),
        afterList: !isLoading && sizes.some(s => s.isDefault) && (
          <div className="flex items-start gap-2 text-xs text-muted-foreground px-1">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              Sizes marked as <strong>Config</strong> are defined in your
              nextly.config.ts and cannot be deleted here.
            </span>
          </div>
        ),
      }}
      columns={columns}
      rows={paginatedSizes}
      loading={isLoading}
      rowHref={size =>
        buildRoute(ROUTES.SETTINGS_IMAGE_SIZES_EDIT, { id: size.id })
      }
      primaryColumn="name"
      rowActions={rowActions}
      registryKey="image-sizes"
      ariaLabel="Image sizes table"
      emptyMessage={
        search
          ? "No image sizes found matching your search."
          : "No image sizes configured."
      }
      // The table owns the pager, so it is placed for whichever view is
      // showing. This list paginates in memory rather than
      // over the wire, so the gate counts the filtered rows: a search that
      // matches nothing should leave no controls behind.
      pagination={
        filteredSizes.length > 0
          ? {
              currentPage: page,
              totalPages: Math.max(
                1,
                Math.ceil(filteredSizes.length / pageSize)
              ),
              totalItems: filteredSizes.length,
              pageSize,
              onPageChange: setPage,
              onPageSizeChange: setPageSize,
              isLoading,
            }
          : undefined
      }
    />
  );
}

// ============================================================
// Page Export
// ============================================================

export default function ImageSizesSettingsPage() {
  const [search, setSearch] = React.useState("");

  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer width="wide">
        <SettingsLayout
          title="Image Sizes"
          description="Configure image sizes generated for uploaded images"
          crumb="Image Sizes"
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
