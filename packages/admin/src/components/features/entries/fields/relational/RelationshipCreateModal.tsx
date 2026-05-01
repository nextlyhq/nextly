"use client";

/**
 * Relationship Create Modal Component
 *
 * A modal dialog for creating new related documents inline without
 * leaving the current form. Supports polymorphic relationships with
 * collection selection.
 *
 * @module components/entries/fields/relational/RelationshipCreateModal
 * @since 1.0.0
 */

import {
  Alert,
  AlertDescription,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@revnixhq/ui";
import { useState, useCallback } from "react";

import { AlertCircle, Loader2 } from "@admin/components/icons";
import { useCollection } from "@admin/hooks/queries/useCollections";

import { EntryForm } from "../../EntryForm/EntryForm";
import type {
  EntryFormCollection,
} from "../../EntryForm/useEntryForm";

// ============================================================
// Types
// ============================================================

export interface RelationshipCreateModalProps {
  /**
   * Whether the modal is open.
   */
  open: boolean;

  /**
   * Callback when the modal open state changes.
   */
  onOpenChange: (open: boolean) => void;

  /**
   * The collection slug(s) that can be created.
   * Can be a single collection or array for polymorphic relationships.
   */
  relationTo: string | string[];

  /**
   * Callback when a new entry is successfully created.
   * Receives the created entry with its ID.
   */
  onCreated: (entry: CreatedEntry, collectionSlug: string) => void;

  /**
   * Optional label for the relationship field (used in modal title).
   */
  fieldLabel?: string;
}

export interface CreatedEntry {
  id: string;
  [key: string]: unknown;
}

// ============================================================
// Helpers
// ============================================================

/**
 * Normalizes relationTo to always be an array.
 */
function getCollections(relationTo: string | string[]): string[] {
  return Array.isArray(relationTo) ? relationTo : [relationTo];
}

/**
 * Checks if the relationship is polymorphic (multiple target collections).
 */
function isPolymorphic(relationTo: string | string[]): boolean {
  return Array.isArray(relationTo) && relationTo.length > 1;
}

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

interface CollectionSelectorProps {
  collections: string[];
  selectedCollection: string;
  onSelect: (collection: string) => void;
}

/**
 * Collection selector dropdown for polymorphic relationships.
 */
function CollectionSelector({
  collections,
  selectedCollection,
  onSelect,
}: CollectionSelectorProps) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-foreground">
        Select type to create
      </label>
      <Select value={selectedCollection} onValueChange={onSelect}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Select collection type" />
        </SelectTrigger>
        <SelectContent>
          {collections.map(slug => (
            <SelectItem key={slug} value={slug}>
              {formatCollectionLabel(slug)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

interface ModalContentProps {
  collectionSlug: string;
  onCreated: (entry: CreatedEntry) => void;
  onCancel: () => void;
}

/**
 * The main modal content that fetches collection and renders EntryForm.
 */
function ModalContent({
  collectionSlug,
  onCreated,
  onCancel,
}: ModalContentProps) {
  const { data: collection, isLoading, error } = useCollection(collectionSlug);

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
        <AlertDescription>
          Failed to load collection: {error.message}
        </AlertDescription>
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

  // Render EntryForm in embedded mode
  // Cast collection to EntryFormCollection - the API types use FieldDefinition but
  // EntryForm works with the compatible FieldConfig union type
  return (
    <EntryForm
      collection={collection as unknown as EntryFormCollection}
      mode="create"
      embedded
      onSuccess={entry => onCreated(entry)}
      onCancel={onCancel}
    />
  );
}

// ============================================================
// Main Component
// ============================================================

/**
 * RelationshipCreateModal - Modal for creating new related documents inline.
 *
 * Features:
 * - Embeds EntryForm for full form functionality
 * - Supports polymorphic relationships with collection selector
 * - Handles loading, error, and success states
 * - Automatically passes created entry back to parent
 *
 * @example Single collection relationship
 * ```tsx
 * <RelationshipCreateModal
 *   open={isOpen}
 *   onOpenChange={setIsOpen}
 *   relationTo="authors"
 *   onCreated={(entry, slug) => {
 *     // Add entry.id to the relationship field
 *     addRelationship(entry.id);
 *   }}
 * />
 * ```
 *
 * @example Polymorphic relationship
 * ```tsx
 * <RelationshipCreateModal
 *   open={isOpen}
 *   onOpenChange={setIsOpen}
 *   relationTo={["posts", "pages", "products"]}
 *   onCreated={(entry, collectionSlug) => {
 *     // Add polymorphic value
 *     addRelationship({ relationTo: collectionSlug, value: entry.id });
 *   }}
 *   fieldLabel="Related Content"
 * />
 * ```
 */
export function RelationshipCreateModal({
  open,
  onOpenChange,
  relationTo,
  onCreated,
  fieldLabel,
}: RelationshipCreateModalProps) {
  const collections = getCollections(relationTo);
  const isPolymorphicRelation = isPolymorphic(relationTo);

  // For polymorphic relationships, track selected collection
  const [selectedCollection, setSelectedCollection] = useState<string>(
    collections[0]
  );

  // Reset selection when modal opens
  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (newOpen) {
        // Reset to first collection when opening
        setSelectedCollection(collections[0]);
      }
      onOpenChange(newOpen);
    },
    [collections, onOpenChange]
  );

  // Handle successful creation
  const handleCreated = useCallback(
    (entry: CreatedEntry) => {
      onCreated(entry, selectedCollection);
      onOpenChange(false);
    },
    [onCreated, selectedCollection, onOpenChange]
  );

  // Handle cancel
  const handleCancel = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  // Determine modal title
  const collectionLabel = formatCollectionLabel(selectedCollection);
  const title = fieldLabel
    ? `Create New ${collectionLabel}`
    : `Create New ${collectionLabel}`;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="xl" className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {isPolymorphicRelation && (
            <DialogDescription>
              Select the type of document you want to create.
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="space-y-6">
          {/* Collection selector for polymorphic relationships */}
          {isPolymorphicRelation && (
            <CollectionSelector
              collections={collections}
              selectedCollection={selectedCollection}
              onSelect={setSelectedCollection}
            />
          )}

          {/* Entry form content */}
          <ModalContent
            key={selectedCollection} // Re-mount when collection changes
            collectionSlug={selectedCollection}
            onCreated={handleCreated}
            onCancel={handleCancel}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
