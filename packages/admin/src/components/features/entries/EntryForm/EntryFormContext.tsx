"use client";

/**
 * Entry Form Context
 *
 * Provides entry-level context to all child components in the form.
 * Includes entry ID, collection slug, and other metadata needed by
 * virtual fields like JoinField.
 *
 * @module components/entries/EntryForm/EntryFormContext
 * @since 1.0.0
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";

// ============================================================================
// Types
// ============================================================================

export interface EntryFormContextValue {
  /**
   * ID of the entry being edited.
   * Undefined for new entries being created.
   */
  entryId?: string;

  /**
   * Collection slug/name.
   * Always present.
   */
  collectionSlug: string;

  /**
   * Whether the form is in create mode (vs edit mode).
   */
  isCreateMode: boolean;
}

export interface EntryFormContextProviderProps {
  /**
   * ID of the entry being edited.
   */
  entryId?: string;

  /**
   * Collection slug/name.
   */
  collectionSlug: string;

  /**
   * Whether the form is in create mode.
   */
  isCreateMode?: boolean;

  /**
   * Child components.
   */
  children: ReactNode;
}

// ============================================================================
// Context
// ============================================================================

const EntryFormContext = createContext<EntryFormContextValue | null>(null);

// ============================================================================
// Provider
// ============================================================================

/**
 * EntryFormContextProvider - Provides entry context to child components
 *
 * Wraps the form content to provide entry-level information like
 * entryId and collectionSlug to deeply nested components like
 * JoinField that need to query related entries.
 *
 * @example
 * ```tsx
 * <EntryFormContextProvider
 *   entryId={entry?.id}
 *   collectionSlug={collection.name}
 *   isCreateMode={mode === "create"}
 * >
 *   <EntryFormContent fields={fields} />
 * </EntryFormContextProvider>
 * ```
 */
export function EntryFormContextProvider({
  entryId,
  collectionSlug,
  isCreateMode = false,
  children,
}: EntryFormContextProviderProps) {
  const value = useMemo(
    () => ({
      entryId,
      collectionSlug,
      isCreateMode,
    }),
    [entryId, collectionSlug, isCreateMode]
  );

  return (
    <EntryFormContext.Provider value={value}>
      {children}
    </EntryFormContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

/**
 * useEntryFormContext - Access entry form context
 *
 * Hook to access entry-level information from within form components.
 * Must be used within an EntryFormContextProvider.
 *
 * @returns Entry form context value
 * @throws Error if used outside of EntryFormContextProvider
 *
 * @example
 * ```tsx
 * function JoinField({ field }) {
 *   const { entryId, collectionSlug } = useEntryFormContext();
 *
 *   // Query entries that reference this entry
 *   const { data } = useEntries({
 *     collectionSlug: field.collection,
 *     params: {
 *       where: { [field.on]: { equals: entryId } },
 *     },
 *   });
 *
 *   return <ul>{data?.items.map(...)}</ul>;
 * }
 * ```
 */
export function useEntryFormContext(): EntryFormContextValue {
  const context = useContext(EntryFormContext);

  if (!context) {
    throw new Error(
      "useEntryFormContext must be used within an EntryFormContextProvider"
    );
  }

  return context;
}

/**
 * useOptionalEntryFormContext - Access entry form context safely
 *
 * Like useEntryFormContext but returns null if not within a provider.
 * Useful for components that may be rendered outside of a form context.
 *
 * @returns Entry form context value or null
 *
 * @example
 * ```tsx
 * function MaybeJoinField({ field }) {
 *   const context = useOptionalEntryFormContext();
 *
 *   if (!context?.entryId) {
 *     return <div>Save the entry to see related items</div>;
 *   }
 *
 *   return <JoinField field={field} />;
 * }
 * ```
 */
export function useOptionalEntryFormContext(): EntryFormContextValue | null {
  return useContext(EntryFormContext);
}
