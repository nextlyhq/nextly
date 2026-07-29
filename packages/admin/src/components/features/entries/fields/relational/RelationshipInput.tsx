"use client";

/**
 * Relationship Input Component
 *
 * A controlled relationship field that integrates with React Hook Form.
 * Supports single and multiple selections, polymorphic relationships,
 * and search-based document selection.
 *
 * @module components/entries/fields/relational/RelationshipInput
 * @since 1.0.0
 */

import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@nextlyhq/ui";
import type { RelationshipFieldConfig } from "nextly/config";
import { useState, useCallback } from "react";
import {
  useController,
  type Control,
  type FieldValues,
  type Path,
} from "react-hook-form";

import { Plus } from "@admin/components/icons";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import { cn } from "@admin/lib/utils";

import type { EntryData } from "../../EntryForm/useEntryForm";

import { RelationshipCard, type RelatedItem } from "./RelationshipCard";
import {
  RelationshipCreateModal,
  type CreatedEntry,
} from "./RelationshipCreateModal";
import { RelationshipQuickEdit } from "./RelationshipQuickEdit";
import {
  RelationshipSearch,
  type SearchResultItem,
} from "./RelationshipSearch";

// ============================================================
// Types
// ============================================================

/**
 * Value format for single-collection relationship (hasMany: false).
 */
export type SingleRelationshipValue = string | null | undefined;

/**
 * Value format for single-collection relationship (hasMany: true).
 */
export type MultiRelationshipValue = string[] | null | undefined;

/**
 * Value format for polymorphic relationship (single item).
 *
 * `value` is the target's id when nothing was populated, and the target row
 * itself when the entry was read at a depth that populates relationships — the
 * edit page asks for one, so both arrive here.
 */
export interface PolymorphicRelationshipValue {
  relationTo: string;
  value: string | { id: string; [key: string]: unknown };
}

/**
 * All possible relationship value formats.
 */
export type RelationshipValue =
  | SingleRelationshipValue
  | MultiRelationshipValue
  | PolymorphicRelationshipValue
  | PolymorphicRelationshipValue[]
  | null
  | undefined;

export interface RelationshipInputProps<
  TFieldValues extends FieldValues = FieldValues,
> {
  /**
   * Field path for React Hook Form registration.
   */
  name: Path<TFieldValues>;

  /**
   * Field configuration from collection schema.
   */
  field: RelationshipFieldConfig;

  /**
   * React Hook Form control object.
   */
  control: Control<TFieldValues>;

  /**
   * Whether the input is disabled.
   * @default false
   */
  disabled?: boolean;

  /**
   * Whether the input is read-only.
   * @default false
   */
  readOnly?: boolean;

  /**
   * Additional CSS classes.
   */
  className?: string;
}

// ============================================================
// Helpers
// ============================================================

/**
 * Determines if the relationship is polymorphic (multiple target collections).
 */
function isPolymorphic(relationTo: string | string[]): relationTo is string[] {
  return Array.isArray(relationTo);
}

/**
 * Normalizes relationTo to always be an array.
 */
function getCollections(relationTo: string | string[]): string[] {
  return isPolymorphic(relationTo) ? relationTo : [relationTo];
}

/**
 * Reads a polymorphic entry as the item to display.
 *
 * Its `value` is the target's id, or the whole target row when the entry was
 * read at a populating depth. Passing the row through as the id would put an
 * object where a string is expected and render it as a React child; taking the
 * row's own fields also gives the card something to show besides the id.
 */
function polymorphicEntryToItem(entry: {
  relationTo: string;
  value: string | { id: string; [key: string]: unknown };
}): RelatedItem {
  const { relationTo, value } = entry;
  if (typeof value === "string") {
    return { id: value, relationTo };
  }
  return { ...value, relationTo };
}

/**
 * The document id a stored form value refers to, whatever shape it is in.
 *
 * A value may be a bare id, a populated row, or a `{ relationTo, value }` pair
 * whose `value` is either of those — the pair carries the row once the entry
 * was read at a populating depth. Comparing the raw value against an id
 * silently matches nothing in that last case, which is how a removal or a
 * quick-edit update can appear to succeed and change nothing.
 */
