"use client";

/**
 * useRelationshipCreate Hook
 *
 * A hook for managing the state and callbacks for inline relationship creation.
 * Provides modal state management and handles adding newly created entries
 * to the relationship field value.
 *
 * @module hooks/useRelationshipCreate
 * @since 1.0.0
 */

import { useState, useCallback } from "react";

// ============================================================
// Types
// ============================================================

/**
 * Created entry with required id and optional display fields.
 */
export interface CreatedEntry {
  id: string;
  title?: unknown;
  name?: unknown;
  label?: unknown;
  [key: string]: unknown;
}

/**
 * Options for the useRelationshipCreate hook.
 */
export interface UseRelationshipCreateOptions {
  /**
   * The collection slug(s) that the relationship points to.
   * Can be a single collection or array for polymorphic relationships.
   */
  relationTo: string | string[];

  /**
   * Whether the relationship allows multiple values (hasMany).
   */
  hasMany: boolean;

  /**
   * The current value of the relationship field.
   */
  currentValue: unknown;

  /**
   * Callback to update the relationship field value.
   */
  onChange: (value: unknown) => void;

  /**
   * Whether to close the modal after successful creation.
   * @default true
   */
  closeOnCreate?: boolean;
}

/**
 * Return type for the useRelationshipCreate hook.
 */
export interface UseRelationshipCreateReturn {
  /**
   * Whether the create modal is open.
   */
  isModalOpen: boolean;

  /**
   * Opens the create modal.
   */
  openModal: () => void;

  /**
   * Closes the create modal.
   */
  closeModal: () => void;

  /**
   * Sets the modal open state.
   */
  setModalOpen: (open: boolean) => void;

  /**
   * Callback to handle a newly created entry.
   * Adds the entry to the relationship value and optionally closes the modal.
   */
  handleCreated: (entry: CreatedEntry, collectionSlug: string) => void;

  /**
   * The target collection slug(s).
   */
  relationTo: string | string[];

  /**
   * Whether the relationship is polymorphic (multiple target collections).
   */
  isPolymorphic: boolean;
}

// ============================================================
// Helpers
// ============================================================

/**
 * Checks if the relationship is polymorphic.
 */
function isPolymorphicRelation(relationTo: string | string[]): boolean {
  return Array.isArray(relationTo) && relationTo.length > 1;
}

// ============================================================
// Hook
// ============================================================

/**
 * useRelationshipCreate - Manages inline relationship creation state.
 *
 * This hook encapsulates the logic for:
 * - Opening and closing the create modal
 * - Handling newly created entries
 * - Adding created entries to the relationship value (single or hasMany)
 * - Supporting polymorphic relationships
 *
 * @example Basic usage with a single collection
 * ```tsx
 * function MyRelationshipField({ field, value, onChange }) {
 *   const {
 *     isModalOpen,
 *     openModal,
 *     setModalOpen,
 *     handleCreated,
 *     relationTo,
 *   } = useRelationshipCreate({
 *     relationTo: field.relationTo,
 *     hasMany: field.hasMany ?? false,
 *     currentValue: value,
 *     onChange,
 *   });
 *
 *   return (
 *     <>
 *       <Button onClick={openModal}>Create New</Button>
 *       <RelationshipCreateModal
 *         open={isModalOpen}
 *         onOpenChange={setModalOpen}
 *         relationTo={relationTo}
 *         onCreated={handleCreated}
 *       />
 *     </>
 *   );
 * }
 * ```
 *
 * @example With polymorphic relationship
 * ```tsx
 * const {
 *   isModalOpen,
 *   handleCreated,
 *   isPolymorphic,
 * } = useRelationshipCreate({
 *   relationTo: ["posts", "pages", "products"],
 *   hasMany: true,
 *   currentValue: value,
 *   onChange: setValue,
 * });
 *
 * // isPolymorphic will be true
 * // handleCreated will add entries in { relationTo, value, ...entry } format
 * ```
 */
export function useRelationshipCreate({
  relationTo,
  hasMany,
  currentValue,
  onChange,
  closeOnCreate = true,
}: UseRelationshipCreateOptions): UseRelationshipCreateReturn {
  const [isModalOpen, setModalOpen] = useState(false);
  const isPolymorphic = isPolymorphicRelation(relationTo);

  /**
   * Opens the create modal.
   */
  const openModal = useCallback(() => {
    setModalOpen(true);
  }, []);

  /**
   * Closes the create modal.
   */
  const closeModal = useCallback(() => {
    setModalOpen(false);
  }, []);

  /**
   * Handles a newly created entry by adding it to the relationship value.
   */
  const handleCreated = useCallback(
    (entry: CreatedEntry, collectionSlug: string) => {
      // Build the new item with display fields
      const newItem = {
        id: entry.id,
        ...(typeof entry.title === "string" ? { title: entry.title } : {}),
        ...(typeof entry.name === "string" ? { name: entry.name } : {}),
        ...(typeof entry.label === "string" ? { label: entry.label } : {}),
      };

      if (hasMany) {
        // Multi-value: append to current values
        const currentValues = Array.isArray(currentValue)
          ? [...currentValue]
          : [];

        if (isPolymorphic) {
          // Polymorphic: store as { relationTo, value, ...displayFields }
          currentValues.push({
            relationTo: collectionSlug,
            value: entry.id,
            ...newItem,
          });
        } else {
          // Non-polymorphic: store the item directly
          currentValues.push(newItem);
        }

        onChange(currentValues);
      } else {
        // Single value: replace current value
        if (isPolymorphic) {
          onChange({
            relationTo: collectionSlug,
            value: entry.id,
            ...newItem,
          });
        } else {
          onChange(newItem);
        }
      }

      // Close modal if configured
      if (closeOnCreate) {
        closeModal();
      }
    },
    [hasMany, currentValue, onChange, isPolymorphic, closeOnCreate, closeModal]
  );

  return {
    isModalOpen,
    openModal,
    closeModal,
    setModalOpen,
    handleCreated,
    relationTo,
    isPolymorphic,
  };
}
