"use client";

/**
 * Image Sizes Settings Page
 *
 * Manage named image sizes that are generated for every uploaded image.
 * Supports both code-defined sizes (read-only) and UI-created sizes.
 * Shows regeneration status when sizes change.
 */

import type {
  Column} from "@revnixhq/ui";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Label,
  ResponsiveTable,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TableSkeleton,
} from "@revnixhq/ui";
import * as React from "react";

import { SettingsLayout } from "@admin/components/features/settings/SettingsLayout";
import { Columns, Info, Plus } from "@admin/components/icons";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { Pagination } from "@admin/components/shared/pagination";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { SearchBar } from "@admin/components/shared/search-bar";
import { ActionColumn } from "@admin/components/ui/table/ActionColumn";
import { authFetch } from "@admin/lib/api/refreshInterceptor";

// ============================================================
// Types (matching the backend ImageSize interface)
// ============================================================

interface ImageSize {
  id: string;
  name: string;
  width: number | null;
  height: number | null;
  fit: string;
  quality: number;
  format: string;
  isDefault: boolean;
  sortOrder: number;
}

// ============================================================
// API helpers (Direct API calls to backend)
// ============================================================

async function fetchImageSizes(): Promise<ImageSize[]> {
  const res = await authFetch("/admin/api/image-sizes", {
    credentials: "include",
  });
  if (!res.ok) return [];
  const data = await res.json();
  // Phase 4 (post-merge follow-up): /admin/api/image-sizes emits
  // `respondList({ items, meta })` (spec section 5.1). Pre-Phase-4 the
  // legacy fallback `data.data ?? data` accommodated either `{data}` or
  // bare arrays. After Phase 4 we read `.items` first; legacy fallbacks
  // kept for one release as a transitional shim (parallels csrf and
  // pageSize -> limit transition shims).
  if (Array.isArray(data?.items)) return data.items as ImageSize[];
  if (Array.isArray(data?.data)) return data.data as ImageSize[];
  if (Array.isArray(data)) return data as ImageSize[];
  return [];
}

async function createImageSize(input: Partial<ImageSize>): Promise<void> {
  const res = await authFetch("/admin/api/image-sizes", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to create" }));
    throw new Error(err.error?.message ?? "Failed to create image size");
  }
}

async function updateImageSize(
  id: string,
  input: Partial<ImageSize>
): Promise<void> {
  const res = await authFetch(`/admin/api/image-sizes/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to update" }));
    throw new Error(err.error?.message ?? "Failed to update image size");
  }
}

async function deleteImageSize(id: string): Promise<void> {
  const res = await authFetch(`/admin/api/image-sizes/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to delete" }));
    throw new Error(err.error?.message ?? "Failed to delete image size");
  }
}

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
// Add/Edit Size Dialog
// ============================================================