function referenceIdOf(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value === null || typeof value !== "object") return undefined;
  const record = value as { id?: unknown; value?: unknown };
  if (typeof record.id === "string") return record.id;
  if (typeof record.value === "string") return record.value;
  if (record.value !== null && typeof record.value === "object") {
    const nested = record.value as { id?: unknown };
    if (typeof nested.id === "string") return nested.id;
  }
  return undefined;
}

/**
 * Converts the form value to an array of selected items for display.
 * Handles all value formats (simple IDs, objects, polymorphic).
 */
function valueToSelectedItems(
  value: RelationshipValue,
  _hasMany: boolean
): RelatedItem[] {
  if (value == null) {
    return [];
  }

  // Handle array values (hasMany: true)
  if (Array.isArray(value)) {
    return value.map(item => {
      // Polymorphic array item: { relationTo, value: id | populated row }
      if (typeof item === "object" && "value" in item && "relationTo" in item) {
        return polymorphicEntryToItem(item);
      }
      // Simple string ID
      if (typeof item === "string") {
        return { id: item };
      }
      // Object with id (populated relationship)
      if (typeof item === "object" && "id" in item) {
        return item;
      }
      // Fallback
      return { id: String(item) };
    });
  }

  // Handle single polymorphic value: { relationTo, value: id | populated row }
  if (typeof value === "object" && "value" in value && "relationTo" in value) {
    return [polymorphicEntryToItem(value)];
  }

  // Handle single object (populated relationship)
  if (typeof value === "object" && "id" in value) {
    return [value];
  }

  // Handle simple string ID
  if (typeof value === "string") {
    return [{ id: value }];
  }

  return [];
}

/**
 * Gets IDs of all selected items for exclusion from search.
 */
function getSelectedIds(selectedItems: RelatedItem[]): string[] {
  return selectedItems.map(item => item.id);
}

// ============================================================
// Component
// ============================================================

/**
 * RelationshipInput provides a relationship field with search and selection.
 *
 * Features:
 * - Single and multiple selections (hasMany)
 * - Polymorphic relationships (multiple target collections)
 * - Search interface with debounced queries
 * - Selected items displayed as cards with remove action
 * - Respects minRows/maxRows constraints
 * - React Hook Form integration via useController
 *
 * Note: This component renders the full input with search panel.
 * Use FieldWrapper for labels, descriptions, and error display.
 *
 * @example Single relationship
 * ```tsx
 * <FieldWrapper field={authorField} error={errors.author?.message}>
 *   <RelationshipInput
 *     name="author"
 *     field={authorField}
 *     control={control}
 *   />
 * </FieldWrapper>
 * ```
 *
 * @example Multiple relationships
 * ```tsx
 * <RelationshipInput
 *   name="categories"
 *   field={{
 *     type: "relationship",
 *     name: "categories",
 *     relationTo: "categories",
 *     hasMany: true,
 *     maxRows: 5,
 *   }}
 *   control={control}
 * />
 * ```
 *
 * @example Polymorphic relationship
 * ```tsx
 * <RelationshipInput
 *   name="relatedContent"
 *   field={{
 *     type: "relationship",
 *     name: "relatedContent",
 *     relationTo: ["posts", "pages", "products"],
 *     hasMany: true,
 *   }}
 *   control={control}
 * />
 * ```
 */
export function RelationshipInput<
  TFieldValues extends FieldValues = FieldValues,
