"use client";

/**
 * RelationshipEditor Component
 *
 * Editor for configuring relationship field settings.
 * Features:
 * - Target collection(s) selector (single or polymorphic)
 * - hasMany toggle for multiple relationships
 * - maxDepth input for population depth
 * - allowCreate/allowEdit toggles
 * - isSortable toggle (when hasMany is true)
 * - Simple filter options (field equals value)
 *
 * @module components/features/schema-builder/RelationshipEditor
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
  Switch,
} from "@revnixhq/ui";
import { useState, useCallback, useMemo } from "react";

import * as Icons from "@admin/components/icons";
import { FormLabelWithTooltip } from "@admin/components/ui/form-label-with-tooltip";
import { useCollections, useSingles } from "@admin/hooks/queries";

import type { RelationshipEditorProps, RelationshipFilter } from "./types";

// ============================================================
// RelationshipEditor Component
// ============================================================

export function RelationshipEditor({
  relationTo,
  onRelationToChange,
  hasMany,
  onHasManyChange,
  maxDepth,
  onMaxDepthChange,
  allowCreate,
  onAllowCreateChange,
  allowEdit,
  onAllowEditChange,
  isSortable,
  onIsSortableChange,
  filterOptions,
  onFilterOptionsChange,
}: RelationshipEditorProps) {
  const [isCollectionPickerOpen, setIsCollectionPickerOpen] = useState(false);
  const [collectionSearch, setCollectionSearch] = useState("");

  // Fetch available collections
  const { data: collectionsData, isLoading: isLoadingCollections } =
    useCollections({
      pagination: { page: 0, pageSize: 100 },
      sorting: [{ field: "name", direction: "asc" }],
      filters: {},
    });

  // Fetch available singles
  const { data: singlesData, isLoading: isLoadingSingles } = useSingles({
    pagination: { page: 0, pageSize: 100 },
    sorting: [{ field: "label", direction: "asc" }],
    filters: {},
  });

  // Get available collections for the picker
  const availableCollections = useMemo(() => {
    const items: Array<{ slug: string; label: string }> = [];

    // 1. Add Users (System Collection)
    items.push({
      slug: "users",
      label: "Users",
    });

    // 2. Add Collections
    if (collectionsData?.data) {
      items.push(
        ...collectionsData.data.map(col => ({
          slug: col.name,
          label: col.label || col.name,
        }))
      );
    }

    // 3. Add Singles
    if (singlesData?.data) {
      items.push(
        ...singlesData.data.map(single => ({
          slug: single.slug,
          label: single.label || single.slug,
        }))
      );
    }

    return items;
  }, [collectionsData, singlesData]);

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

  // Handle filter update
  const handleFilterUpdate = useCallback(
    (updates: Partial<RelationshipFilter> | null) => {
      if (updates === null) {
        onFilterOptionsChange?.(undefined);
      } else {
        const currentFilter = filterOptions || { field: "", equals: "" };
        onFilterOptionsChange?.({ ...currentFilter, ...updates });
      }
    },
    [filterOptions, onFilterOptionsChange]
  );

  return (
    <div className="space-y-4">
      {/* Section Header */}
      <div className="flex items-center gap-2">
        <Icons.Link2 className="h-4 w-4 text-muted-foreground" />
        <Label className="text-xs font-medium">
          Relationship Configuration
        </Label>
      </div>

      {/* Target Collections */}
      <div className="space-y-2">
        <FormLabelWithTooltip
          className="text-xs font-medium"
          label="Target Collection(s)"
          description={
            selectedCollections.length > 1
              ? "Polymorphic relationship - can reference multiple collection types"
              : "Select the collection this field will reference"
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
                  ? "Select collection(s)"
                  : "Add another collection"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-0" align="start">
              <div className="p-2  border-b border-primary/5">
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
                {isLoadingCollections || isLoadingSingles ? (
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
                      <div
                        key={collection.slug}
                        role="button"
                        tabIndex={0}
                        onClick={() => handleCollectionToggle(collection.slug)}
                        onKeyDown={e => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            handleCollectionToggle(collection.slug);
                          }
                        }}
                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-none text-left hover-subtle-row transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Checkbox
                          checked={isSelected}
                          className="h-3.5 w-3.5 pointer-events-none" // Prevent double click event
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
                      </div>
                    );
                  })
                )}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Relationship Options */}
      <div className="space-y-3 pt-2  border-t border-primary/5">
        {/* Has Many Toggle */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <FormLabelWithTooltip
              className="text-sm font-medium"
              label="Allow Multiple"
              description="Reference multiple documents"
            />
          </div>
          <Switch
            checked={hasMany || false}
            onCheckedChange={onHasManyChange}
          />
        </div>

        {/* Max Depth */}
        <div className="space-y-2">
          <FormLabelWithTooltip
            htmlFor="max-depth"
            className="text-xs font-medium"
            label="Max Population Depth"
            description="How deep to populate nested relationships (0-10)"
          />
          <Input
            id="max-depth"
            type="number"
            min={0}
            max={10}
            value={maxDepth ?? 1}
            onChange={e =>
              onMaxDepthChange?.(
                e.target.value ? Number(e.target.value) : undefined
              )
            }
            placeholder="1"
            className="h-8 text-sm w-24"
          />
        </div>
      </div>

      {/* Admin Options */}
      <div className="space-y-3 pt-2  border-t border-primary/5">
        <Label className="text-xs font-medium text-muted-foreground">
          Admin Options
        </Label>

        {/* Allow Create */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <FormLabelWithTooltip
              className="text-sm font-medium"
              label="Allow Create"
              description="Create new documents from this field"
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
              description="Edit related documents from this field"
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
                description="Drag to reorder selected items"
              />
            </div>
            <Switch
              checked={isSortable !== false}
              onCheckedChange={onIsSortableChange}
            />
          </div>
        )}
      </div>

      {/* Filter Options (Simplified) */}
      <div className="space-y-3 pt-2  border-t border-primary/5">
        <div className="flex items-center justify-between">
          <FormLabelWithTooltip
            className="text-xs font-medium"
            label="Filter Options"
            description="Limit available documents by a field value"
          />
          {filterOptions && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 text-xs text-muted-foreground"
              onClick={() => handleFilterUpdate(null)}
            >
              Remove
            </Button>
          )}
        </div>

        {filterOptions ? (
          <div className="space-y-2 p-3 rounded-none  border border-primary/5 bg-background">
            <p className="text-xs text-muted-foreground mb-2">
              Only show documents where:
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Input
                value={filterOptions.field || ""}
                onChange={e => handleFilterUpdate({ field: e.target.value })}
                placeholder="Field name"
                className="h-8 text-sm font-mono"
              />
              <Input
                value={filterOptions.equals || ""}
                onChange={e => handleFilterUpdate({ equals: e.target.value })}
                placeholder="equals value"
                className="h-8 text-sm"
              />
            </div>
            <p className="text-[10px] text-muted-foreground">
              e.g., status = published
            </p>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full h-8 text-xs"
            onClick={() => handleFilterUpdate({ field: "", equals: "" })}
          >
            <Icons.Settings className="h-3 w-3 mr-1" />
            Add Filter
          </Button>
        )}
      </div>

      {/* Info Box */}
      {selectedCollections.length === 0 && (
        <div className="flex items-start gap-2 p-3 rounded-none bg-amber-500/10  border border-primary/5 border-amber-500/20">
          <Icons.AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-amber-600 dark:text-amber-400">
            <p className="font-medium">No target collection selected</p>
            <p className="mt-0.5">
              Select at least one collection for this relationship field.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