function SizeFormDialog({
  open,
  onOpenChange,
  editingSize,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingSize: ImageSize | null;
  onSave: (data: Partial<ImageSize>) => Promise<void>;
}) {
  const [name, setName] = React.useState("");
  const [width, setWidth] = React.useState("");
  const [height, setHeight] = React.useState("");
  const [fit, setFit] = React.useState("inside");
  const [quality, setQuality] = React.useState("80");
  const [format, setFormat] = React.useState("auto");
  const [isSaving, setIsSaving] = React.useState(false);

  // Populate form when editing
  React.useEffect(() => {
    if (editingSize) {
      setName(editingSize.name);
      setWidth(editingSize.width?.toString() ?? "");
      setHeight(editingSize.height?.toString() ?? "");
      setFit(editingSize.fit);
      setQuality(editingSize.quality.toString());
      setFormat(editingSize.format);
    } else {
      setName("");
      setWidth("");
      setHeight("");
      setFit("inside");
      setQuality("80");
      setFormat("auto");
    }
  }, [editingSize, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || (!width && !height)) return;

    setIsSaving(true);
    try {
      await onSave({
        name: name.trim(),
        width: width ? parseInt(width) : null,
        height: height ? parseInt(height) : null,
        fit,
        quality: parseInt(quality) || 80,
        format,
      });
      onOpenChange(false);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {editingSize ? "Edit Image Size" : "Add Image Size"}
          </DialogTitle>
          <DialogDescription>
            {editingSize
              ? "Update this image size configuration."
              : "Create a new image size. It will be generated for every uploaded image."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-4">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="size-name">Name</Label>
            <Input
              id="size-name"
              placeholder="e.g., thumbnail, medium, large"
              value={name}
              onChange={e => setName(e.target.value)}
              required
              disabled={!!editingSize}
            />
            {!editingSize && (
              <p className="text-xs text-muted-foreground">
                Used as the key in the API response. Cannot be changed after
                creation.
              </p>
            )}
          </div>

          {/* Width + Height */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="size-width">Width (px)</Label>
              <Input
                id="size-width"
                type="number"
                placeholder="Auto"
                value={width}
                onChange={e => setWidth(e.target.value)}
                min={1}
                max={10000}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="size-height">Height (px)</Label>
              <Input
                id="size-height"
                type="number"
                placeholder="Auto"
                value={height}
                onChange={e => setHeight(e.target.value)}
                min={1}
                max={10000}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Leave one blank to keep aspect ratio. At least one dimension is
            required.
          </p>

          {/* Fit */}
          <div className="space-y-1.5">
            <Label>Resize Mode</Label>
            <Select value={fit} onValueChange={setFit}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="inside">
                  Fit (shrink to fit, no cropping)
                </SelectItem>
                <SelectItem value="cover">
                  Cover (crop to fill exact size)
                </SelectItem>
                <SelectItem value="contain">
                  Contain (fit with padding)
                </SelectItem>
                <SelectItem value="fill">Stretch (may distort)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Format + Quality */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Format</Label>
              <Select value={format} onValueChange={setFormat}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">
                    Auto (WebP when possible)
                  </SelectItem>
                  <SelectItem value="webp">WebP</SelectItem>
                  <SelectItem value="jpeg">JPEG</SelectItem>
                  <SelectItem value="png">PNG</SelectItem>
                  <SelectItem value="avif">AVIF</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="size-quality">Quality (%)</Label>
              <Input
                id="size-quality"
                type="number"
                value={quality}
                onChange={e => setQuality(e.target.value)}
                min={1}
                max={100}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSaving || !name.trim() || (!width && !height)}
            >
              {isSaving ? "Saving..." : editingSize ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Main Page Component
// ============================================================

function ImageSizesContent({
  search,
  setSearch,
  isFormOpen,
  setIsFormOpen,
  editingSize,
  setEditingSize,
}: {
  search: string;
  setSearch: (val: string) => void;
  isFormOpen: boolean;
  setIsFormOpen: (open: boolean) => void;
  editingSize: ImageSize | null;
  setEditingSize: (size: ImageSize | null) => void;
}) {
  const [sizes, setSizes] = React.useState<ImageSize[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [page, setPage] = React.useState(0);
  const [pageSize, setPageSize] = React.useState(10);
  const [hiddenColumns, setHiddenColumns] = React.useState<Set<string>>(new Set());

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

  // Handle create
  const handleCreate = React.useCallback(
    async (data: Partial<ImageSize>) => {
      await createImageSize(data);
      await loadSizes();
    },
    [loadSizes]
  );

  // Handle update
  const handleUpdate = React.useCallback(
    async (data: Partial<ImageSize>) => {
      if (!editingSize) return;
      await updateImageSize(editingSize.id, data);
      setEditingSize(null);
      await loadSizes();
    },
    [editingSize, setEditingSize, loadSizes]
  );

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

  // Handle edit
  const handleEdit = React.useCallback(
    (size: ImageSize) => {
      setEditingSize(size);
      setIsFormOpen(true);
    },
    [setEditingSize, setIsFormOpen]
  );

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
                onDelete: size.isDefault ? undefined : (item) => { void handleDelete(item); },
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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 w-full sm:w-auto">
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search image sizes..."
            className="flex-1 max-w-sm bg-white text-black border-primary/5"
            isLoading={isLoading}
          />
        </div>

        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 bg-white text-black border-primary/5 hover:bg-white/90">
                <Columns className="mr-2 h-4 w-4" />
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
        </div>
      </div>

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
                <div className="table-footer border-t border-primary/5 p-4 bg-[hsl(var(--table-header-bg))]">
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
                </div>
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

      {/* Add/Edit dialog */}
      <SizeFormDialog
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        editingSize={editingSize}
        onSave={editingSize ? handleUpdate : handleCreate}
      />
    </div>
  );
}

// ============================================================
// Page Export
// ============================================================

export default function ImageSizesSettingsPage() {
  const [isFormOpen, setIsFormOpen] = React.useState(false);
  const [editingSize, setEditingSize] = React.useState<ImageSize | null>(null);
  const [search, setSearch] = React.useState("");

  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer>
        <SettingsLayout
          actions={
            <Button
              onClick={() => {
                setEditingSize(null);
                setIsFormOpen(true);
              }}
              size="sm"
              className="flex items-center gap-1.5"
            >
              <Plus className="h-4 w-4" />
              <span>Add Size</span>
            </Button>
          }
        >
          <ImageSizesContent
            search={search}
            setSearch={setSearch}
            isFormOpen={isFormOpen}
            setIsFormOpen={setIsFormOpen}
            editingSize={editingSize}
            setEditingSize={setEditingSize}
          />
        </SettingsLayout>
      </PageContainer>
    </QueryErrorBoundary>
  );
}
