"use client";

/**
 * UploadEditor Component
 *
 * Editor for configuring upload field settings.
 * Features:
 * - Media collection(s) selector (single or polymorphic)
 * - hasMany toggle for multiple file uploads
 * - MIME type filter with categories (Images, Videos, Documents, Audio, Custom)
 * - Max file size input with unit selector (KB, MB, GB)
 * - Admin options (allowCreate, allowEdit, isSortable, displayPreview)
 *
 * @module components/features/schema-builder/UploadEditor
 */

import {
  Badge,
  Button,
  Checkbox,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@revnixhq/ui";
import { useState, useCallback, useMemo } from "react";

import * as Icons from "@admin/components/icons";
import { FormLabelWithTooltip } from "@admin/components/ui/form-label-with-tooltip";
import { useCollections } from "@admin/hooks/queries";

import type {
  UploadEditorProps,
  MimeTypeCategory,
  FileSizeUnit,
} from "./types";
import {
  MIME_TYPE_CATEGORIES,
  FILE_SIZE_UNITS,
  getMimePatternFromCategory,
  getCategoryFromMimePattern,
  convertToBytes,
  convertFromBytes,
} from "./types";

// ============================================================
// UploadEditor Component
// ============================================================

export function UploadEditor({
  relationTo,
  onRelationToChange,
  hasMany,
  onHasManyChange,
  mimeTypes,
  onMimeTypesChange,
  maxFileSize,
  onMaxFileSizeChange,
  allowCreate,
  onAllowCreateChange,
  allowEdit,
  onAllowEditChange,
  isSortable,
  onIsSortableChange,
  displayPreview,
  onDisplayPreviewChange,
}: UploadEditorProps) {
  const [isCollectionPickerOpen, setIsCollectionPickerOpen] = useState(false);
  const [collectionSearch, setCollectionSearch] = useState("");
  const [customMimeType, setCustomMimeType] = useState("");

  // Local state for file size with unit
  const [fileSizeValue, setFileSizeValue] = useState<string>(() => {
    if (!maxFileSize) return "";
    const { value } = convertFromBytes(maxFileSize);
    return String(value);
  });
  const [fileSizeUnit, setFileSizeUnit] = useState<FileSizeUnit>(() => {
    if (!maxFileSize) return "MB";
    const { unit } = convertFromBytes(maxFileSize);
    return unit;
  });

  // Fetch available collections (only upload-enabled ones ideally)
  const { data: collectionsData, isLoading: isLoadingCollections } =
    useCollections({
      pagination: { page: 0, pageSize: 100 },
      sorting: [{ field: "name", direction: "asc" }],
      filters: {},
    });

  // Get available collections for the picker
  const availableCollections = useMemo(() => {
    if (!collectionsData?.data) return [];
    return collectionsData.data.map(col => ({
      slug: col.name,
      label: col.label || col.name,
    }));
  }, [collectionsData]);

  // Filter collections by search
  const filteredCollections = useMemo(() => {
    if (!collectionSearch) return availableCollections;
    const search = collectionSearch.toLowerCase();
    return availableCollections.filter(
      col =>
        col.slug.toLowerCase().includes(search) ||
        col.label.toLowerCase().includes(search)
    );
  }, [availableCollections, collectionSearch]);

  // Convert relationTo to array for easier handling
  const selectedCollections = useMemo(() => {
    if (!relationTo) return [];
    return Array.isArray(relationTo) ? relationTo : [relationTo];
  }, [relationTo]);

  // Determine current MIME type category
  const currentMimeCategory = useMemo(() => {
    return getCategoryFromMimePattern(mimeTypes);
  }, [mimeTypes]);

  // Handle collection selection toggle
  const handleCollectionToggle = useCallback(
    (slug: string) => {
      const isSelected = selectedCollections.includes(slug);

      if (isSelected) {
        // Remove collection
        const newSelected = selectedCollections.filter(s => s !== slug);
        if (newSelected.length === 0) {
          onRelationToChange(undefined);
        } else if (newSelected.length === 1) {
          onRelationToChange(newSelected[0]);
        } else {
          onRelationToChange(newSelected);
        }
      } else {
        // Add collection
        const newSelected = [...selectedCollections, slug];
        if (newSelected.length === 1) {
          onRelationToChange(newSelected[0]);
        } else {
          onRelationToChange(newSelected);
        }
      }
    },
    [selectedCollections, onRelationToChange]
  );

  // Handle removing a collection badge
  const handleRemoveCollection = useCallback(
    (slug: string) => {
      handleCollectionToggle(slug);
    },
    [handleCollectionToggle]
  );

  // Handle MIME type category change
  const handleMimeCategoryChange = useCallback(
    (category: MimeTypeCategory) => {
      if (category === "custom") {
        // Keep existing custom value or empty
        onMimeTypesChange?.(customMimeType || undefined);
      } else {
        const pattern = getMimePatternFromCategory(category);
        onMimeTypesChange?.(pattern);
      }
    },
    [onMimeTypesChange, customMimeType]
  );

  // Handle custom MIME type input
  const handleCustomMimeTypeChange = useCallback(
    (value: string) => {
      setCustomMimeType(value);
      onMimeTypesChange?.(value || undefined);
    },
    [onMimeTypesChange]
  );

  // Handle file size change
  const handleFileSizeValueChange = useCallback(
    (value: string) => {
      setFileSizeValue(value);
      if (!value) {
        onMaxFileSizeChange?.(undefined);
      } else {
        const numValue = parseFloat(value);
        if (!isNaN(numValue) && numValue > 0) {
          const bytes = convertToBytes(numValue, fileSizeUnit);
          onMaxFileSizeChange?.(bytes);
        }
      }
    },
    [fileSizeUnit, onMaxFileSizeChange]
  );

  // Handle file size unit change
  const handleFileSizeUnitChange = useCallback(
    (unit: FileSizeUnit) => {
      setFileSizeUnit(unit);
      if (fileSizeValue) {
        const numValue = parseFloat(fileSizeValue);
        if (!isNaN(numValue) && numValue > 0) {
          const bytes = convertToBytes(numValue, unit);
          onMaxFileSizeChange?.(bytes);
        }
      }
    },
    [fileSizeValue, onMaxFileSizeChange]
  );

  return (
    <div className="space-y-4">
      {/* Section Header */}
      <div className="flex items-center gap-2">
        <Icons.Upload className="h-4 w-4 text-muted-foreground" />
        <Label className="text-xs font-medium">Upload Configuration</Label>
      </div>

      {/* Target Collections */}
      <div className="space-y-2">
        <FormLabelWithTooltip
          className="text-xs font-medium"
          label="Media Collection(s)"
          description={
            selectedCollections.length > 1
              ? "Polymorphic upload - can reference multiple media collections"
              : "Select the upload collection this field will reference"
          }
        />
        <div className="space-y-2">
          {/* Selected Collections Badges */}
          {selectedCollections.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selectedCollections.map(slug => {
                const collection = availableCollections.find(
                  c => c.slug === slug
                );
                return (
                  <Badge
                    key={slug}
                    variant="default"
                    className="flex items-center gap-1 pr-1"
                  >
                    <span className="text-xs">{collection?.label || slug}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveCollection(slug)}
                      className="ml-0.5 rounded-none p-0.5 hover-subtle-row"
                    >
                      <Icons.X className="h-3 w-3" />
                    </button>
                  </Badge>
                );
              })}
            </div>
          )}

          {/* Collection Picker */}
          <Popover
            open={isCollectionPickerOpen}
            onOpenChange={setIsCollectionPickerOpen}
          >
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full justify-start text-xs h-8"
              >
                <Icons.Plus className="h-3 w-3 mr-1.5" />
                {selectedCollections.length === 0
                  ? "Select media collection(s)"
                  : "Add another collection"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-0" align="start">
              <div className="p-2 border-b border-border">
                <div className="relative">
                  <Icons.Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={collectionSearch}
                    onChange={e => setCollectionSearch(e.target.value)}
                    placeholder="Search collections..."
                    className="h-7 pl-7 text-xs"
                  />
                </div>
              </div>
              <div className="max-h-48 overflow-y-auto p-1">
                {isLoadingCollections ? (
                  <div className="flex items-center justify-center py-4">
                    <Icons.Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                ) : filteredCollections.length === 0 ? (
                  <div className="py-4 text-center text-xs text-muted-foreground">
                    {collectionSearch
                      ? "No collections found"
                      : "No collections available"}
                  </div>
                ) : (
                  filteredCollections.map(collection => {
                    const isSelected = selectedCollections.includes(
                      collection.slug
                    );
                    return (
                      <button
                        key={collection.slug}
                        type="button"
                        onClick={() => handleCollectionToggle(collection.slug)}
                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-none text-left hover-subtle-row transition-colors"
                      >
                        <Checkbox
                          checked={isSelected}
                          className="h-3.5 w-3.5"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium truncate">
                            {collection.label}
                          </div>
                          {collection.label !== collection.slug && (
                            <div className="text-[10px] text-muted-foreground truncate">
                              {collection.slug}
                            </div>
                          )}
                        </div>
                        {isSelected && (
                          <Icons.Check className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Upload Options */}
      <div className="space-y-3 pt-2 border-t border-border">
        {/* Has Many Toggle */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <FormLabelWithTooltip
              className="text-sm font-medium"
              label="Allow Multiple"
              description="Upload multiple files"
            />
          </div>
          <Switch
            checked={hasMany || false}
            onCheckedChange={onHasManyChange}
          />
        </div>
      </div>

      {/* File Type Filter */}
      <div className="space-y-3 pt-2 border-t border-border">
        <Label className="text-xs font-medium text-muted-foreground">
          File Type Filter
        </Label>

        {/* MIME Type Category Selector */}
        <div className="space-y-2">
          <Label className="text-xs font-medium">Allowed File Types</Label>
          <Select
            value={currentMimeCategory}
            onValueChange={(value: MimeTypeCategory) =>
              handleMimeCategoryChange(value)
            }
          >
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder="Select file type" />
            </SelectTrigger>
            <SelectContent>
              {MIME_TYPE_CATEGORIES.map(category => (
                <SelectItem key={category.value} value={category.value}>
                  <div className="flex items-center gap-2">
                    <span>{category.label}</span>
                    {category.description && (
                      <span className="text-muted-foreground text-xs">
                        ({category.description})
                      </span>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Custom MIME Type Input (shown when "Custom" is selected) */}
        {currentMimeCategory === "custom" && (
          <div className="space-y-2">
            <FormLabelWithTooltip
              className="text-xs font-medium"
              label="Custom MIME Types"
              description="Comma-separated MIME types or patterns (e.g., image/*)"
            />
            <Input
              value={mimeTypes || ""}
              onChange={e => handleCustomMimeTypeChange(e.target.value)}
              placeholder="e.g., image/png,image/jpeg,application/pdf"
              className="h-8 text-sm font-mono"
            />
          </div>
        )}

        {/* Max File Size */}
        <div className="space-y-2">
          <FormLabelWithTooltip
            className="text-xs font-medium"
            label="Max File Size"
            description="Maximum allowed file size for uploads"
          />
          <div className="flex gap-2">
            <Input
              type="number"
              min={0}
              value={fileSizeValue}
              onChange={e => handleFileSizeValueChange(e.target.value)}
              placeholder="No limit"
              className="h-8 text-sm flex-1"
            />
            <Select
              value={fileSizeUnit}
              onValueChange={(value: FileSizeUnit) =>
                handleFileSizeUnitChange(value)
              }
            >
              <SelectTrigger className="h-8 text-sm w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FILE_SIZE_UNITS.map(unit => (
                  <SelectItem key={unit.value} value={unit.value}>
                    {unit.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Admin Options */}
      <div className="space-y-3 pt-2 border-t border-border">
        <Label className="text-xs font-medium text-muted-foreground">
          Admin Options
        </Label>

        {/* Allow Create */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <FormLabelWithTooltip
              className="text-sm font-medium"
              label="Allow Create"
              description="Upload new files from this field"
            />
          </div>
          <Switch
            checked={allowCreate !== false}
            onCheckedChange={onAllowCreateChange}
          />
        </div>

        {/* Allow Edit */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <FormLabelWithTooltip
              className="text-sm font-medium"
              label="Allow Edit"
              description="Edit file metadata from this field"
            />
          </div>
          <Switch
            checked={allowEdit !== false}
            onCheckedChange={onAllowEditChange}
          />
        </div>

        {/* Is Sortable (only when hasMany) */}
        {hasMany && (
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <FormLabelWithTooltip
                className="text-sm font-medium"
                label="Sortable"
                description="Drag to reorder uploaded files"
              />
            </div>
            <Switch
              checked={isSortable !== false}
              onCheckedChange={onIsSortableChange}
            />
          </div>
        )}

        {/* Display Preview */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <FormLabelWithTooltip
              className="text-sm font-medium"
              label="Display Preview"
              description="Show thumbnail preview of files"
            />
          </div>
          <Switch
            checked={displayPreview !== false}
            onCheckedChange={onDisplayPreviewChange}
          />
        </div>
      </div>

      {/* Info Box */}
      {selectedCollections.length === 0 && (
        <div className="flex items-start gap-2 p-3 rounded-none bg-amber-500/10 border border-amber-500/20">
          <Icons.AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-amber-600 dark:text-amber-400">
            <p className="font-medium">No media collection selected</p>
            <p className="mt-0.5">
              Select at least one upload collection for this field.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
