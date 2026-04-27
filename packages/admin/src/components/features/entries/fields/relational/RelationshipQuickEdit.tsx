/**
 * Relationship Quick Edit Component
 *
 * A modal dialog for editing related documents inline without leaving
 * the current form. Supports both single-collection and polymorphic
 * relationships.
 *
 * @module components/entries/fields/relational/RelationshipQuickEdit
 * @since 1.0.0
 */

import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Skeleton,
} from "@revnixhq/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { AlertCircle, Loader2, ExternalLink } from "@admin/components/icons";
import { buildRoute, ROUTES } from "@admin/constants/routes";
import { useCollection } from "@admin/hooks/queries/useCollections";
import { useEntry } from "@admin/hooks/queries/useEntry";
import { entryKeys } from "@admin/services/entryApi";

import { EntryForm } from "../../EntryForm/EntryForm";
import type {
  EntryData,
  EntryFormCollection,
} from "../../EntryForm/useEntryForm";

// ============================================================
// Types
// ============================================================

export interface RelationshipQuickEditProps {
  /**
   * Whether the modal is open.
   */
  open: boolean;

  /**
   * Callback when the modal open state changes.
   */
  onOpenChange: (open: boolean) => void;

  /**
   * The collection slug of the related document.
   */
  collectionSlug: string;

  /**
   * The ID of the entry to edit.
   */
  entryId: string;

  /**
   * Callback when the entry is successfully updated.
   * Receives the updated entry data.
   */
  onUpdate?: (updatedEntry: EntryData) => void;

  /**
   * Optional label for display in the modal title.
   * Falls back to formatted collection slug.
   */
  collectionLabel?: string;
}

// ============================================================
// Helpers
// ============================================================

/**
 * Formats a collection slug for display (e.g., "blog_posts" -> "Blog Posts").
 */
function formatCollectionLabel(slug: string): string {
  return slug
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, char => char.toUpperCase());
}

// ============================================================
// Sub-Components
// ============================================================

interface ModalContentProps {
  collectionSlug: string;
  entryId: string;
  onUpdate: (entry: EntryData) => void;
  onCancel: () => void;
}

/**
 * The main modal content that fetches collection and entry, then renders EntryForm.
 */
function ModalContent({
  collectionSlug,
  entryId,
  onUpdate,
  onCancel,
}: ModalContentProps) {
  const {
    data: collection,
    isLoading: isLoadingCollection,
    error: collectionError,
  } = useCollection(collectionSlug);

  const {
    data: entry,
    isLoading: isLoadingEntry,
    error: entryError,
  } = useEntry({
    collectionSlug,
    entryId,
    enabled: !!collectionSlug && !!entryId,
  });

  const isLoading = isLoadingCollection || isLoadingEntry;
  const error = collectionError || entryError;

  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-4 py-4">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-3/4" />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <Alert variant="destructive" className="my-4">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>Failed to load: {error.message}</AlertDescription>
      </Alert>
    );
  }

  // Collection not found
  if (!collection) {
    return (
      <Alert variant="destructive" className="my-4">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Collection &quot;{collectionSlug}&quot; not found.
        </AlertDescription>
      </Alert>
    );
  }

  // Entry not found
  if (!entry) {
    return (
      <Alert variant="destructive" className="my-4">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Entry &quot;{entryId}&quot; not found in {collectionSlug}.
        </AlertDescription>
      </Alert>
    );
  }

  // Render EntryForm in embedded edit mode
  // Cast collection to EntryFormCollection - the API types use FieldDefinition but
  // EntryForm works with the compatible FieldConfig union type
  return (
    <EntryForm
      collection={collection as unknown as EntryFormCollection}
      entry={entry as EntryData}
      mode="edit"
      embedded
      onSuccess={updatedEntry => onUpdate(updatedEntry)}
      onCancel={onCancel}
    />
  );
}

// ============================================================
// Main Component
// ============================================================

/**
 * RelationshipQuickEdit - Modal for editing related documents inline.
 *
 * Features:
 * - Fetches entry data when modal opens (lazy loading)
 * - Embeds EntryForm in edit mode for full form functionality
 * - Handles loading, error, and not-found states
 * - Provides link to open full editor in new tab
 * - Invalidates parent queries on successful update
 *
 * @example Basic usage
 * ```tsx
 * <RelationshipQuickEdit
 *   open={isOpen}
 *   onOpenChange={setIsOpen}
 *   collectionSlug="authors"
 *   entryId="abc123"
 *   onUpdate={(updated) => {
 *     // Update parent form with new data
 *     updateRelationship(updated);
 *   }}
 * />
 * ```
 *
 * @example With RelationshipCard
 * ```tsx
 * <RelationshipCard
 *   item={selectedItem}
 *   onRemove={() => handleRemove(selectedItem.id)}
 *   onEdit={() => setEditingItem(selectedItem)}
 * />
 * {editingItem && (
 *   <RelationshipQuickEdit
 *     open={!!editingItem}
 *     onOpenChange={(open) => !open && setEditingItem(null)}
 *     collectionSlug={editingItem.relationTo || field.relationTo}
 *     entryId={editingItem.id}
 *     onUpdate={handleItemUpdated}
 *   />
 * )}
 * ```
 */
export function RelationshipQuickEdit({
  open,
  onOpenChange,
  collectionSlug,
  entryId,
  onUpdate,
  collectionLabel,
}: RelationshipQuickEditProps) {
  const queryClient = useQueryClient();

  // Handle successful update
  const handleUpdate = useCallback(
    (updatedEntry: EntryData) => {
      // Invalidate related queries to ensure data consistency
      queryClient.invalidateQueries({
        queryKey: entryKeys.detail(collectionSlug, entryId),
      });
      queryClient.invalidateQueries({
        queryKey: entryKeys.lists(),
      });

      // Notify parent component
      onUpdate?.(updatedEntry);

      // Close modal
      onOpenChange(false);
    },
    [queryClient, collectionSlug, entryId, onUpdate, onOpenChange]
  );

  // Handle cancel
  const handleCancel = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  // Build full editor URL
  const fullEditorUrl = buildRoute(ROUTES.COLLECTION_ENTRY_EDIT, {
    slug: collectionSlug,
    id: entryId,
  });

  // Determine display label
  const displayLabel = collectionLabel || formatCollectionLabel(collectionSlug);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl" className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <DialogTitle>Edit {displayLabel}</DialogTitle>
              <DialogDescription className="sr-only">
                Edit the selected {displayLabel} document
              </DialogDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => window.open(fullEditorUrl, "_blank")}
            >
              Open full editor
              <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          </div>
        </DialogHeader>

        <div className="mt-4">
          <ModalContent
            collectionSlug={collectionSlug}
            entryId={entryId}
            onUpdate={handleUpdate}
            onCancel={handleCancel}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
