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

  /**
   * How the document stands, as the editor's own status pill reads it.
   *
   * Absent when the surface does not know — a create form has no persisted
   * status, and a preview has no document at all. Absent is a real answer here
   * rather than a default: a consumer that assumed "draft" would tell an author
   * a published page was unpublished.
   */
  documentStatus?: DocumentStatus;
}

/**
 * The persisted state of the document a field is inside.
 *
 * FACTS, not a rendered state. What to call a published document with local
 * edits is a question the consumer answers with `pillStateFromForm`, because
 * only the consumer knows whether IT has unsaved work — the page builder holds
 * its document outside the form until the author leaves the editor, so the
 * form's dirty flag says nothing about what is uncommitted on the canvas.
 */
/**
 * Whether a document read carries a pending working draft.
 *
 * `_isWorkingDraft` is a SYNTHETIC response field rather than a column: the
 * read path sets it only when a draft was actually overlaid onto the response,
 * and the overlay is keyed by the language being read. So it is already
 * per-language by construction — the Spanish read reports it while the English
 * read of the same document at the same moment does not.
 *
 * Two consequences this narrows once, so no caller has to know them:
 * the field is ABSENT rather than `false` when there is nothing pending, and it
 * is untyped on the wire, so every reader would otherwise write its own cast.
 *
 * @param document - an entry or single as the API returned it
 * @returns whether this language of it has a pending working draft
 */
export function hasPendingWorkingDraft(document: unknown): boolean {
  return (
    (document as { _isWorkingDraft?: unknown } | null | undefined)
      ?._isWorkingDraft === true
  );
}

export interface DocumentStatus {
  /**
   * The ACTIVE language's status, not the main row's.
   *
   * The same value the header's submit affordances answer for. Reading the main
   * row instead would show "Published" beside a Publish button whenever a
   * translation lags its default language.
   */
  status: string;
  /** Whether a published document has a pending working draft. */
  hasWorkingDraft: boolean;
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
 *
 * ## Language is deliberately NOT here
 *
 * A document's identity is the same whichever language you are reading it in:
 * `posts/abc123` in Spanish and in French is one document. Folding the active
 * locale in would make this answer CHANGE as an author switches language, which
 * is wrong for every consumer that only wanted to know which document it is —
 * a related query, a link, a permission check — and convenient for the one that
 * did want the locale.
 *
 * So a surface needing the active language gets its own reader beside this one
 * rather than a widened `DocumentIdentity`. The admin already resolves it
 * internally (`useEntryLocaleContext`, `useEditorLocale`); none of that is
 * exported to plugins yet, and it becomes necessary when anything
 * plugin-contributed stores something per-language.
 *
 * The same reasoning keeps versions out: what a recording is KEYED by —
 * per author today, per document and locale later — is the versions layer's
 * decision, made by mapping this identity onto its own scope.
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

  /** How the document stands. Omitted where the surface does not know. */
  documentStatus?: DocumentStatus;

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
  documentStatus,
  children,
}: EntryFormContextProviderProps) {
  /*
   * Split into its own fields so the memo compares values rather than an object
   * the caller rebuilds each render — which is what every existing provider
   * does, and would make this context a new value on every parent render.
   */
  const status = documentStatus?.status;
  const hasWorkingDraft = documentStatus?.hasWorkingDraft;
  const value = useMemo(
    () => ({
      entryId,
      collectionSlug,
      isCreateMode,
      kind,
      ...(status === undefined
        ? {}
        : {
            documentStatus: {
              status,
              hasWorkingDraft: hasWorkingDraft === true,
            },
          }),
    }),
    [entryId, collectionSlug, isCreateMode, kind, status, hasWorkingDraft]
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

/**
 * How the surrounding document stands, or `null` when nothing knows.
 *
 * `null` rather than a throw, and `null` rather than a guessed default, for the
 * same reason {@link useDocumentIdentity} answers that way: a field renders in
 * previews, pickers and create forms where the question has no answer, and a
 * consumer told "draft" in those places would report a published page as
 * unpublished.
 *
 * @example
 * ```tsx
 * const status = useDocumentStatus();
 * // A surface with its own uncommitted work says so itself; the form's dirty
 * // flag cannot see it.
 * const state = status
 *   ? pillStateFromForm(status.status, myEditorIsDirty, status.hasWorkingDraft)
 *   : null;
 * ```
 */
export function useDocumentStatus(): DocumentStatus | null {
  return useContext(EntryFormContext)?.documentStatus ?? null;
}
