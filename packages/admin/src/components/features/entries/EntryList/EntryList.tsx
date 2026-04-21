/**
 * Entry List Container Component
 *
 * Main container component for displaying and managing collection entries.
 * Handles pagination, sorting, search, and bulk operations state management.
 *
 * @module components/entries/EntryList/EntryList
 * @see https://tanstack.com/query/v5/docs/react/guides/paginated-queries
 * @since 1.0.0
 */

import { Button } from "@revnixhq/ui";
import { ChevronRight, Home } from "lucide-react";
import { useSearchParams } from "next/navigation";
import React, { useState, useCallback, useMemo, useRef } from "react";

import { Code, Plus } from "@admin/components/icons";
import { Link } from "@admin/components/ui/link";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import { useEntries, useBulkDeleteEntries } from "@admin/hooks/queries";
import { useCollection } from "@admin/hooks/queries/useCollections";
import { useColumnVisibility } from "@admin/hooks/useColumnVisibility";
import { useEntryListShortcuts } from "@admin/hooks/useKeyboardShortcuts";
import { usePluginAutoRegistration } from "@admin/hooks/usePluginAutoRegistration";
import { navigateTo } from "@admin/lib/navigation";
import {
  getComponent,
  type InjectionPointProps,
} from "@admin/lib/plugins/component-registry";
import type { PaginatedDocs } from "@admin/services/entryApi";
import type { ApiCollection } from "@admin/types/entities";

import { BulkDeleteDialog } from "../BulkActions/BulkDeleteDialog";

import { EntryEmptyState } from "./EntryEmptyState";
import { buildEntryWhereFilter } from "./entryFilters";
import {
  EntryTable,
  type EntryTablePagination,
  type EntryTableRef,
} from "./EntryTable";
import {
  getAvailableColumns,
  getDefaultVisibleColumns,
  type CollectionForColumns,
} from "./EntryTableColumns";
import { EntryTableSkeleton } from "./EntryTableSkeleton";

// ============================================================================
// Types
// ============================================================================

/**
 * Props for the EntryList component.
 */