>({
  name,
  field,
  control,
  disabled = false,
  readOnly = false,
  className,
}: RelationshipInputProps<TFieldValues>) {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  // Track which item is being edited (null when no edit modal is open)
  const [editingItem, setEditingItem] = useState<RelatedItem | null>(null);

  const hasMany = field.hasMany ?? false;

  // Check if inline creation is allowed (defaults to true unless explicitly disabled)
  const allowCreate = field.admin?.allowCreate !== false;
  // Check if inline editing is allowed (defaults to true unless explicitly disabled)
  const allowEdit = field.admin?.allowEdit !== false;
  const collections = getCollections(field.relationTo);
  const isPolymorphicField = isPolymorphic(field.relationTo);

  // Get default value based on field type
  const defaultValue = hasMany ? [] : null;

  const {
    field: { value, onChange },
  } = useController({
    name,
    control,
    defaultValue: defaultValue as TFieldValues[Path<TFieldValues>],
  });

  // Convert value to display items
  const selectedItems = valueToSelectedItems(value, hasMany);
  const selectedIds = getSelectedIds(selectedItems);

  // Check if we can add more items
  const maxRows = field.maxRows;
  const canAddMore = hasMany
    ? !maxRows || selectedItems.length < maxRows
    : selectedItems.length === 0;

  /**
   * Handles selection of a related document.
   */
  const handleSelect = useCallback(
    (item: SearchResultItem, collectionSlug: string) => {
      if (hasMany) {
        const currentValues = Array.isArray(value) ? [...value] : [];

        // Check if already selected. Read the same way removal and quick-edit
        // read it, or a value whose target was populated compares an object
        // against an id, matches nothing, and the guard admits a duplicate.
        const isAlreadySelected = currentValues.some(
          v => referenceIdOf(v) === item.id
        );

        if (!isAlreadySelected) {
          if (isPolymorphicField) {
            // Polymorphic: store as { relationTo, value }
            currentValues.push({
              relationTo: collectionSlug,
              value: item.id,
              // Include full item for display
              ...item,
            });
          } else {
            // Non-polymorphic: store full item for display
            currentValues.push(item);
          }
          onChange(currentValues);
        }
      } else {
        // Single selection
        if (isPolymorphicField) {
          onChange({
            relationTo: collectionSlug,
            value: item.id,
            ...item,
          });
        } else {
          onChange(item);
        }
        setIsSearchOpen(false);
      }

      // Close search after single selection, keep open for hasMany
      if (!hasMany) {
        setIsSearchOpen(false);
      }
    },
    [hasMany, value, onChange, isPolymorphicField]
  );

  /**
   * Handles removal of a selected relationship.
   */
  const handleRemove = useCallback(
    (itemId: string) => {
      if (hasMany) {
        const currentValues = Array.isArray(value) ? (value as unknown[]) : [];
        const filtered = currentValues.filter(v => referenceIdOf(v) !== itemId);
        onChange(filtered);
      } else {
        onChange(null);
      }
    },
    [hasMany, value, onChange]
  );

  /**
   * Handles creation of a new related document via the inline modal.
   */
  const handleCreated = useCallback(
    (entry: CreatedEntry, collectionSlug: string) => {
      // Create a minimal item object with id and any display fields
      const newItem: SearchResultItem = {
        id: entry.id,
        // Include common display fields if present
        ...(typeof entry.title === "string" && { title: entry.title }),
        ...(typeof entry.name === "string" && { name: entry.name }),
        ...(typeof entry.label === "string" && { label: entry.label }),
      };

      if (hasMany) {
        const currentValues = Array.isArray(value) ? [...value] : [];

        if (isPolymorphicField) {
          // Polymorphic: store as { relationTo, value, ...displayFields }
          currentValues.push({
            relationTo: collectionSlug,
            value: entry.id,
            ...newItem,
          });
        } else {
          // Non-polymorphic: store full item for display
          currentValues.push(newItem);
        }
        onChange(currentValues);
      } else {
        // Single selection
        if (isPolymorphicField) {
          onChange({
            relationTo: collectionSlug,
            value: entry.id,
            ...newItem,
          });
        } else {
          onChange(newItem);
        }
      }
    },
    [hasMany, value, onChange, isPolymorphicField]
  );

  /**
   * Handles update of an existing related document via the quick edit modal.
   * Updates the item in the selection with new display fields from the server.
   */
  const handleItemUpdated = useCallback(
    (updatedEntry: EntryData) => {
      if (!editingItem) return;

      // Create updated item with new display fields
      const updatedItem: RelatedItem = {
        id: editingItem.id,
        // Preserve polymorphic relationTo if present
        ...(editingItem.relationTo && { relationTo: editingItem.relationTo }),
        // Update display fields from server response
        ...(typeof updatedEntry.title === "string" && {
          title: updatedEntry.title,
        }),
        ...(typeof updatedEntry.name === "string" && {
          name: updatedEntry.name,
        }),
        ...(typeof updatedEntry.label === "string" && {
          label: updatedEntry.label,
        }),
        ...(typeof updatedEntry.email === "string" && {
          email: updatedEntry.email,
        }),
      };

      if (hasMany) {
        const currentValues = Array.isArray(value) ? [...value] : [];
        const updatedValues = currentValues.map(v => {
          // Match by ID (handle both string and object values)
          const itemId = referenceIdOf(v);
          if (itemId === editingItem.id) {
            if (isPolymorphicField) {
              return {
                relationTo: editingItem.relationTo,
                value: editingItem.id,
                ...updatedItem,
              };
            }
            return updatedItem;
          }
          return v;
        });
        onChange(updatedValues);
      } else {
        // Single selection
        if (isPolymorphicField) {
          onChange({
            relationTo: editingItem.relationTo,
            value: editingItem.id,
            ...updatedItem,
          });
        } else {
          onChange(updatedItem);
        }
      }

      // Clear editing state
      setEditingItem(null);
    },
    [editingItem, hasMany, value, onChange, isPolymorphicField]
  );

  const isDisabled = disabled || readOnly;

  // Determine button label
  const buttonLabel = hasMany
    ? `Add ${field.label || "Item"}`
    : `Select ${field.label || "Item"}`;

  return (
    <div className={cn("space-y-3", className)}>
      {/* Selected items */}
      {selectedItems.length > 0 && (
        <div className="space-y-2">
          {selectedItems.map(item => {
            // The `users` core collection lives on its own admin pages
            // (`/admin/users/edit/[id]`) — opening RelationshipQuickEdit
            // for a user would hit `/admin/api/collections/users` (404,
            // since users is not a dynamic collection). Navigate to the
            // dedicated user edit page instead.
            const targetCollection = isPolymorphicField
              ? item.relationTo
              : collections[0];
            const isUserRelationship = targetCollection === "users";

            const handleEdit = isUserRelationship
              ? () => {
                  window.location.href = buildRoute(ROUTES.USERS_EDIT, {
                    id: String(item.id),
                  });
                }
              : () => setEditingItem(item);

            return (
              <RelationshipCard
                key={item.id}
                item={item}
                onRemove={() => handleRemove(item.id)}
                onEdit={allowEdit && !isDisabled ? handleEdit : undefined}
                disabled={isDisabled}
                collectionSlug={
                  isPolymorphicField ? item.relationTo : undefined
                }
              />
            );
          })}
        </div>
      )}

      {/* Add/Select button or search panel */}
      {!isDisabled && canAddMore && (
        <>
          {isSearchOpen ? (
            <RelationshipSearch
              collections={collections}
              onSelect={handleSelect}
              onClose={() => setIsSearchOpen(false)}
              excludeIds={selectedIds}
            />
          ) : (
            <div className="flex items-center gap-2">
              {/* Search existing button */}
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsSearchOpen(true)}
                className="flex-1 justify-start"
              >
                <Plus className="h-4 w-4" />
                {buttonLabel}
              </Button>

              {/* Create new button */}
              {allowCreate && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => {
                        // Same rationale as the edit handler: the users
                        // core collection has its own admin pages, so
                        // route there instead of opening the dynamic-
                        // collection create modal.
                        const target = isPolymorphicField
                          ? collections[0]
                          : (field.relationTo as string);
                        if (target === "users") {
                          window.location.href = ROUTES.USERS_CREATE;
                          return;
                        }
                        setIsCreateModalOpen(true);
                      }}
                      aria-label={`Create new ${field.label || "item"}`}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    Create new {field.label || "item"}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          )}
        </>
      )}

      {/* Inline create modal */}
      {allowCreate && (
        <RelationshipCreateModal
          open={isCreateModalOpen}
          onOpenChange={setIsCreateModalOpen}
          relationTo={field.relationTo}
          onCreated={handleCreated}
          fieldLabel={field.label}
        />
      )}

      {/* Inline quick edit modal */}
      {allowEdit && editingItem && (
        <RelationshipQuickEdit
          open={!!editingItem}
          onOpenChange={open => !open && setEditingItem(null)}
          collectionSlug={
            isPolymorphicField
              ? editingItem.relationTo || collections[0]
              : collections[0]
          }
          entryId={editingItem.id}
          onUpdate={handleItemUpdated}
          collectionLabel={field.label}
        />
      )}

      {/* Max rows reached message */}
      {hasMany && maxRows && selectedItems.length >= maxRows && (
        <p className="text-xs text-muted-foreground">
          Maximum of {maxRows} items reached
        </p>
      )}
    </div>
  );
}

// ============================================================
// Exports
// ============================================================
