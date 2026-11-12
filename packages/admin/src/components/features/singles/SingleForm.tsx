"use client";

/**
 * Single Form Component
 *
 * Form component for editing Single document data.
 * Singles are single-document entities that always exist and cannot be deleted.
 * This component provides:
 * - Dynamic field rendering based on Single schema
 * - Form validation with Zod
 * - Autosave to a server-side recovery point
 * - Unsaved changes protection
 * - Keyboard shortcuts
 *
 * Unlike EntryForm, SingleForm:
 * - Only supports edit mode (no create/delete)
 * - Has a simpler header (no delete/duplicate actions)
 * - Uses separate hooks for document data vs schema
 *
 * @module components/singles/SingleForm
 * @since 1.0.0
 */

import { zodResolver } from "@hookform/resolvers/zod";
import type { FieldConfig } from "nextly/config";
import type React from "react";
import { useEffect, useMemo, useCallback, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { CopyFromLanguageScope } from "@admin/components/features/entries/CopyFromLanguageScope";
import { singleSourceFetcher } from "@admin/components/features/entries/entry-locale-source";
import { pluginDocumentLock } from "@admin/components/features/entries/EntryForm/document-lock-affordances";
import {
  topLevelFieldNames,
  useContentFields,
  useDocumentPanelParts,
  useDocumentPlace,
} from "@admin/components/features/entries/EntryForm/document-place";
import { DocumentFormSource } from "@admin/components/features/entries/EntryForm/document-values";
import type { ContributedAction } from "@admin/components/features/entries/EntryForm/DocumentActionBar";
import {
  DocumentActionsHost,
  DocumentSaveShortcuts,
  SaveWithoutPublishingBridge,
  SaveActionFormProvider,
} from "@admin/components/features/entries/EntryForm/DocumentActionsContext";
import { DocumentBanners } from "@admin/components/features/entries/EntryForm/DocumentBanners";
import { DocumentBar } from "@admin/components/features/entries/EntryForm/DocumentBar";
import {
  DOCUMENT_COLUMN_INSET,
  DocumentEditorLayout,
} from "@admin/components/features/entries/EntryForm/DocumentEditorLayout";
import { DocumentPlaceTabs } from "@admin/components/features/entries/EntryForm/DocumentPlaceTabs";
import { DocumentSidePanel } from "@admin/components/features/entries/EntryForm/DocumentSidePanel";
import { DocumentTitleBlock } from "@admin/components/features/entries/EntryForm/DocumentTitleBlock";
import { DocumentTrail } from "@admin/components/features/entries/EntryForm/DocumentTrail";
import {
  DocumentViewBody,
  type DocumentViewMount,
} from "@admin/components/features/entries/EntryForm/DocumentViewBody";
import {
  editedLanguageUntranslated,
  effectiveEntryStatus,
} from "@admin/components/features/entries/EntryForm/entry-address";
import { EntryFormContent } from "@admin/components/features/entries/EntryForm/EntryFormContent";
import {
  EntryFormContextProvider,
  hasPendingWorkingDraft,
} from "@admin/components/features/entries/EntryForm/EntryFormContext";
import { EntryFormPlace } from "@admin/components/features/entries/EntryForm/EntryFormPlace";
import { EntryFormSidebar } from "@admin/components/features/entries/EntryForm/EntryFormSidebar";
import { EntryMetaStrip } from "@admin/components/features/entries/EntryForm/EntryMetaStrip";
import { FormErrorSummary } from "@admin/components/features/entries/EntryForm/FormErrorSummary";
import { PanelSectionsAboveForm } from "@admin/components/features/entries/EntryForm/panels";
import {
  readerStatusWrite,
  statusWritesHeld,
} from "@admin/components/features/entries/EntryForm/reader-status-write";
import type { RecoveryPointState } from "@admin/components/features/entries/EntryForm/SaveStateIndicator";
import { submitDocument } from "@admin/components/features/entries/EntryForm/submit-document";
import {
  submitBusy,
  submitFailed,
  submitHeld,
  type SubmitOutcome,
} from "@admin/components/features/entries/EntryForm/submit-outcome";
import { UnsavedChangesGuard } from "@admin/components/features/entries/EntryForm/UnsavedChangesGuard";
import {
  UnsavedWorkProvider,
  useFormUnsavedWork,
} from "@admin/components/features/entries/EntryForm/UnsavedWorkContext";
import {
  storingHandlers,
  type DocumentActionBindings,
  type DocumentActionBindingsInput,
} from "@admin/components/features/entries/EntryForm/useDocumentActionBindings";
import { useDocumentLockSurface } from "@admin/components/features/entries/EntryForm/useDocumentLockSurface";
import { useDocumentPanel } from "@admin/components/features/entries/EntryForm/useDocumentPanel";
import {
  mapIntentToPayload,
  passwordFieldNames,
  type EntryFormIntent,
} from "@admin/components/features/entries/EntryForm/useEntryForm";
import { useLockWithHeldChange } from "@admin/components/features/entries/EntryForm/useHeldDocumentChange";
import {
  heldLocaleChange,
  heldWhileRecovering,
  offerHeldWhileRecovering,
  useRefusedForm,
} from "@admin/components/features/entries/EntryForm/useRefusedForm";
import { useResetOnReload } from "@admin/components/features/entries/EntryForm/useResetOnReload";
import {
  useVersionConflict,
  type VersionWrite,
} from "@admin/components/features/entries/EntryForm/useVersionConflict";
import { VersionConflictDialog } from "@admin/components/features/entries/EntryForm/VersionConflictDialog";
import { EntryLocaleProvider } from "@admin/components/features/entries/EntryLocaleContext";
import { DocumentLanguagePanel } from "@admin/components/features/entries/LanguagePanel";
import { PreviewPanes } from "@admin/components/features/entries/PreviewMode/PreviewPanes";
import { isRemovedFromCode } from "@admin/components/features/entries/removed-from-code-notice";
import { TranslationPanes } from "@admin/components/features/entries/TranslationMode/TranslationPanes";
import { useTranslationSource } from "@admin/components/features/entries/TranslationMode/useTranslationSource";
import { useEntryLocaleContext } from "@admin/components/features/entries/useEntryLocaleContext";
import {
  autosaveEnabledFor,
  autosaveIntervalFrom,
} from "@admin/components/features/versions/autosave-interval";
import { DocumentHistoryContext } from "@admin/components/features/versions/document-history-context";
import {
  historyEnabledFrom,
  historyRetentionFrom,
} from "@admin/components/features/versions/history-enabled";
import {
  useEditorRestoreSurface,
  useFormRestore,
} from "@admin/components/features/versions/useEditorRestoreSurface";
import { PREVIOUS_VERSION } from "@admin/components/features/versions/version-search-params";
import { versionsHref } from "@admin/components/features/versions/versions-href";
import {
  mayRecordRecovery,
  useViewedVersion,
  writeActionsHeld,
  ViewedVersionBody,
  versionAwareToolbarSlots,
} from "@admin/components/features/versions/viewed-version-host";
import { CONTENT_MEASURE_LENGTH } from "@admin/components/layout/content-measure";
import { useDiscardSingleWorkingDraft } from "@admin/hooks/queries/useDiscardSingleWorkingDraft";
import { usePublishAllSingleLocales } from "@admin/hooks/queries/usePublishAllSingleLocales";
import type { DocumentLatest } from "@admin/hooks/queries/useStoredReferences";
import { useAutosaveRecovery } from "@admin/hooks/useAutosaveRecovery";
import { useAutoSlug } from "@admin/hooks/useAutoSlug";
import {
  autosaveScopeFor,
  documentRecordingKey,
  useDocumentAutosave,
} from "@admin/hooks/useDocumentAutosave";
import { useLocalization } from "@admin/hooks/useLocalization";
import type { RefusedForm } from "@admin/hooks/useSharedFieldsRecovery";
import { useAfterRecordings } from "@admin/hooks/useSnapshotAutosave";
import { useTakeoverLayout } from "@admin/hooks/useTakeoverLayout";
import { editsOffered, useUpdateAnswer } from "@admin/hooks/useUpdateAnswer";
import { versionForLanguage, versionOf } from "@admin/lib/document-version";
import { generateClientSchema } from "@admin/lib/field-validation";
import { getDefaultValues } from "@admin/lib/form/default-values";
import {
  holdsPlaceholders,
  withoutPlaceholders,
} from "@admin/lib/form/stored-references";
import type { SidebarSectionProps } from "@admin/lib/plugins/component-registry";
import type { PanelOrderEntry } from "@admin/lib/plugins/document-surfaces";
import { cn } from "@admin/lib/utils";
import { singleApi } from "@admin/services/singleApi";
import type { SingleAdminOptions } from "@admin/types/entities";
import type { RemovedFromCodeMark } from "@admin/types/removed-from-code";

import { relaxIdentityRequired } from "./identity-fields";
import { useSinglePreviewLink } from "./useSinglePreviewLink";
import { useSinglePreviewPane } from "./useSinglePreviewPane";

// ============================================================================
// Types
// ============================================================================

/**
 * Single schema data (from useSingleSchema hook)
 */
export interface SingleSchema extends RemovedFromCodeMark {
  slug: string;
  label: string;
  description?: string;
  fields: FieldConfig[];
  /*
   * The shared declaration rather than an inline copy. This one had drifted
   * already — it was missing `order` and `sidebarGroup`, which the server
   * sends — and a second shape for one payload is how a field the server
   * provides stays invisible to the editor that wants it.
   */
  admin?: SingleAdminOptions;
  /**
   * Whether this Single has the Draft/Published lifecycle enabled. When
   * true, the document bar splits into Save Draft + Update buttons and shows
   * the status pill. Backed by the
   * `dynamic_singles.status` boolean column.
   */
  status?: boolean;
  /**
   * Whether this Single is localized (i18n). Drives the per-language switcher
   * and per-field translatability in the editor. Backed by
   * `dynamic_singles.localized`.
   */
  localized?: boolean;
  /**
   * Whether a status-less save to this published Single is HELD as a pending
   * change rather than written live (the draft/published split). Derived
   * server-side from the same eligibility rule the write uses, so the editor
   * cannot offer an affordance the engine will not honour.
   */
  draftsEnabled?: boolean;
}

/**
 * Single document data
 */
export interface SingleDocumentData {
  id: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface SingleFormProps {
  /**
   * Document-level actions the PAGE owns, folded in with the form's own.
   *
   * DESCRIPTIONS paired with handlers, not rendered controls. Adding a document
   * to a release is a fact about this document, so its control belongs with
   * Publish and Duplicate — but releases are the page's concern, and a form that
   * imported them would have to import translations and every later one too.
   *
   * Describing rather than rendering is what leaves the model free to place the
   * action, order it against the built-ins, and disable it with a reason. A
   * rendered node fixes all three at its call site, and the one that matters is
   * the last: a control that cannot say why it is unavailable has to disappear,
   * which an author cannot tell from a feature that does not exist.
   */
  documentActions?: readonly ContributedAction[];
  /**
   * A strip about the whole document, such as its scheduled release, drawn
   * first among the banners directly under the document bar. Given here rather
   * than placed above the form by the page: the editor's frame pulls itself up
   * over the page's top inset, so anything placed before it slides under the
   * sticky bar.
   */
  documentBanner?: React.ReactNode;
  /** Single schema with field definitions */
  schema: SingleSchema;
  /** Current document data */
  document: SingleDocumentData;
  /**
   * Writes a submission. With the values, the form itself: a publish refused
   * over out-of-date shared fields is resolved on the form as it is when the
   * author acts on the refusal, not as it was submitted. Absent for a
   * reader's write of the status alone, which has no form to resolve it on.
   */
  onSubmit: (
    data: Record<string, unknown>,
    form?: RefusedForm
  ) => Promise<SingleDocumentData | void>;
  /** Whether the form is currently submitting */
  isSubmitting?: boolean;
  /** Callback when the user clicks Discard changes in the system header
   *  dropdown (only shown when the form is dirty). */
  onCancel?: () => void;
  /** Callback when the user picks "View API response" from the system
   *  header dropdown. Singles' API URL pattern differs from collections,
   *  so the page route handles navigation. */
  onViewApi?: () => void;
  /**
   * i18n: the active content language (undefined = app default). Drives the per-language
   * switcher and per-field translatability; saves target this locale. Inert for non-localized
   * singles. Mirrors EntryForm.
   */
  locale?: string;
  /** i18n: switch the active editing language (from the in-form status pills). */
  onLocaleChange?: (locale: string, options?: { seedFrom?: string }) => void;
  /**
   * i18n: default-language field values, so a translatable field can show its source text
   * inline while translating a non-default language. Supplied by the page's source fetch.
   */
  sourceValues?: Record<string, unknown>;
  /** A seed the language switch asked for; forwarded to the copy-from action. */
  seedFromLocale?: string;
  /** Clears that seed once it has been offered. */
  onSeedHandled?: () => void;
  /**
   * i18n: translation mode — the language being translated FROM, the source
   * document read at it, and the way in and out.
   *
   * One prop rather than four, because they are one concept and always travel
   * together: three of them are meaningless without `from`, and a form given
   * some of them is in a state the page cannot produce.
   */
  translation?: {
    /** The source language, or absent when the mode is off. */
    from?: string | undefined;
    /** The source document's values, read at `from`. */
    sourceDocument?: Record<string, unknown> | undefined;
    /** Enter the mode, reading the source from the named language. */
    onEnter?: (source: string) => void;
    /** Leave the mode, keeping the language being edited. */
    onExit?: () => void;
  };
  /**
   * @experimental A plugin's document view to draw in place of the form body,
   * when the route names one.
   */
  documentView?: DocumentViewMount;
  /**
   * When the Single on screen was read, and how to read it again, from the
   * reads that hand it over. Given, a Single this editor gains after a
   * colleague held it stays read-only until the latest version is on screen;
   * absent, it unlocks as it stands.
   */
  latest?: DocumentLatest;
  /** Additional CSS classes */
  className?: string;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Recursively extracts default values from field configurations.
 */

// ============================================================================
// Editor sub-surfaces
// ============================================================================

/**
 * The form's values for a stored document: its fields, with the Single's
 * identity (title and slug) pinned to its config, so the read-only display and
 * the submitted payload always reflect the definition rather than any stale
 * stored value. One derivation for the first render and for every save after.
 */
function singleFormDefaults(
  schema: SingleSchema,
  document: SingleDocumentData
): Record<string, unknown> {
  const values = getDefaultValues(schema.fields, document);
  values.title = schema.label;
  values.slug = schema.slug;
  return values;
}

/**
 * The Single's write gate, declared once with its refused publish's way out.
 *
 * The latch is the synchronous half of the gate. `isSubmitting` is render
 * state: it publishes one render behind the mutation, so two submissions in
 * the same turn both read false and both write. The latch is set the moment
 * the first submission enters and released when it settles, closing that gap;
 * the recovery takes it too. What the recovery reads when it runs is set by
 * the form as it renders: whether its writes are held, and the Save that
 * never publishes, handed up from inside the document's actions where the
 * Save lives. So is whether it holds unsaved work, a field's own held work
 * included, read when newer content arrives under the same key.
 */
function useSingleWriteGate(
  shown: { slug: string; documentId: string; locale: string | undefined },
  resetToDocument: () => void,
  /** The version the editor's copy started from, which a take sends. */
  version: () => string | undefined
) {
  const submissionLatch = useRef(false);
  const writesHeldNow = useRef(false);
  const saveWithoutPublishing = useRef<
    DocumentActionBindings["saveWithoutPublishing"] | undefined
  >(undefined);
  const hasUnsavedWorkNow = useRef(false);
  // Which Single, in which language, is on screen, as a submission asks once
  // it is about to write: it started in one, and the form may hold another
  // language's values by then.
  const scope = JSON.stringify([
    shown.slug,
    shown.documentId,
    shown.locale ?? null,
  ]);
  // A new visit each time the scope changes, so going away and coming back
  // is a move too: the form started afresh from cached values in between.
  const scopeNow = useRef({ scope });
  if (scopeNow.current.scope !== scope) scopeNow.current = { scope };
  // Stored with the Single's own Save, run inside its own write gate, then
  // started afresh from the Single that carries the live values it takes.
  const { refusedForm, recovering } = useRefusedForm({
    scope,
    writesHeld: () => writesHeldNow.current,
    latch: submissionLatch,
    saveWithoutPublishing,
    resetToDocument,
    version,
  });
  return {
    submissionLatch,
    writesHeldNow,
    saveWithoutPublishing,
    hasUnsavedWorkNow,
    scopeNow,
    refusedForm,
    recovering,
  };
}

/**
 * The Single's holds with a refused publish's recovery on top: until its
 * reloaded document is on screen it holds the actions and the autosave
 * (`busy`), the language panels' copies into the form, publishing every
 * language and a version's own writes, as the lock holds the fields.
 */
function recoveryHolds(
  recovering: boolean,
  own: {
    writePending: boolean;
    editsHeld: boolean;
    publishAllHeld: boolean;
    versionWritesHeld: boolean;
    writesHeld: boolean;
  }
): {
  busy: boolean;
  contentHeld: boolean;
  publishAllDisabled: boolean;
  versionWritesHeld: boolean;
  navigationHeld: boolean;
} {
  return {
    busy: own.writePending || recovering,
    contentHeld: own.editsHeld || recovering,
    publishAllDisabled: own.publishAllHeld || recovering,
    versionWritesHeld: own.versionWritesHeld || recovering,
    // Moving to another language as well, so the recovery's Save and take
    // stay on the one they are for.
    navigationHeld: own.writesHeld || recovering,
  };
}

/** Which stored version of which document, in which language, is on screen. */
function singleResetKey(document: SingleDocumentData, locale: unknown): string {
  return `${document.id}:${String(document.updatedAt)}:${String(locale)}`;
}

/**
 * The inline language panel, shown where the docked panel is not.
 *
 * The exact complement of the docked column that otherwise carries the
 * language workflow: shown once the author folds it, and at every width the
 * panel floats or is a sheet at, where it opens only when asked for. Without
 * it a single loses its language workflow whenever the column is away.
 */
/**
 * Whether the Single's shared fields hold unpublished changes, as its editor
 * read says (`_sharedChangesPending`).
 */
function sharedChangesPendingOf(document: unknown): boolean {
  return (
    typeof document === "object" &&
    document !== null &&
    (document as { _sharedChangesPending?: unknown })._sharedChangesPending ===
      true
  );
}

function SingleFormLanguagePanel({
  actionsDisabled,
  navigationDisabled,
  publishAllDisabled,
  enabled,
  hasStatus,
  locale,
  onLocaleChange,
  panelDocked,
  sharedChangesPending,
  translations,
}: {
  actionsDisabled: boolean;
  navigationDisabled: boolean;
  publishAllDisabled: boolean;
  enabled: boolean;
  hasStatus: boolean;
  locale?: string;
  onLocaleChange?: (locale: string, options?: { seedFrom?: string }) => void;
  /** Whether the docked panel, which carries the language panel, is on screen. */
  panelDocked: boolean;
  /** The Single's shared fields hold unpublished changes (`_sharedChangesPending`). */
  sharedChangesPending: boolean;
  translations?: Record<string, { translated: boolean; status?: string }>;
}) {
  if (!enabled) return null;
  return (
    // In line with the title and the fields, not indented past them.
    <div className={cn("pt-4", DOCUMENT_COLUMN_INSET, panelDocked && "hidden")}>
      <DocumentLanguagePanel
        translations={translations}
        locale={locale}
        onLocaleChange={onLocaleChange}
        hasStatus={hasStatus}
        actionsDisabled={actionsDisabled}
        navigationDisabled={navigationDisabled}
        publishAllDisabled={publishAllDisabled}
        sharedChangesPending={sharedChangesPending}
      />
    </div>
  );
}

/**
 * The document body: the live editor's fields, or the version the history
 * panel published. The swap itself is the shared host's; this surface owns
 * what the single renders on the live side of it.
 */
function SingleFormFieldsPanel({
  document,
  historicalFields,
  historicalValues,
  isSubmitting,
  mainFields,
  readOnly,
  singleSlug,
  versionActionsHeld,
  versionBannerSlot,
}: {
  /** The document as loaded, which the form's place hands its blocks. */
  document: SingleDocumentData;
  historicalFields: FieldConfig[] | null;
  historicalValues: Record<string, unknown> | null;
  isSubmitting: boolean;
  mainFields: FieldConfig[];
  readOnly: boolean;
  singleSlug: string;
  /** Why a past version's restore is withheld (see `useVersionActions`). */
  versionActionsHeld: boolean;
  /** Where the version's comparison bar is drawn, among the banners. */
  versionBannerSlot: HTMLElement | null;
}) {
  return (
    <ViewedVersionBody
      fields={historicalFields ?? mainFields}
      values={historicalValues ?? undefined}
      actionsDisabled={versionActionsHeld}
      bannerSlot={versionBannerSlot}
    >
      <EntryFormPlace
        kind="single"
        slug={singleSlug}
        entryId={document.id}
        entry={document}
      >
        {mainFields.length > 0 && (
          <div className="@4xl/content:p-8 pt-6">
            <EntryFormContent
              fields={mainFields}
              disabled={isSubmitting}
              readOnly={readOnly}
              withCard
            />
          </div>
        )}
      </EntryFormPlace>
    </ViewedVersionBody>
  );
}

/**
 * The document panel, framed as the entry editor frames it (docked, floating
 * or a sheet), with the same sections. Its document actions act on the LIVE
 * document, so they are withheld while a past version is on screen — the
 * same withholding the bar's save affordances observe.
 */
function SingleFormRail({
  actionsDisabled,
  navigationDisabled,
  publishAllDisabled,
  entry,
  hasStatus,
  documentStatus,
  singleSlug,
  locale,
  onLocaleChange,
  panel,
  panelOrder,
  placedSectionProps,
}: {
  actionsDisabled: boolean;
  navigationDisabled: boolean;
  publishAllDisabled: boolean;
  entry: React.ComponentProps<typeof EntryFormSidebar>["entry"];
  hasStatus: boolean;
  documentStatus: React.ComponentProps<
    typeof EntryFormSidebar
  >["documentStatus"];
  /** The Single's slug, which releases address it by with its id. */
  singleSlug: string;
  locale?: string;
  onLocaleChange?: (locale: string, options?: { seedFrom?: string }) => void;
  panel: Pick<ReturnType<typeof useDocumentPanel>, "mode" | "shown" | "hide">;
  /** The panel's sections in the order the server placed them. */
  panelOrder: PanelOrderEntry[] | undefined;
  /** What each section plugins declared at the Single's page is handed. */
  placedSectionProps: SidebarSectionProps | undefined;
}) {
  const documentId = entry?.id === undefined ? "" : String(entry.id);
  return (
    <DocumentSidePanel
      mode={panel.mode}
      shown={panel.shown}
      onClose={panel.hide}
    >
      <EntryFormSidebar
        mode="edit"
        {...(panelOrder === undefined ? {} : { panelOrder })}
        {...(placedSectionProps === undefined ? {} : { placedSectionProps })}
        entry={entry}
        hasStatus={hasStatus}
        {...(documentStatus === undefined ? {} : { documentStatus })}
        {...(documentId === ""
          ? {}
          : {
              releaseDocument: {
                scopeKind: "single" as const,
                scopeSlug: singleSlug,
                entryId: documentId,
              },
            })}
        actionsDisabled={actionsDisabled}
        navigationDisabled={navigationDisabled}
        publishAllDisabled={publishAllDisabled}
        {...(locale === undefined ? {} : { locale })}
        {...(onLocaleChange === undefined ? {} : { onLocaleChange })}
      />
    </DocumentSidePanel>
  );
}

// ============================================================================
// Component
// ============================================================================

/**
 * SingleForm - Form for editing Single document data
 *
 * A complete form component for editing Single documents.
 * Automatically generates form fields from Single schema, handles validation
 * with Zod, and manages update operations.
 *
 * ## Features
 *
 * - Dynamic form generation from Single schema
 * - Zod validation from field configurations
 * - Two-column layout with metadata sidebar
 * - Loading and submitting states
 * - Dirty state tracking
 * - Unsaved changes protection
 * - Autosave to a server-side recovery point, offered back on return
 * - Keyboard shortcuts (Cmd/Ctrl+S to save)
 *
 * @example
 * ```tsx
 * function SingleEditPage({ slug }: { slug: string }) {
 *   const { data: schema } = useSingleSchema(slug);
 *   const { data: document } = useSingleDocument(slug);
 *   const { mutateAsync: updateDocument, isPending } = useUpdateSingleDocument(slug);
 *
 *   if (!schema || !document) return <Skeleton />;
 *
 *   return (
 *     <SingleForm
 *       schema={schema}
 *       document={document}
 *       onSubmit={updateDocument}
 *       isSubmitting={isPending}
 *     />
 *   );
 * }
 * ```
 */

export function SingleForm({
  schema,
  document,
  onSubmit,
  isSubmitting = false,
  onCancel,
  onViewApi,
  locale,
  onLocaleChange,
  seedFromLocale,
  onSeedHandled,
  translation,
  sourceValues,
  className,
  documentActions,
  documentBanner,
  documentView,
  latest,
}: SingleFormProps): React.JSX.Element {
  // Generate Zod schema from field configurations. Singles render title/slug
  // read-only from config, so relax their required rule — submitting must not
  // error when they aren't user-entered.
  const zodSchema = useMemo(() => {
    try {
      // Singles are always an update of the one existing document, so the
      // schema runs in edit mode (blank password = keep current).
      return generateClientSchema(relaxIdentityRequired(schema.fields), {
        mode: "edit",
      });
    } catch (error) {
      console.error("Failed to generate schema:", error);
      return z.record(z.string(), z.unknown());
    }
  }, [schema.fields]);

  // Password fields submit "" to mean "keep the stored hash", so they are
  // exempt from the blank-to-null normalization applied on submit.
  const blankPasswordFields = useMemo(
    () => passwordFieldNames(schema.fields),
    [schema.fields]
  );

  // Generate default values from document data, then pin the single's identity
  // (title/slug) to its config so the read-only display and the submitted
  // payload always reflect the definition rather than any stale stored value.
  const defaultValues = useMemo(
    () => singleFormDefaults(schema, document),
    [schema, document]
  );

  // Initialize form
  //
  // Why mode: "onSubmit" — matches EntryForm. The previous "onBlur"
  // setting fired field-level validation when a required field was
  // blurred empty, which surfaced inline errors and the top-level
  // toast before the user had tried to save. "onSubmit" keeps the
  // form quiet until the user clicks Save Draft / Publish, after which
  // RHF's default reValidateMode: "onChange" keeps errors in sync as
  // the user fixes them.
  const form = useForm<Record<string, unknown>>({
    resolver: zodResolver(zodSchema),
    defaultValues,
    mode: "onSubmit",
  });
  // The values a restore puts into this form, whose sources the save names.
  const formRestore = useFormRestore(form);

  // Keep the latest computed defaultValues in a ref so the reset effect can read
  // them without depending on the `defaultValues` object identity: React Query
  // refetches produce a fresh reference even for identical data, so depending on
  // it would reset the form mid-edit and discard unsaved changes.
  const defaultValuesRef = useRef(defaultValues);
  defaultValuesRef.current = defaultValues;

  // Reset the form only when the document's identity actually changes (different
  // ID or new version) or the active locale changes — not on every refetch. The
  // effect depends on the full reactive values (document, locale, form), but a
  // last-applied key guards the reset so a refetch that returns the same
  // id/updatedAt/locale is a no-op and preserves in-progress edits. `locale` is a
  // trigger so switching to an already-cached language (no refetch, so no
  // unmount/remount) still resets the form to that locale's values; otherwise the
  // previous language's inputs would linger. A first-time switch refetches and
  // remounts via the page's loading gate, which resets naturally.
  //
  // The stored document this author's own save produced arrives here too, and
  // resetting to it blindly would wipe whatever they typed while the save was
  // in flight; the save has already made it the form's starting point, so that
  // echo keeps unsaved edits. Recognised while the save is in flight, and
  // afterwards by the key of the document it stored. Any other new version —
  // a restore, a colleague's change, another language — resets the form to
  // it, as Restore promises when it warns unsaved work is discarded.
  const lastResetKeyRef = useRef<string | null>(null);
  // Which document, in which language, the form was last reset to: a new
  // version of that is the case an own-save echo can be.
  const lastResetPlaceRef = useRef<string | null>(null);
  const ownSave = useRef<{ inFlight: boolean; storedKey?: string }>({
    inFlight: false,
  });
  // The version the copy on screen started from, sent with every write, and
  // the conflict a write refused because the Single changed since opens; the
  // same rules as the entry editor's.
  const version = useVersionConflict();
  const {
    pinned: versionPinned,
    refusedFrom,
    release: releaseConflict,
    adoptRead,
  } = version;
  // Set when the author chose to load the current version before the read
  // that brings it arrived.
  const awaitingCurrent = useRef(false);
  // The document as last handed over, for loading it on the author's choice.
  const latestDocument = useRef(document);
  latestDocument.current = document;

  // The write gate and a refused publish's way out, declared once.
  const {
    submissionLatch,
    writesHeldNow,
    saveWithoutPublishing,
    hasUnsavedWorkNow,
    scopeNow,
    refusedForm,
    recovering,
  } = useSingleWriteGate(
    { slug: schema.slug, documentId: document.id, locale },
    () => {
      form.reset(defaultValuesRef.current);
      // The take rewrote the pending change after its Save had stored it, so
      // it counts as a save too: the preview pane moves past the values it
      // replaced, and a recovery point from before it is withdrawn.
      setSavedCount(n => n + 1);
    },
    version.startedFrom
  );

  useEffect(() => {
    if (!document) return;
    const resetKey = singleResetKey(document, locale);
    const place = JSON.stringify([document.id, locale ?? null]);
    if (
      (awaitingCurrent.current || versionPinned()) &&
      lastResetPlaceRef.current !== null &&
      lastResetPlaceRef.current !== place
    ) {
      // A read of another language: the conflict was about the refused one,
      // and holding this read would leave the form showing and saving that
      // language's values. It goes, and the read resets the form below.
      awaitingCurrent.current = false;
      releaseConflict();
    } else if (awaitingCurrent.current) {
      // The read the author asked for: newer than the version the refused
      // edits began from, which are kept as a recovery point.
      if (versionOf(document) === refusedFrom()) return;
      awaitingCurrent.current = false;
      releaseConflict();
      lastResetKeyRef.current = resetKey;
      lastResetPlaceRef.current = place;
      adoptRead(document);
      form.reset(defaultValuesRef.current);
      return;
    } else if (versionPinned()) {
      // A refused save holds the form: the newer version that follows the
      // refusal must not reset the edits before the author chooses. Noted,
      // so it is not taken for a newer one once they have.
      lastResetKeyRef.current = resetKey;
      lastResetPlaceRef.current = place;
      return;
    }
    if (lastResetKeyRef.current === resetKey) {
      // The same key can carry newer content: a pending-change save, or the
      // live values a refused publish's recovery takes, keep it. A form
      // holding nothing unsaved has nothing to lose, so it takes that content.
      // Not while a field holds work the form's values lack, such as an open
      // page builder: starting afresh would re-seed the field under it.
      if (!hasUnsavedWorkNow.current) {
        adoptRead(document);
        form.reset(defaultValuesRef.current);
      }
      return;
    }
    const sameDocument = lastResetPlaceRef.current === place;
    lastResetKeyRef.current = resetKey;
    lastResetPlaceRef.current = place;
    const echoOfOwnSave =
      sameDocument &&
      (ownSave.current.inFlight || resetKey === ownSave.current.storedKey);
    // A read replaces the copy: its version is what the copy starts from. An
    // echo of this author's own save keeps the version that save answered.
    if (!echoOfOwnSave) adoptRead(document);
    form.reset(defaultValuesRef.current, { keepDirtyValues: echoOfOwnSave });
  }, [
    document,
    locale,
    form,
    hasUnsavedWorkNow,
    versionPinned,
    refusedFrom,
    releaseConflict,
    adoptRead,
  ]);

  // submitCount gates the top-level "Please fix" toast so the user
  // doesn't see it until they actually click Save Draft / Publish.
  const { errors, submitCount } = form.formState;
  const isDirty = form.formState.isDirty;

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  /*
   * Whether the preview pane is open, and how many times this form has saved.
   *
   * The count feeds the preview revision, and it is needed for the reason the
   * entry editor needs it: a status-less save of a PUBLISHED document writes
   * the working-draft sidecar and leaves the live row alone, so from the second
   * such save onward the document's own `updatedAt` and its working-draft flag
   * both stand still while its content changes underneath them. Counting saves
   * is the only signal to that write available on this side of the wire.
   */
  const [savedCount, setSavedCount] = useState(0);

  /*
   * Where the past version's comparison bar is drawn: a place among the
   * Single's banners under the bar, which the version body draws into. State
   * rather than a ref, so the body re-renders once the place exists.
   */
  const [versionBannerSlot, setVersionBannerSlot] =
    useState<HTMLDivElement | null>(null);

  // Submit handler. The intent arg names the user's button click and
  // determines payload shape — same intent set as the collection
  // EntryForm (see EntryFormIntent). Mirrors the EntryForm pattern.
  /*
   * The advisory claim, derived before the first write is defined because every
   * write has to be able to ask about it.
   */
  // A user who may read this Single but not change it gets the same page,
  // read-only, with no claim made on the document.
  const updateAnswer = useUpdateAnswer(schema.slug);
  // A Single removed from code refuses every write, for everyone: the page
  // opens as it does for a reader, through the same gates.
  const removedFromCode = isRemovedFromCode(schema);
  const readOnlyForReader = updateAnswer === "refused" || removedFromCode;
  // What the user's access allows, apart from the removal: previewing and
  // sharing a preview follow it alone, since the server keeps preview links
  // working for a removed Single and opening one writes nothing.
  const accessAllowsEdits = editsOffered(updateAnswer);
  // While a language switch's answer is on its way, nothing that saves is
  // offered and a submit is held, though the page is not read-only.
  const mayEdit = accessAllowsEdits && !removedFromCode;
  const previewHeld = !accessAllowsEdits;
  // What changing the Single needs is held with it: a recovery point and a
  // version's restore, for a reader, for a removed Single and while a
  // language switch's answer is on its way.
  const updatesHeld = !mayEdit;
  // While a refused publish's recovery runs, every field it reaches is
  // read-only, as it is while someone else holds the Single.
  const lockSurface = useDocumentLockSurface({
    scopeKind: "single",
    slug: schema.slug,
    entryId: document.id,
    readOnlyForReader,
    readOnlyBecause: removedFromCode ? "removed-from-code" : "access",
    latest,
    // Every claim and beat names the copy's version, so the holder is told
    // when someone else changes the Single. Only where the editor can load
    // the latest copy: one that cannot would say it shows what it does not.
    version: latest ? version.startedFrom : undefined,
  });
  // A gained Single's latest version starts the whole form again, whatever
  // its `updatedAt` says, and the lock holds until it has; the document views
  // key on the count it carries. Someone else's change is said over it.
  const lock = useLockWithHeldChange(
    heldWhileRecovering(
      useResetOnReload(form, lockSurface, defaultValues),
      recovering
    ),
    {
      surface: lockSurface,
      hold: version.holdForChange,
      latest,
      release: version.release,
    }
  );

  // System fields: title (drawn first in the editor) and slug (not drawn for a
  // Single, whose slug its config fixes). Per the
  // special-casing. Any user-defined field with admin.position: "sidebar"
  // now renders inline like every other Builder field.
  const allFields = schema.fields;
  const titleField = allFields.find(f => "name" in f && f.name === "title");
  const slugField = allFields.find(f => "name" in f && f.name === "slug");
  // Takeover layout: a field flagged `layout: "takeover"` (when active) collapses the
  // body to itself + its condition controller. Generic — driven by field-type metadata.
  // Asked of the shared hook so the entry editor cannot answer it differently.
  const { mainFields, controllerNames, takeoverTypes } = useTakeoverLayout(
    allFields,
    form
  );

  // Which past version the document area is showing, the context value that
  // publishes it to the history panel, and the version's own body layout. The
  // same host the entry editor uses: the panel is mounted from the system
  // header for singles too, so the document side has to answer it the same
  // way — without this, a click in the panel publishes a version nothing
  // draws.
  // The Single's version in a language, for a restore from its history: the
  // version this copy started from in its own language, else read.
  const { defaultLocale: shownDefaultLocale } = useLocalization();
  const versionFor = useCallback(
    (wanted: string | null) =>
      versionForLanguage({
        wanted,
        shown: locale ?? shownDefaultLocale ?? null,
        startedFrom: version.startedFrom(),
        readIn: inLocale =>
          singleApi.getDocument(schema.slug, { locale: inLocale }),
        readShown: () =>
          singleApi.getDocument(schema.slug, {
            locale,
            draft: schema.draftsEnabled === true,
          }),
      }),
    [locale, shownDefaultLocale, version, schema.slug, schema.draftsEnabled]
  );
  // What a restore puts values back into: this form, under its lock.
  const { getLocale: localeOf, defaultLocale: editingDefault } =
    useLocalization();
  // The language being edited: the default where the address names none.
  const editingLocale = locale ?? editingDefault;
  const editingLanguage = localeOf(editingLocale)?.label;
  const editorRestore = useEditorRestoreSurface({
    restore: formRestore,
    form,
    fields: allFields,
    readOnly: () => lock.readOnly,
    localized: schema.localized === true,
    ...(editingLanguage ? { language: editingLanguage } : {}),
    ...(editingLocale ? { locale: editingLocale } : {}),
  });
  const viewedVersionHost = useViewedVersion(
    allFields,
    takeoverTypes,
    versionFor,
    editorRestore
  );
  const {
    viewingVersion,
    documentHistory,
    historicalFields,
    historicalValues,
  } = viewedVersionHost;
  // One answer for every surface offering a write — the header reads the same
  // through the document-actions model, and the rail, the language panel and
  // the submission handlers below take it from here. Derived from the HOST's
  // state, not the context: this body renders ABOVE the provider this
  // component creates, so a context read here would report no version on
  // screen even while one is.
  const writesHeld = writeActionsHeld(viewingVersion, lock.actionsDisabled);
  // Changing the content is held for a reader as well.
  const editsHeld = writesHeld || !mayEdit;
  // A status write alone is held where the document's writes are, and for a
  // Single removed from code, whose publish the server refuses as it refuses
  // a save.
  const statusWriteHold = writesHeld || removedFromCode;
  // Publishing every language changes only each language's status, so a
  // reader whose document nothing else holds is still offered it.
  const publishAllHeld = statusWritesHeld({
    editsHeld,
    refused: readOnlyForReader,
    writesHeld: statusWriteHold,
  });
  // A refused publish's recovery changes the content, so it is held exactly
  // as the content's own saves are.
  writesHeldNow.current = editsHeld;
  // The synchronous half of the same gate is `submissionLatch`, declared above
  // because a refused publish's recovery takes it too.

  // Throwing away this language's pending change. Scoped to the active locale:
  // a localized Single holds one per language, so discarding without naming one
  // would remove work in a language the author never opened. Declared beside
  // the busy state because the busy state counts its in-flight flag — restore
  // racing a discard would let completion order decide which document state
  // survives, exactly as with a save.
  const discardMutation = useDiscardSingleWorkingDraft({
    slug: schema.slug,
    documentId: document.id,
    locale,
  });
  // A save or a discard in flight.
  const writePending = isSubmitting || discardMutation.isPending;
  // Each of the Single's holds, and a refused publish's recovery on top.
  const {
    busy,
    contentHeld,
    publishAllDisabled,
    versionWritesHeld,
    navigationHeld,
  } = recoveryHolds(recovering, {
    writePending,
    editsHeld,
    publishAllHeld,
    // A colleague's claim or a reader's page, without the version on
    // screen: what holds the actions a version's own surfaces offer,
    // Restore among them.
    versionWritesHeld: lock.actionsDisabled || updatesHeld,
    writesHeld,
  });
  // Every switch to another language goes through here, held with the rest,
  // and while a told change waits for an answer about this language's edits.
  const switchLocale = heldLocaleChange(
    onLocaleChange,
    recovering || lock.changeAwaitingAnswer
  );

  // A write of the status alone, as a reader's publish or unpublish sends it:
  // it names no field, so the server judges it by that permission alone, and
  // it does not read the form, which a reader cannot change.
  // A save the server stored: counted, its version adopted as the copy's,
  // and no change told before held over it, since the copy is now current.
  const adoptSaved = useCallback(
    (stored: Awaited<ReturnType<typeof onSubmit>>, write: VersionWrite) => {
      setSavedCount(n => n + 1);
      if (stored) {
        ownSave.current.storedKey = singleResetKey(stored, locale);
        // As the write that answered it asked, when it started.
        write.answered(stored);
      }
      write.released();
    },
    [locale]
  );
  const writeStatus = useCallback(
    async (status: "published" | "draft"): Promise<SubmitOutcome> => {
      if (busy || submissionLatch.current) return submitBusy;
      submissionLatch.current = true;
      const write = version.writeFor();
      try {
        const stored = await onSubmit(version.withVersion({ status })).catch(
          (error: unknown) => {
            write.refused(error, { status });
            throw error;
          }
        );
        adoptSaved(stored, write);
        return { ok: true, item: { id: document.id } };
      } catch (error) {
        return submitFailed(error);
      } finally {
        submissionLatch.current = false;
      }
    },
    [busy, onSubmit, document.id, submissionLatch, version, adoptSaved]
  );

  // Recovery points for this author, the same mechanism the entry editor uses.
  // A Single always exists once its schema does, so unlike an entry there is no
  // pre-creation state -- but the address still comes from the stored document,
  // so a schema whose row has not been materialised yet records nothing rather
  // than addressing a document that is not there.
  const autosaveScope = useMemo(
    () => autosaveScopeFor("single", schema.slug, document?.id),
    [schema.slug, document?.id]
  );
  /*
   * Whether this Single keeps recovery points: autosave on, and a stored row
   * to record against. The server refuses a recording anywhere else, so where
   * this is false the editor records nothing, offers nothing back and shows no
   * recording status. One answer for every recorder in the editor, the page
   * builder's included, and for keeping a refused save's edits.
   */
  const keepsRecoveryPoints =
    autosaveScope !== null && autosaveEnabledFor(schema);
  // Where a save and publishing every language wait for its recordings.
  const recordingsFor = documentRecordingKey(autosaveScope);

  // Resolves to what the submission came to, never rejects, as the entry
  // editor's does: the toasts report to the author, the outcome to the caller.
  const handleSubmit = useCallback(
    async (
      e?: React.BaseSyntheticEvent,
      intent?: EntryFormIntent
    ): Promise<SubmitOutcome> => {
      e?.preventDefault();

      // 🔴 The one gate every write passes through. Save, Publish, Unpublish, the
      // keyboard shortcut and a native form submit all reach this function, and
      // disabling the affordances one at a time is a list that the next write
      // path gets added without. The affordances ARE disabled, so nothing offers
      // what it cannot do - this is the guard that does not depend on anyone
      // remembering. Reading a past version is part of the same claim: this
      // handler acts on the live document, which is not what is on screen. And
      // so is a submit already in flight — parallel writes would let completion
      // order decide which contents survive.
      if (editsHeld) {
        // A reader's publish and unpublish still go, as the status alone.
        const status = readerStatusWrite(intent, {
          refused: readOnlyForReader,
          writesHeld: statusWriteHold,
        });
        return status === undefined ? submitHeld : writeStatus(status);
      }
      // A save or discard in flight; a refused publish's recovery runs its
      // Save through here, and holds the rest of the editor itself.
      if (writePending || submissionLatch.current) return submitBusy;
      submissionLatch.current = true;
      // The language this submission is for.
      const startedIn = scopeNow.current;

      try {
        return await submitDocument({
          form,
          event: e,
          // Asked again once validation is done, immediately before the
          // write: the Single can change hands while it runs.
          mayWrite: () => !writesHeldNow.current,
          // And the editor can move to another language.
          stillShown: () => scopeNow.current === startedIn,
          // The values a restore put in, whose sources the save names.
          restore: formRestore,
          // This Single's recovery points, addressed as its recorder does.
          recordingsFor,
          // Why: shared intent→payload helper mirrors the EntryForm
          // contract (see useEntryForm.mapIntentToPayload). Unpublish
          // strips other dirty fields so a confirm-modal misclick can't
          // ship unrelated changes to the public site.
          toPayload: values =>
            mapIntentToPayload(values, intent, blankPasswordFields),
          write: async data => {
            // A link the editor cannot see is held in the form as a
            // placeholder and written as the reference it stands for.
            ownSave.current.inFlight = true;
            const payload = withoutPlaceholders(schema.fields, data);
            const write = version.writeFor();
            const stored = await onSubmit(
              version.withVersion(payload),
              refusedForm
            )
              .catch((error: unknown) => {
                // A save made from an older version holds the edits on
                // screen and opens the conflict; the failure is still told.
                write.refused(error, payload, data);
                throw error;
              })
              .finally(() => {
                ownSave.current.inFlight = false;
              });
            if (stored) write.answered(stored);
            // Saved, so the copy is the current version: nothing a change
            // told before still holds it.
            write.released();
            // After the write lands and before the reset: this is the only
            // point that knows a save succeeded, and a revision that misses
            // one leaves the pane showing the previous draft.
            setSavedCount(n => n + 1);
            if (stored) {
              ownSave.current.storedKey = singleResetKey(stored, locale);
            }
            return {
              // A Single is one document, so what was saved is the one on
              // screen; `onSubmit` reports no row of its own.
              item: { id: document.id },
              // A host that reports no stored document leaves the form at
              // what was sent, the best starting point there is. So does a
              // save that sent a placeholder: the stored document leaves out
              // the link it stands for, and taking it in would drop the link
              // from the form, for the next save to remove.
              stored:
                stored && !holdsPlaceholders(schema.fields, data)
                  ? singleFormDefaults(schema, stored)
                  : null,
            };
          },
        });
      } finally {
        submissionLatch.current = false;
      }
    },
    [
      form,
      formRestore,
      onSubmit,
      refusedForm,
      blankPasswordFields,
      writePending,
      editsHeld,
      readOnlyForReader,
      statusWriteHold,
      writeStatus,
      document.id,
      schema,
      locale,
      writesHeldNow,
      submissionLatch,
      scopeNow,
      recordingsFor,
      version,
    ]
  );

  // The author's choices on a save refused because the Single changed since,
  // as the entry editor's. Save anyway: the refused write again, saving over
  // the newer version on purpose, after the dialog that says whose changes it
  // replaces.
  const saveAnyway = useCallback(async (): Promise<void> => {
    const payload = version.overwrite();
    if (!payload || submissionLatch.current) return;
    // Through the same gate as a save: someone else holding the Single now
    // stores nothing over their work.
    if (writesHeldNow.current) {
      version.failed(
        "Someone else is editing this document now, so nothing was saved."
      );
      return;
    }
    // The values the refused edits were typed as: a link the editor cannot
    // see is a placeholder there, which the stored document leaves out. A
    // refused status write carried none, so the form keeps what it holds, as
    // after a status write that went through.
    const sent = version.refusedValues();
    submissionLatch.current = true;
    ownSave.current.inFlight = true;
    const write = version.writeFor();
    try {
      const stored = await onSubmit(payload, refusedForm);
      adoptSaved(stored, write);
      if (sent !== undefined) {
        form.reset(
          stored && !holdsPlaceholders(schema.fields, sent)
            ? singleFormDefaults(schema, stored)
            : sent
        );
      }
    } catch (error) {
      version.failed(
        error instanceof Error ? error.message : "The save did not go through."
      );
      throw error;
    } finally {
      ownSave.current.inFlight = false;
      submissionLatch.current = false;
    }
  }, [
    version,
    submissionLatch,
    writesHeldNow,
    onSubmit,
    refusedForm,
    form,
    schema,
    adoptSaved,
  ]);

  // Load the current version: the edits are first kept as a recovery point
  // that remembers the version they began from; only then does the form take
  // the current version. When the point cannot be written, nothing is
  // replaced and the conflict stays open.
  // Whether the conflict's edits can be kept: a Single with autosave on.
  lock.now.keepsEdits = keepsRecoveryPoints;
  // With `keepEdits` false, for a Single that keeps no recovery points, the
  // edits are discarded, as the conflict said they would be.
  const loadCurrentVersion = useCallback(
    async (keepEdits: boolean): Promise<void> => {
      if (!version.pinned()) return;
      if (keepEdits) {
        try {
          await version.keepEdits(
            autosaveScope,
            form.getValues(),
            locale ?? null
          );
        } catch (error) {
          version.failed(
            "Your edits could not be kept, so nothing was replaced. Try again."
          );
          throw error;
        }
      }
      const current = latestDocument.current;
      if (current && versionOf(current) !== version.refusedFrom()) {
        lastResetKeyRef.current = singleResetKey(current, locale);
        lastResetPlaceRef.current = JSON.stringify([
          current.id,
          locale ?? null,
        ]);
        version.release();
        version.adoptRead(current);
        form.reset(defaultValuesRef.current);
        return;
      }
      // The read that brings the current version is still on its way.
      awaitingCurrent.current = true;
    },
    [version, autosaveScope, form, locale]
  );

  const handleCancel = useCallback(() => {
    onCancel?.();
  }, [onCancel]);

  // ---------------------------------------------------------------------------
  // Keyboard Shortcuts
  // ---------------------------------------------------------------------------

  /*
   * Work a FIELD holds that the form's values do not contain — the page builder
   * commits its document on exit, so the form is not dirty while it is open.
   *
   * Declared HERE rather than beside the autosave below: the document's
   * actions and the save shortcut read it, and a save guarded on the form's
   * own flag declines for the whole time the editor is open.
   */
  const unsavedWork = useFormUnsavedWork(isDirty);
  const hasUnsavedWork = unsavedWork.hasUnsavedWork;
  hasUnsavedWorkNow.current = hasUnsavedWork;
  // The page builder's own store included, which the form does not hold.
  lock.now.hasUnsavedWork = hasUnsavedWork;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // Status flag — singles can opt into Draft/Published via schema.status.
  // When true, the document bar shows Save Draft / Update split and the
  // status pill.
  const hasStatus = schema.status === true;

  // Auto-fill slug from title — same form-level pattern as EntryForm. The
  // title input is the editor's own (DocumentTitleBlock, not TextInput) so the slug
  // generator must be mounted at the form level to see its keystrokes.
  // Why "name" in f narrowing: SingleForm's allFields type union still
  // includes options without `name` (legacy SingleSchema typing); the
  // titleField/slugField extraction above did the same narrowing dance.
  const titleFieldName =
    titleField && "name" in titleField ? (titleField.name as string) : "title";
  const slugFieldName =
    slugField && "name" in slugField ? (slugField.name as string) : "slug";
  // Singles never auto-generate the slug — it's fixed by the single's config
  // and rendered read-only. Keep the hook mounted (stable hook order) but
  // disabled so it never writes to the slug field.
  useAutoSlug({
    form,
    titleFieldName,
    slugFieldName,
    enabled: false,
  });

  // i18n: per-locale writing direction (RTL) + the app default locale, for the content-locale
  // context passed to field components and the language pills. Inert for non-localized singles.
  const {
    getLocale,
    defaultLocale,
    enabled: localizationEnabled,
  } = useLocalization();
  // The status of the language being edited, read as the entry editor reads
  // it, not the main row's: an untranslated language of a published Single
  // is not published. The status the bar's pill shows and the context
  // carries, once, so the two cannot disagree.
  const documentStatus =
    effectiveEntryStatus(document, locale, defaultLocale) ?? "draft";
  const editedStatus = {
    status: documentStatus,
    hasWorkingDraft: hasPendingWorkingDraft(document),
    untranslated: editedLanguageUntranslated(document, locale, defaultLocale),
  };

  // One decision rather than three: which language the link is for, whether it
  // can be offered at all, and the mint itself. No site URL is computed here —
  // a link that travels by email or chat has to name a host, and the server is
  // the only place that can.
  const previewLink = useSinglePreviewLink({
    slug: schema.slug,
    localized: schema.localized === true,
    hasStatus,
    locale,
    defaultLocale,
  });

  // The per-locale translation-status map, read once and shared by the header
  // adapter and the language panel: two reads of the same document key would
  // agree today and drift the moment one of them learns a new shape.
  const singleTranslations = (
    document as {
      _translations?: Record<string, { translated: boolean; status?: string }>;
    }
  )._translations;

  // Read once: the rail's language panel and the inline one say it alike.
  const sharedChangesPending = sharedChangesPendingOf(document);

  // Adapt the SingleDocumentData shape into what the document bar and the
  // rail panels expect (entry.id / entry.status / entry.created_at /
  // entry.updated_at). The structural alignment is straightforward — singles
  // already carry id and updatedAt; status/createdAt are passed through if
  // present.
  const entryLike = {
    id: document.id,
    status: documentStatus,
    // The flag the bar reads to show Changed and offer Discard. Forwarded
    // rather than recomputed: the server sets it only when a pending change was
    // actually overlaid, which is what makes it per-language.
    _isWorkingDraft:
      (document as { _isWorkingDraft?: boolean })._isWorkingDraft === true,
    createdAt: (document as { createdAt?: string }).createdAt,
    updatedAt: document.updatedAt,
    title: (document as { title?: string }).title,
    // forward the per-locale translation-status map so the rail's Document panel renders
    // the per-language pills (DocumentPanel reads `entry._translations`). Absent for non-localized
    // singles / when translation-status wasn't requested → pills render nothing.
    _translations: singleTranslations,
    // Forwarded for the rail's language panel, which says while the Single's
    // shared fields hold unpublished changes, docked as inline.
    _sharedChangesPending: sharedChangesPending,
  } as unknown as Parameters<typeof DocumentBar>[0]["entry"];

  // i18n: content-locale context for field components + the rail's language panel.
  //
  // `collectionSlug`/`entryId` stay absent because a single genuinely has
  // neither. They used to double as the gate for copy-from-language, which made
  // the action collection-only by accident of addressing rather than by intent;
  // it now gates on `fetchSourceValues`, which a single can answer. Inert for
  // non-localized singles.
  // The Single's own publish-every-language mutation, handed to the shared
  // availability rule through the locale context. A Single is addressed by its
  // slug alone, so it supplies its own action exactly as it supplies its own
  // source read.
  const publishAllSingleLanguages = usePublishAllSingleLocales({
    slug: schema.slug,
    // The copy on screen, read as the editor reads it, so a publish of every
    // language is refused when that language changed since it opened.
    shown: () => ({
      version: version.startedFrom(),
      locale,
      draft: schema.draftsEnabled === true,
    }),
  });
  // Publishing every language waits for the Single's recordings in flight.
  const afterRecordings = useAfterRecordings(
    recordingsFor,
    publishAllSingleLanguages.isPending
  );

  const translationMode = useTranslationSource({
    fields: schema.fields,
    documentLocalized: schema.localized === true,
    // Never split under a document view, whatever the address asks — the
    // reason the entry editor gives.
    translation: documentView ? undefined : translation,
    locale,
    defaultLocale,
    getLocale,
  });

  // Every part of the in-place preview, decided together — see the module.
  const previewPane = useSinglePreviewPane({
    link: previewLink,
    document,
    savedCount,
    inTranslationMode: translationMode.source !== undefined,
    admin: schema.admin,
  });
  // Whether the pane is actually on screen, as the pane itself reads below.
  // A removed Single keeps it: the preview follows access alone, as
  // previewing writes nothing.
  const previewOnScreen = previewPane.open && !documentView && !previewHeld;

  // The document panel, as the entry editor decides it (`useDocumentPanel`):
  // the collapse choice shared with it, history taking its place, and the
  // preview pane sharing the right side with it.
  const panel = useDocumentPanel({
    historyAvailable: historyEnabledFrom(schema) !== false,
    previewOpen: previewOnScreen,
    closePreview: previewPane.onClose,
  });
  // The edit page's place: plugins' blocks around the bar and the editor,
  // their tabs over the field column and their sections in the panel.
  const documentPlace = useDocumentPlace(
    { kind: "single", single: schema.slug },
    document
  );
  // The fields a plugin's tab edits are drawn in that tab, not here; every
  // field keeps its value in the form, so Save still stores them.
  const fieldNames = useMemo(() => topLevelFieldNames(allFields), [allFields]);
  const contentFields = useContentFields(documentPlace, fieldNames, mainFields);
  // The side panel's sections in the order the server placed them, with the
  // sections plugins declared at the Single's page among them, as on a
  // collection entry's page.
  const { panelOrder, sectionsAboveForm, placedSectionProps } =
    useDocumentPanelParts(documentPlace, panel.mode === "sheet");

  const localeCtx = useEntryLocaleContext({
    locale,
    defaultLocale,
    getLocale,
    documentLocalized: schema.localized === true,
    fields: schema.fields,
    sourceValues,
    inTranslationMode: translationMode.active,
    onLocaleChange: switchLocale,
    seedFromLocale,
    onSeedHandled,
    onEnterTranslationMode: translationMode.onEnter,
    // A single is addressed by its slug alone, so it supplies its own read and
    // no entry addressing at all.
    fetchSourceValues: singleSourceFetcher(schema.slug),
    publishAllLanguages: {
      slug: schema.slug,
      // After this Single's recordings in flight land, as a save waits.
      publish: () => afterRecordings.run(publishAllSingleLanguages.mutate),
      pending: afterRecordings.pending,
      preview: () => singleApi.previewPublishAllLocales(schema.slug),
      previewKey: ["publish-all-preview", "single", schema.slug],
    },
  });

  /*
   * The same advisory claim the entry editor holds, on the same terms. A single
   * is addressed by its slug and the row behind it, and before that row exists
   * there is nothing to claim and nobody else can be in it.
   */

  const autosave = useDocumentAutosave({
    scope: autosaveScope,
    form,
    locale: locale ?? null,
    // Recording is for editing: held off while a real save is in flight and
    // while a PAST VERSION is on screen — the shared predicate states the
    // rule, and the entry editor records on exactly the same terms. A
    // colleague's claim deliberately does not stop it: the recovery point is
    // this author's own work, which is what a takeover preserves.
    // Nor is a reader's form recorded, which cannot change the document, nor
    // one whose language's answer is on its way, which may not yet. Nor a
    // Single that keeps no recovery points at all.
    enabled:
      keepsRecoveryPoints &&
      !updatesHeld &&
      mayRecordRecovery(busy, viewingVersion),
    // The pace the Single configures, else the editor's default.
    debounceMs: autosaveIntervalFrom(schema),
    // Each point records the version its edits began from.
    version: version.startedFrom,
  });
  const recovery = offerHeldWhileRecovering(
    useAutosaveRecovery({
      // A reader is offered no recovery point: restoring one would make the
      // read-only form dirty with work it cannot save.
      scope: readOnlyForReader || !keepsRecoveryPoints ? null : autosaveScope,
      form,
      // The language the form shows: a point recorded in another is never
      // taken for the document.
      locale: locale ?? null,
      savedCount,
      // A save of restored edits is judged by the version they began from.
      onRestored: version.adoptRecovered,
    }),
    recovering
  );
  // Load the current version, keeping the edits as a recovery point where the
  // document keeps them and offering it then; elsewhere the edits are
  // discarded, as the conflict said they would be. One way, for a refused
  // save's dialog and for someone else's change alike.
  lock.now.keepEditsAndLoad = async () => {
    await loadCurrentVersion(keepsRecoveryPoints);
    if (keepsRecoveryPoints) recovery.recheck();
  };
  // Kept editing after a load that has not read the current version: that
  // version no longer replaces the edits when it arrives.
  lock.now.stopLoadingCurrent = () => {
    awaitingCurrent.current = false;
  };

  /*
   * Throwing away this language's pending change, through the same gate as a
   * save: it reaches the row directly and never passes `handleSubmit`. The
   * latch is held for its duration so a save started in the same turn cannot
   * run against it.
   */
  const discardWorkingDraft = async () => {
    if (editsHeld || busy || submissionLatch.current) {
      return;
    }
    submissionLatch.current = true;
    try {
      // With the version the copy started from: a discard moves the Single's
      // version, so the copy then starts from the one it answered.
      const result = await discardMutation.mutateAsync(version.startedFrom());
      version.adoptRead(result.item);
    } finally {
      submissionLatch.current = false;
    }
  };

  /*
   * What deciding this document's actions reads. The storing handlers hand
   * back their outcome so an action run from outside the header can say what
   * it came to.
   */
  /*
   * The recovery point, once, for every place the save state is drawn: the
   * header's chip, and a document view's own through the host.
   */
  const recoveryPoint: RecoveryPointState = {
    enabled: keepsRecoveryPoints,
    storedAt: autosave.lastSavedAt,
    // A recovery point newer than the stored document, still on offer: its
    // edits are not stored, whatever the form says.
    pendingOfferAt: recovery.offer?.savedAt ?? null,
  };

  const documentActionsInput: DocumentActionBindingsInput = {
    mode: "edit",
    hasStatus,
    /* The draft/published split. Without this the actions take their
       `draftsEnabled: false` branch, whose Save names the status — and a write
       that names one is never held, so the engine's pending-change support
       stayed dark for every Single. The label is the visible tell: "Save
       changes" rather than "Save". */
    draftsEnabled: schema.draftsEnabled === true,
    // The whole busy state: the disabled reasons and the discard question
    // reflect a discard in flight as well as a save.
    isSubmitting: busy,
    // Includes work a field holds, so Save is offered for it — and Mod+S,
    // which runs Save — while the page builder holds the change.
    isDirty: hasUnsavedWork,
    entry: entryLike,
    collectionSlug: schema.slug,
    /* The active language, whose row's status the save actions act on — a
       localized single's default row and its translations can be in
       different publish states. */
    locale,
    // A colleague's claim, which withholds every write: a reader's read-only
    // page withholds only the edits, through `canEdit`.
    documentLocked: lock.actionsDisabled,
    canEdit: mayEdit,
    writesRefused: removedFromCode,
    contributedActions: documentActions,
    // The Single as the form holds it when a contribution is chosen, as the
    // entry editor hands it.
    currentValues: () => form.getValues(),
    ...storingHandlers(handleSubmit),
    onDiscardWorkingDraft: discardWorkingDraft,
    onCancel: handleCancel,
    ...(onViewApi === undefined ? {} : { onViewApi }),
  };

  return (
    // A single is only ever edited standalone, so unlike the entry editor there
    // is no embedded case to exclude.
    <UnsavedChangesGuard
      isDirty={hasUnsavedWork}
      // A save alone: during a recovery, work that reaches the form after its
      // one read is still unsaved, so leaving still asks.
      disabled={isSubmitting}
      fields={schema.fields}
      // Same rule as the entry editor: a refused switch takes its seed with it.
      onCancel={onSeedHandled}
    >
      <UnsavedWorkProvider report={unsavedWork.report}>
        {/* The Single's place in the admin's top bar: Content, Singles, then
            this Single. */}
        <DocumentTrail
          kind="single"
          label={schema.label}
          control={form.control}
          titleName={titleFieldName}
        />
        {/*
        Which document the fields are inside. The entry editor has always
        supplied this and the Single editor did not, so a field rendered here
        could not tell what it was editing — which is fine for an input bound to
        a name, and not fine for one that has to address the document itself.

        `isCreateMode` is false by construction: a Single is materialised before
        its form renders, so there is no create mode to be in.
      */}
        <EntryFormContextProvider
          kind="single"
          collectionSlug={schema.slug}
          entryId={document.id}
          isCreateMode={false}
          // The same status, and pending-draft fact, the document bar's pill
          // shows: a field covering the bar reports what the bar would have.
          documentStatus={editedStatus}
          // The fields, so a field inside a repeater's row has an address.
          fields={schema.fields}
          // So a field recording its own state stays quiet where this does.
          keepsRecoveryPoints={keepsRecoveryPoints}
        >
          <EntryLocaleProvider value={localeCtx}>
            {/* Above the header — which mounts the history panel — and above
                the body, so a version the panel publishes is one both of them
                see. The entry editor provides the same context at the same
                depth. */}
            <DocumentHistoryContext.Provider value={documentHistory}>
              {/* Renders its child alone when it is closed — see the module. */}
              <PreviewPanes
                /*
                 * Withheld while translation mode is on, and while the preview
                 * cannot be offered at all. That mode already splits the editor,
                 * and a third pane inside it would produce two nested resizable
                 * groups and two chrome requests disagreeing about how much of
                 * the admin is left — the same reason the entry editor withholds
                 * it there.
                 */
                // Nor beside a document view, which takes the window alone.
                open={previewOnScreen}
                // A document view is a full-height screen: the closed split
                // hands it the content area's height to fill.
                fill={documentView !== undefined}
                onClose={previewPane.onClose}
                scope={previewPane.scope}
                label={previewPane.label}
                revision={previewPane.revision}
              >
                {/* Renders its child alone when there is no source — see the module. */}
                <TranslationPanes
                  source={translationMode.source}
                  onExit={translationMode.onExit}
                  control={form.control}
                >
                  {/* A document view replaces the form body and nothing around
                      it, as in the entry editor. */}
                  {/* The Single's live values for every component a plugin
                      draws here, the form body and a document view alike. */}
                  <DocumentFormSource form={form} contentHeld={contentHeld}>
                    <DocumentActionsHost
                      input={documentActionsInput}
                      recovery={recoveryPoint}
                    >
                      <SaveWithoutPublishingBridge
                        into={saveWithoutPublishing}
                      />
                      {/* Mod+S runs the Save action, so a Single saves by the
                      same rule the entry editor does. The view owns Escape;
                      the save chords stay. */}
                      <DocumentSaveShortcuts
                        onCancel={documentView ? undefined : handleCancel}
                        hasUnsavedWork={hasUnsavedWork}
                        isSubmitting={busy}
                      />
                      {documentView ? (
                        <DocumentViewBody
                          view={documentView}
                          target={{ singleSlug: schema.slug }}
                          form={form}
                          lock={lock}
                          recovery={recovery}
                          viewingVersion={viewingVersion}
                          recovering={recovering}
                          fields={schema.fields}
                          // A document view has no header, so the banner goes
                          // in among its own: an author working in the view
                          // still sees the document is in a scheduled release.
                          banner={documentBanner}
                        />
                      ) : (
                        <div className={cn("space-y-0", className)}>
                          {/* Its native submit — Enter in a field, or a
                            submit-typed Save — runs the Save action, so it
                            stores what Mod+S does and waits for what Save
                            waits for. */}
                          <SaveActionFormProvider
                            form={form}
                            recovering={recovering}
                          >
                            <CopyFromLanguageScope>
                              {/* The bar, the banners under it and the row of
                              field column and panel, in the frame the entry
                              editor draws: one bar and one banner order on
                              both. */}
                              <DocumentEditorLayout
                                place={documentPlace}
                                frameRef={panel.measure}
                                panelMode={panel.mode}
                                bar={
                                  <DocumentBar
                                    panelMode={panel.mode}
                                    autosaveEnabled={recoveryPoint.enabled}
                                    pendingRecoveryAt={
                                      recoveryPoint.pendingOfferAt
                                    }
                                    autosaveLastSavedAt={recoveryPoint.storedAt}
                                    mode="edit"
                                    hasStatus={hasStatus}
                                    // The status the pill reports, and whether a
                                    // published Single has a working draft pending,
                                    // as the context below carries them.
                                    documentStatus={editedStatus}
                                    historyFields={schema.fields}
                                    historyEnabled={historyEnabledFrom(schema)}
                                    historyRetention={historyRetentionFrom(
                                      schema
                                    )}
                                    historyLifecycle={hasStatus}
                                    // The whole busy state: the bar's spinner,
                                    // disabled reasons and discard dialog all
                                    // reflect a discard in flight as well as a save.
                                    isSubmitting={busy}
                                    hasUnsavedWork={hasUnsavedWork}
                                    entry={entryLike}
                                    collectionSlug={schema.slug}
                                    localized={schema.localized === true}
                                    /* A Single has a draft lifecycle, so it has drafts worth
                   sharing. The control is offered whenever the Single carries
                   that lifecycle; whether a link can actually be minted is the
                   server's call, and it refuses with a message naming what is
                   missing rather than handing out one that 404s. */
                                    // Sharing a preview needs the permission to change
                                    // the Single on the server, so a reader is not offered it.
                                    isLinkAvailable={
                                      previewLink.isAvailable && !previewHeld
                                    }
                                    // Withheld from a reader, so the share
                                    // popover cannot stay mounted for them.
                                    {...(previewLink.shareDocument ===
                                      undefined || previewHeld
                                      ? {}
                                      : {
                                          shareDocument:
                                            previewLink.shareDocument,
                                        })}
                                    /* The pane is offered on exactly the terms the
                           shareable link is: a Single with a draft lifecycle
                           and a resolvable language. Withheld in translation
                           mode, where the pane itself is withheld — a button
                           that toggles a flag nothing reads is worse than no
                           button. */
                                    // A reader is offered no preview, as the
                                    // share link beside it: opening one mints a
                                    // credential the server grants only to a
                                    // user who may change the Single.
                                    {...(previewHeld ? {} : previewPane.toggle)}
                                    toolbarSlot={versionAwareToolbarSlots(
                                      viewedVersionHost,
                                      // A reader's page holds the slot's writes too.
                                      versionWritesHeld,
                                      "single",
                                      controllerNames[0]
                                    )}
                                    // Singles address their history at
                                    // /api/singles/{slug} rather than by an
                                    // entry id.
                                    scope="single"
                                    documentLocked={lock.readOnly}
                                    writesRefused={removedFromCode}
                                    isRailCollapsed={panel.collapsed}
                                    onToggleRail={panel.toggle}
                                  />
                                }
                                banners={
                                  <DocumentBanners
                                    documentBanner={documentBanner}
                                    lock={lock}
                                    recovery={recovery}
                                    viewingVersion={viewingVersion}
                                    versionBannerRef={setVersionBannerSlot}
                                  />
                                }
                                notices={
                                  <FormErrorSummary
                                    errors={errors}
                                    submitCount={submitCount}
                                    className="mx-6 mt-3"
                                  />
                                }
                              >
                                {/* Main column */}
                                {/* The measure lives on the FIELD column, as
                                    the entry editor's does: the panel is a
                                    fixed-width sibling, and the page, an
                                    Editor page, has no cap of its own. */}
                                <div
                                  className="flex-1 min-w-0 flex flex-col mx-auto w-full"
                                  style={{ maxWidth: CONTENT_MEASURE_LENGTH }}
                                >
                                  <DocumentPlaceTabs
                                    place={documentPlace}
                                    // A plugin's tab writes through the same
                                    // form, so the bar's Save stores it, and
                                    // is told what holds the Single as the
                                    // entry editor tells its tabs.
                                    form={form}
                                    documentLock={pluginDocumentLock({
                                      contentHeld,
                                      writesHeld,
                                      recovering,
                                      removedFromCode,
                                    })}
                                    fieldNames={fieldNames}
                                    viewingPastVersion={viewingVersion !== null}
                                  >
                                    {/* The title, fixed by the Single's config and
                                  so read-only. No slug line: a Single's slug
                                  is fixed by its config too, and is not part
                                  of its address on most sites. */}
                                    <DocumentTitleBlock
                                      mode="edit"
                                      titleField={titleField}
                                      lockIdentity
                                      documentLocked={lock.readOnly}
                                      // A save or a discard alone: the title's own
                                      // `disabled` follows it, and a recovery
                                      // holds the title read-only through the lock
                                      // instead.
                                      isSubmitting={writePending}
                                    />
                                    <EntryMetaStrip
                                      panelCarriesId={panel.docked}
                                      documentId={document.id}
                                    />
                                    {/* A plugin's section that asks to be met
                                    first, above the fields on a phone rather
                                    than in the sheet. */}
                                    <PanelSectionsAboveForm
                                      sections={sectionsAboveForm}
                                      className={DOCUMENT_COLUMN_INSET}
                                      {...(placedSectionProps === undefined
                                        ? {}
                                        : { placedSectionProps })}
                                    />

                                    {/* The language panel, inline: the exact complement
                              of the rail, shown where the rail is not. */}
                                    <SingleFormLanguagePanel
                                      actionsDisabled={contentHeld}
                                      publishAllDisabled={publishAllDisabled}
                                      // A reader may still open the other languages.
                                      navigationDisabled={navigationHeld}
                                      enabled={localizationEnabled}
                                      hasStatus={hasStatus}
                                      panelDocked={panel.docked}
                                      sharedChangesPending={
                                        sharedChangesPending
                                      }
                                      {...(singleTranslations === undefined
                                        ? {}
                                        : { translations: singleTranslations })}
                                      {...(locale === undefined
                                        ? {}
                                        : { locale })}
                                      {...(switchLocale === undefined
                                        ? {}
                                        : { onLocaleChange: switchLocale })}
                                    />

                                    {/* Reading a past version replaces the document rather
                              than opening beside it — see the fields panel. */}
                                    <SingleFormFieldsPanel
                                      document={document}
                                      singleSlug={schema.slug}
                                      historicalFields={historicalFields}
                                      historicalValues={historicalValues}
                                      isSubmitting={isSubmitting}
                                      mainFields={contentFields}
                                      readOnly={lock.readOnly}
                                      // A submit in flight withholds restore too: a
                                      // restore racing the ordinary save would let
                                      // completion order decide which contents
                                      // survive.
                                      // A reader's page holds restoring as well.
                                      versionActionsHeld={
                                        versionWritesHeld || busy
                                      }
                                      versionBannerSlot={versionBannerSlot}
                                    />
                                  </DocumentPlaceTabs>
                                </div>

                                {/* The document panel, framed for the editor's
                                width, as the entry editor's is. */}
                                <SingleFormRail
                                  actionsDisabled={contentHeld}
                                  publishAllDisabled={publishAllDisabled}
                                  navigationDisabled={navigationHeld}
                                  entry={entryLike}
                                  hasStatus={hasStatus}
                                  documentStatus={editedStatus}
                                  singleSlug={schema.slug}
                                  panel={panel}
                                  panelOrder={panelOrder}
                                  placedSectionProps={placedSectionProps}
                                  {...(locale === undefined ? {} : { locale })}
                                  {...(switchLocale === undefined
                                    ? {}
                                    : { onLocaleChange: switchLocale })}
                                />
                              </DocumentEditorLayout>
                            </CopyFromLanguageScope>
                          </SaveActionFormProvider>
                        </div>
                      )}
                    </DocumentActionsHost>
                  </DocumentFormSource>
                </TranslationPanes>
              </PreviewPanes>
            </DocumentHistoryContext.Provider>
          </EntryLocaleProvider>
        </EntryFormContextProvider>
        {/* A save refused because the Single changed since: who changed it
            and when, and the author's choices, over the edits it keeps. */}
        <VersionConflictDialog
          conflict={version.conflict}
          keepsRecoveryPoints={keepsRecoveryPoints}
          compareHref={
            version.conflict?.stale.historyVersion && autosaveScope
              ? versionsHref(
                  autosaveScope,
                  {
                    from: PREVIOUS_VERSION,
                    to: version.conflict.stale.historyVersion.version,
                  },
                  version.conflict.stale.historyVersion.locale
                )
              : null
          }
          onLoadCurrent={() => lock.now.keepEditsAndLoad()}
          onSaveAnyway={saveAnyway}
        />
      </UnsavedWorkProvider>
    </UnsavedChangesGuard>
  );
}