export interface EntryListProps {
  /** The collection slug/name to display entries for */
  collectionSlug: string;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Converts PaginatedDocs response to EntryTablePagination format.
 * Handles the 1-indexed to 0-indexed page conversion.
 */
function toTablePagination(
  response: PaginatedDocs | undefined,
  limit: number
): EntryTablePagination {
  if (!response) {
    return {
      page: 0,
      limit,
      total: 0,
      totalPages: 0,
    };
  }

  return {
    // Convert from 1-indexed (API) to 0-indexed (table)
    page: response.page - 1,
    limit: response.limit,
    total: response.totalDocs,
    totalPages: response.totalPages,
  };
}

/**
 * Creates a CollectionForColumns object from collection data.
 * Uses slug as fallback for labels.
 */
function toCollectionForColumns(
  collection:
    | {
        name: string;
        label?: string;
        schemaDefinition?: { fields: Array<{ name?: string; type?: string }> };
        fields?: Array<{ name?: string; type?: string }>;
        admin?: { defaultColumns?: string[]; useAsTitle?: string };
      }
    | undefined,
  slug: string
): CollectionForColumns {
  // Default collection structure when data is loading
  if (!collection) {
    return {
      slug,
      fields: [],
      admin: {},
    };
  }

  // Get fields from either new or old API format
  // schemaDefinition.fields is the legacy format from the API
  const rawFields =
    collection.schemaDefinition?.fields || collection.fields || [];
  const fields = rawFields as CollectionForColumns["fields"];

  // Determine default columns: use admin config or auto-generate from first few fields
  // Filter to only data fields (those with name property, excluding layout fields)
  const layoutTypes = [
    "tabs",
    "collapsible",
    "row",
    "ui",
    "group",
    "relationship",
    "repeater",
    "array",
    "blocks",
    "component",
  ];
  const dataFields = rawFields.filter(
    (f): f is { name: string; type: string } =>
      typeof f.name === "string" &&
      f.name.length > 0 &&
      typeof f.type === "string" &&
      !layoutTypes.includes(f.type)
  );

  const defaultColumns =
    collection.admin?.defaultColumns || dataFields.slice(0, 4).map(f => f.name);

  const labels = getCollectionLabels(collection, slug);

  return {
    slug,
    label: labels.plural,
    fields,
    admin: {
      useAsTitle: collection.admin?.useAsTitle,
      defaultColumns: [
        "title",
        ...defaultColumns.filter(
          c => c !== "title" && c !== "slug" && c !== "updatedAt"
        ),
        "slug",
        "updatedAt",
      ],
    },
  };
}

/**
 * Gets display labels for the collection.
 */
function getCollectionLabels(
  collection: { label?: string; name?: string } | undefined,
  slug: string
): { singular: string; plural: string } {
  const displayName = collection?.label || collection?.name || slug;

  // Simple pluralization: add 's' if doesn't already end with 's'
  const plural = displayName.endsWith("s") ? displayName : `${displayName}s`;

  return {
    singular: displayName,
    plural,
  };
}

// ============================================================================
// Component
// ============================================================================

/**
 * Entry list container with pagination, sorting, search, and bulk operations.
 *
 * Features:
 * - Fetches and displays entries for a collection
 * - Server-side pagination, sorting, and search
 * - Bulk delete operations with confirmation
 * - Empty state when no entries exist
 * - Loading states during data fetches
 * - Navigation to create/edit pages
 *
 * @param props - Entry list props
 * @returns Entry list container component
 *
 * @example
 * ```tsx
 * // In a page component
 * function CollectionEntriesPage() {
 *   const { slug } = useParams<{ slug: string }>();
 *   return <EntryList collectionSlug={slug!} />;
 * }
 * ```
 */
export function EntryList({ collectionSlug }: EntryListProps) {
  // ---------------------------------------------------------------------------
  // Refs
  // ---------------------------------------------------------------------------

  const tableRef = useRef<EntryTableRef>(null);

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  const [page, setPage] = useState(1); // 1-indexed for API
  const [limit, setLimit] = useState(25);
  const [sort, setSort] = useState<string | undefined>("-createdAt"); // Default: newest entries first
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [updatedFrom, setUpdatedFrom] = useState("");
  const [updatedTo, setUpdatedTo] = useState("");

  // Read where parameter from URL for filtering (e.g., from SubmissionsFilter)
  const searchParams = useSearchParams();
  const whereParam = searchParams.get("where");

  const whereFilter = useMemo(() => {
    return buildEntryWhereFilter({
      whereParam,
      status,
      createdFrom,
      createdTo,
      updatedFrom,
      updatedTo,
    });
  }, [whereParam, status, createdFrom, createdTo, updatedFrom, updatedTo]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedForDelete, setSelectedForDelete] = useState<string[]>([]);
  const [hasSelection, setHasSelection] = useState(false);

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  // Fetch collection metadata
  const { data: collection, isLoading: collectionLoading } =
    useCollection(collectionSlug);

  // Auto-register plugin components when collection is loaded
  // This ensures components like BeforeListTable are registered before rendering
  const collectionsForRegistration = useMemo<ApiCollection[]>(
    () => (collection ? [collection as unknown as ApiCollection] : []),
    [collection]
  );
  usePluginAutoRegistration(collectionsForRegistration);

  // Fetch entries with pagination and filters
  const { data: entriesResponse, isLoading: entriesLoading } = useEntries({
    collectionSlug,
    params: {
      page,
      limit,
      sort,
      search: search || undefined,
      where: whereFilter,
    },
  });

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  // Bulk delete mutation
  const bulkDelete = useBulkDeleteEntries({
    collectionSlug,
    onSuccess: () => {
      setDeleteDialogOpen(false);
      setSelectedForDelete([]);
    },
  });

  // ---------------------------------------------------------------------------
  // Derived Data
  // ---------------------------------------------------------------------------

  const collectionForColumns = useMemo(
    () => toCollectionForColumns(collection, collectionSlug),
    [collection, collectionSlug]
  );

  // ---------------------------------------------------------------------------
  // Column Visibility
  // ---------------------------------------------------------------------------

  // Get available and default columns from collection config
  const availableColumns = useMemo(
    () => getAvailableColumns(collectionForColumns),
    [collectionForColumns]
  );

  const defaultVisibleColumns = useMemo(
    () => getDefaultVisibleColumns(collectionForColumns),
    [collectionForColumns]
  );

  // Use column visibility hook with localStorage persistence
  const {
    columnVisibility,
    onColumnVisibilityChange,
    resetToDefault: resetColumnVisibility,
  } = useColumnVisibility({
    collectionSlug,
    availableColumns,
    defaultVisible: defaultVisibleColumns,
  });

  // ---------------------------------------------------------------------------
  // Query Presets
  // ---------------------------------------------------------------------------

  const labels = useMemo(
    () => getCollectionLabels(collection, collectionSlug),
    [collection, collectionSlug]
  );

  const entries = entriesResponse?.docs ?? [];
  const pagination = toTablePagination(entriesResponse, limit);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleEdit = useCallback(
    (entryId: string) => {
      navigateTo(
        buildRoute(ROUTES.COLLECTION_ENTRY_EDIT, {
          slug: collectionSlug,
          id: entryId,
        })
      );
    },
    [collectionSlug]
  );

  const handleDelete = useCallback((entryId: string) => {
    setSelectedForDelete([entryId]);
    setDeleteDialogOpen(true);
  }, []);

  const handleBulkDelete = useCallback((entryIds: string[]) => {
    setSelectedForDelete(entryIds);
    setDeleteDialogOpen(true);
  }, []);

  const handleConfirmDelete = useCallback(() => {
    bulkDelete.mutate(selectedForDelete, undefined);
  }, [bulkDelete, selectedForDelete]);

  const handlePageChange = useCallback((newPage: number) => {
    // Convert from 0-indexed (table) to 1-indexed (API)
    setPage(newPage + 1);
  }, []);

  const handleLimitChange = useCallback((newLimit: number) => {
    setLimit(newLimit);
    setPage(1); // Reset to first page when limit changes
  }, []);

  const handleSortChange = useCallback(
    (field: string, order: "asc" | "desc") => {
      // Sort format: -field for desc, field for asc
      const sortValue = order === "desc" ? `-${field}` : field;
      setSort(sortValue);
      setPage(1); // Reset to first page on sort change
    },
    []
  );

  const handleSearchChange = useCallback((newSearch: string) => {
    setSearch(newSearch);
    setPage(1); // Reset to first page on search
  }, []);

  const handleStatusChange = useCallback((newStatus: string) => {
    setStatus(newStatus);
    setPage(1); // Reset to first page on status change
  }, []);

  const handleCreatedFromChange = useCallback((value: string) => {
    setCreatedFrom(value);
    setPage(1);
  }, []);

  const handleCreatedToChange = useCallback((value: string) => {
    setCreatedTo(value);
    setPage(1);
  }, []);

  const handleUpdatedFromChange = useCallback((value: string) => {
    setUpdatedFrom(value);
    setPage(1);
  }, []);

  const handleUpdatedToChange = useCallback((value: string) => {
    setUpdatedTo(value);
    setPage(1);
  }, []);

  const handleCreateClick = useCallback(() => {
    navigateTo(
      buildRoute(ROUTES.COLLECTION_ENTRY_CREATE, { slug: collectionSlug })
    );
  }, [collectionSlug]);

  const handleApiPlaygroundClick = useCallback(() => {
    navigateTo(
      buildRoute(ROUTES.COLLECTION_ENTRY_API, { slug: collectionSlug })
    );
  }, [collectionSlug]);

  const handleFocusSearch = useCallback(() => {
    // Focus the search input using data attribute
    const searchInput = document.querySelector<HTMLInputElement>(
      "[data-entry-search-input]"
    );
    searchInput?.focus();
  }, []);

  const handleSelectAll = useCallback(() => {
    tableRef.current?.selectAll();
  }, []);

  const handleDeleteSelected = useCallback(() => {
    const selectedIds = tableRef.current?.getSelectedIds() ?? [];
    if (selectedIds.length > 0) {
      setSelectedForDelete(selectedIds);
      setDeleteDialogOpen(true);
    }
  }, []);

  const handleSelectionChange = useCallback((selectedIds: string[]) => {
    setHasSelection(selectedIds.length > 0);
  }, []);

  // ---------------------------------------------------------------------------
  // Keyboard Shortcuts
  // ---------------------------------------------------------------------------

  useEntryListShortcuts({
    onNew: handleCreateClick,
    onSearch: handleFocusSearch,
    onSelectAll: handleSelectAll,
    onDelete: handleDeleteSelected,
    hasSelection,
  });

  // ---------------------------------------------------------------------------
  // Loading State
  // ---------------------------------------------------------------------------

  // Show skeleton while collection is loading
  if (collectionLoading) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <div className="h-8 w-48 animate-pulse rounded bg-muted" />
            <div className="h-4 w-64 animate-pulse rounded bg-muted" />
          </div>
          <div className="h-10 w-32 animate-pulse rounded bg-muted" />
        </div>
        <EntryTableSkeleton />
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Custom Components from Plugins
  // ---------------------------------------------------------------------------

  // Resolve BeforeListTable injection component if configured
  const beforeListTablePath = collection?.admin?.components?.BeforeListTable;
  const BeforeListTable = beforeListTablePath
    ? getComponent(beforeListTablePath)
    : undefined;

  // Props for injection point components
  const injectionPointProps: InjectionPointProps = {
    collectionSlug,
    collection: collection as unknown as Record<string, unknown>,
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4">
      {/* Breadcrumbs */}
      <nav aria-label="Breadcrumb" className="-mb-2">
        <ol className="flex items-center gap-2 text-sm text-muted-foreground">
          <li className="flex items-center gap-2">
            <Link
              href={ROUTES.DASHBOARD}
              className="flex items-center gap-1 hover:text-foreground transition-colors"
            >
              <Home className="h-4 w-4" />
              <span>Dashboard</span>
            </Link>
            <ChevronRight className="h-4 w-4" />
          </li>
          <li className="text-foreground font-medium">{labels.plural}</li>
        </ol>
      </nav>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">{labels.plural}</h1>
          {collection?.description && (
            <p className="text-muted-foreground text-sm">
              {collection.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Button
            variant="outline"
            onClick={handleApiPlaygroundClick}
            className="flex-1 sm:flex-initial hover-unified"
          >
            <Code className="mr-2 h-4 w-4" />
            API
          </Button>
          <Button
            onClick={handleCreateClick}
            className="flex-1 sm:flex-initial hover-unified"
          >
            <Plus className="mr-2 h-4 w-4" />
            New {labels.singular}
          </Button>
        </div>
      </div>

      {/* BeforeListTable injection point */}
      {BeforeListTable && <BeforeListTable {...injectionPointProps} />}

      {/* Content */}
      {entries.length === 0 && !entriesLoading && !search ? (
        <EntryEmptyState
          collectionName={labels.plural}
          singularName={labels.singular}
          onCreateClick={handleCreateClick}
        />
      ) : (
        <EntryTable
          ref={tableRef}
          collection={collectionForColumns}
          entries={entries}
          pagination={pagination}
          isLoading={entriesLoading}
          currentSort={sort}
          onPageChange={handlePageChange}
          onLimitChange={handleLimitChange}
          onSortChange={handleSortChange}
          onSearchChange={handleSearchChange}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onBulkDelete={handleBulkDelete}
          onSelectionChange={handleSelectionChange}
          status={status}
          onStatusChange={handleStatusChange}
          createdFrom={createdFrom}
          createdTo={createdTo}
          updatedFrom={updatedFrom}
          updatedTo={updatedTo}
          onCreatedFromChange={handleCreatedFromChange}
          onCreatedToChange={handleCreatedToChange}
          onUpdatedFromChange={handleUpdatedFromChange}
          onUpdatedToChange={handleUpdatedToChange}
          columnVisibility={columnVisibility}
          onColumnVisibilityChange={onColumnVisibilityChange}
          onResetColumnVisibility={resetColumnVisibility}
        />
      )}

      {/* Bulk Delete Confirmation Dialog */}
      <BulkDeleteDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        count={selectedForDelete.length}
        collectionName={labels.plural}
        onConfirm={handleConfirmDelete}
        isLoading={bulkDelete.isPending}
      />
    </div>
  );
}
