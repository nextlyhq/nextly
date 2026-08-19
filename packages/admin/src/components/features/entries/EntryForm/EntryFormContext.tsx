"use client";

/**
 * Entry Form Context
 *
 * Provides entry-level context to all child components in the form.
 * Includes entry ID, collection slug, and other metadata needed by
 * deeply nested field components.
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

  /**
   * Which family of document this form edits.
   *
   * Defaults to `"collection"`, so every existing provider keeps its meaning
   * without naming it. A Single is not a collection entry — it has exactly one
   * document, addressed by its own slug — and a consumer that guessed from the
   * presence of an id would be wrong for a Single that has not been
   * materialised yet.
   */
  kind: "collection" | "single";
}

/**
 * Which document a field is being rendered inside.
 *
 * The plugin-facing shape, and deliberately NOT a versions scope. A field that
 * wants to talk to any document API needs to know which document it is in;
 * versions is one consumer of that and should not get to define the vocabulary
 * for the rest. Mapping this to whatever a particular API wants is that API's
 * job.
 *
 * `documentId` is absent while a collection entry is being created, because
 * there is no document yet. A caller that must address one checks for it rather
 * than inventing a placeholder.
 */
export interface DocumentIdentity {
  kind: "collection" | "single";
  /** The collection name, or the Single's slug. */
  slug: string;
  /** The saved document's id, absent until it has been created once. */
  documentId?: string;
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

  /** Which family of document this form edits. Defaults to `"collection"`. */
  kind?: "collection" | "single";

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
 * entryId and collectionSlug to deeply nested field components.
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
  kind = "collection",
  children,
}: EntryFormContextProviderProps) {
  const value = useMemo(
    () => ({
      entryId,
      collectionSlug,
      isCreateMode,
      kind,
    }),
    [entryId, collectionSlug, isCreateMode, kind]
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
 * function ConditionalField({ field }) {
 *   const context = useOptionalEntryFormContext();
 *
 *   if (!context?.entryId) {
 *     return <div>Save the entry first</div>;
 *   }
 *
 *   return <RelatedContent entryId={context.entryId} />;
 * }
 * ```
 */
export function useOptionalEntryFormContext(): EntryFormContextValue | null {
  return useContext(EntryFormContext);
}

/**
 * Which document the surrounding form is editing, or `null` outside one.
 *
 * Returns `null` rather than throwing, unlike {@link useEntryFormContext}. A
 * field component is rendered by the entry editor, by the Single editor, and by
 * previews and pickers that have no document at all — so "there is no document
 * here" is an ordinary answer a caller has to handle, not a programming error.
 * Throwing would make every such caller wrap this in a try/catch, and the ones
 * that forgot would break the surface they were embedded in.
 *
 * @example
 * ```tsx
 * const document = useDocumentIdentity();
 * // Recording anything against a document needs one that exists.
 * const canRecord = document?.documentId !== undefined;
 * ```
 */
export function useDocumentIdentity(): DocumentIdentity | null {
  const context = useContext(EntryFormContext);
  if (!context) return null;
  return {
    kind: context.kind,
    slug: context.collectionSlug,
    documentId: context.entryId,
  };
}
