"use client";

/**
 * Form Builder View
 *
 * The form editor: an Editor page in the admin's frame, with the form's
 * controls in the admin's one top bar, the form's name and its pages as the
 * page header's tabs, and one set of unsaved changes across every page, saved
 * once.
 *
 * @module admin/FormBuilderView
 * @since 0.1.0
 */

import type {
  DocumentLockGates,
  FieldPickerChoice,
} from "@nextlyhq/plugin-sdk/admin";
import {
  useFoldedPanel,
  useReportUnsavedWork,
} from "@nextlyhq/plugin-sdk/admin";
import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  toast,
} from "@nextlyhq/ui";
import { useQueryClient } from "@tanstack/react-query";
import {
  type JSX,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { FORM_PAGES, formPageOf, type FormPageId } from "../form-pages";
import type { AnyFormField, FormField, FormFieldTypeId } from "../types";

import { FieldCards } from "./components/builder/FieldCards";
import { FormIdentitySection } from "./components/builder/FormIdentitySection";
import { FormNotificationsTab } from "./components/builder/FormNotificationsTab";
import { FormPreview } from "./components/builder/FormPreview";
import { FormSettingsTab } from "./components/builder/FormSettingsTab";
import { notificationsBlockingSave } from "./components/builder/notification-addresses";
import {
  followWithinAdmin,
  formPageAddress,
} from "./components/editor/form-editor-address";
import { FormEditorBar } from "./components/editor/FormEditorBar";
import {
  formEditorPages,
  FormEditorHeader,
  type FormEditorTab,
} from "./components/editor/FormEditorHeader";
import { useSubmissionCount } from "./components/editor/useSubmissionCount";
import { SubmissionsView } from "./components/submissions/SubmissionsView";
import {
  FormBuilderProvider,
  createFieldFromType,
  createNotification,
  generateFieldName,
  useFieldBookkeeping,
  type FormNotification,
} from "./context/FormBuilderContext";
import { refusedPage, type SaveRefusal } from "./save-refusal";
import { useBuilderConfig } from "./use-builder-config";

/**
 * The key a form's version travels under, as the admin reads and sends it.
 * Spelled here because the plugin reaches the admin only through the SDK,
 * which does not publish it.
 */
const DOCUMENT_VERSION_KEY = "_rev";

/**
 * The name the editor reports its unsaved work under, to the admin page that
 * guards leaving it.
 */
const UNSAVED_WORK_KEY = "forms.editor";

/**
 * What a save sends: an existing form's save names the version the editor's
 * copy started from, where it has one, so a save from an older copy is refused.
 */
function saveBody(
  saveData: Record<string, unknown>,
  isCreating: boolean,
  startedFrom: string | undefined
): Record<string, unknown> {
  return isCreating || startedFrom === undefined
    ? saveData
    : { ...saveData, [DOCUMENT_VERSION_KEY]: startedFrom };
}

/** The version a save answered, or the copy's own where it names none. */
function versionAfterSave(
  saved: Record<string, unknown>,
  previous: string | undefined
): string | undefined {
  const answered = saved[DOCUMENT_VERSION_KEY];
  return typeof answered === "string" ? answered : previous;
}

// ============================================================================
// Types
// ============================================================================

export interface FormBuilderViewProps {
  id?: string;
  entryId?: string;
  collection?: string;
  collectionSlug?: string;
  isCreating?: boolean;
  initialData?: {
    id?: string;
    name?: string;
    slug?: string;
    description?: string;
    status?: "draft" | "published" | "closed";
    closedMessage?: string;
    fields?: unknown[];
    settings?: Record<string, unknown>;
    notifications?: unknown[];
    /**
     * The form's version as read, which a save sends back so one made from an
     * older version is refused rather than replacing what someone saved since.
     */
    _rev?: string;
  };
  /**
   * Saves the form in the host's own way, in place of the builder's request.
   * The builder counts the form saved once this returns, or once the promise
   * it may return settles without failing.
   */
  onSave?: (data: unknown) => void | Promise<void>;
  onSuccess?: (entry?: Record<string, unknown>) => void;
  /** Called once the form has been deleted from the editor's More menu. */
  onDelete?: () => void;
  onCancel?: () => void;
  /**
   * What a colleague's claim on this form withholds, handed over by the admin
   * page that renders this view.
   *
   * The strip above this builder says in words that unsaved changes cannot be
   * saved while someone else holds the document. Committing anyway would make
   * that sentence false and would overwrite the holder's row, so the save reads
   * it too.
   */
  documentLock?: DocumentLockGates;
  /**
   * The page of the editor the address names (`"settings"` at
   * `/admin/collections/forms/<id>/settings`); absent on the form's edit
   * address, which opens Builder.
   */
  view?: string;
}

/** The props the editor's inner tree reads. */
interface FormEditorProps {
  isCreating: boolean;
  collectionSlug: string;
  entryId: string | undefined;
  onSave: FormBuilderViewProps["onSave"];
  onSuccess: FormBuilderViewProps["onSuccess"];
  onDelete: FormBuilderViewProps["onDelete"];
  documentLock: DocumentLockGates | undefined;
  /** The form's version as read; see `initialData._rev`. */
  version: string | undefined;
  view: string | undefined;
}

// ============================================================================
// Inner Component (uses context)
// ============================================================================

/** A page's label, as its tab names it. */
function pageLabel(page: FormPageId): string {
  return (
    FORM_PAGES.find(each => (each.path ?? "builder") === page)?.label ??
    "Builder"
  );
}

/**
 * The page a saved form's address names, or the one a new form's tabs chose:
 * a form with no address yet keeps its page in the editor.
 */
function useFormPage(
  isCreating: boolean,
  view: string | undefined
): [FormPageId, (page: FormPageId) => void] {
  const [chosen, setChosen] = useState<FormPageId>("builder");
  return [isCreating ? chosen : formPageOf(view), setChosen];
}

/** The page's own width: a Form page is a column, the rest take the width. */
function PageBody({
  page,
  children,
}: {
  page: FormPageId;
  children: ReactNode;
}): JSX.Element {
  const column = page === "settings" || page === "notifications";
  return (
    <div
      data-form-page={page}
      className="min-w-0"
      style={column ? { maxWidth: "var(--nx-measure-form)" } : undefined}
    >
      {children}
    </div>
  );
}

function FormEditor({
  isCreating,
  collectionSlug,
  entryId,
  onSave,
  onSuccess,
  onDelete,
  documentLock,
  version,
  view,
}: FormEditorProps): JSX.Element {
  // The version the next save sends: the one read, then the one each save
  // answered, so a second save is not refused for this editor's first.
  const startedFrom = useRef(version);
  const {
    fields,
    isDirty,
    formData,
    settings,
    notifications,
    addField,
    selectField,
    seedNotifications,
    updateFormData,
    markAsSaved,
    beginSave,
    markFieldsSaved,
    changeCount,
    undo,
    readOnly,
  } = useFieldBookkeeping();

  const queryClient = useQueryClient();
  const config = useBuilderConfig();
  const [page, choosePage] = useFormPage(isCreating, view);
  const [isSaving, setIsSaving] = useState(false);
  const [refusal, setRefusal] = useState<SaveRefusal | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // The form editor needs the width: the Forms panel starts folded on it, and
  // the bar's toggle brings it back. The admin remembers the reader's choice.
  useFoldedPanel("forms.builder");
  // Leaving the form with unsaved changes asks first; moving between its tabs
  // stays on the form and does not.
  useReportUnsavedWork(UNSAVED_WORK_KEY, isDirty);

  const submissionCount = useSubmissionCount(
    isCreating ? undefined : entryId,
    config.submissionsSlug
  );

  // Seed a new form with the default admin-notification rule once the host
  // defaults are known. Guarded by a ref so deleting the seeded rule is
  // final — the effect must never re-seed a list the user emptied.
  const seededRef = useRef(false);
  const defaults = config.notificationDefaults;
  useEffect(() => {
    if (!isCreating || defaults === null || seededRef.current) return;
    seededRef.current = true;
    seedNotifications([
      {
        ...createNotification(),
        name: "Admin notification",
        to: defaults.defaultToEmail ?? "",
      },
    ]);
  }, [isCreating, defaults, seedNotifications]);

  // A field from the picker, added and opened (`fieldFromChoice`).
  const handleAddField = useCallback(
    (type: FormFieldTypeId, choice?: FieldPickerChoice) => {
      const newField = fieldFromChoice(
        type,
        choice,
        fields.map(f => f.name)
      );
      addField(newField);
      selectField(newField.name);
    },
    [fields, addField, selectField]
  );

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    // A refused save keeps every change and says what to fix, and where, in
    // the page and as a toast.
    const refuse = (next: SaveRefusal) => {
      setRefusal(next);
      toast.error(next.message);
    };

    // The commit is where the refusal lives, following the rule the entry
    // editor sets: a write passes one gate rather than each control being
    // disabled separately. The Save button reads the same fact, so the
    // interface does not offer what this would refuse.
    if (documentLock?.actionsDisabled === true) return;

    const blocked = blockedBeforeSave(fields, notifications);
    if (blocked) {
      refuse(blocked);
      return;
    }

    const { id: _id, ...formDataWithoutId } = formData;
    const saveData = {
      ...formDataWithoutId,
      fields,
      settings,
      notifications,
    };

    beginSave();
    setIsSaving(true);
    setRefusal(null);
    if (onSave) {
      // The host's save. A field it stored is stored like one the builder
      // saved itself, so its type is fixed; the form's unsaved state is the
      // host's to clear, as before.
      await saveThroughHost(onSave, saveData, {
        saved: markFieldsSaved,
        failed: message => refuse({ message }),
      });
      setIsSaving(false);
      return;
    }

    try {
      const url = isCreating
        ? `/admin/api/collections/${collectionSlug}/entries`
        : `/admin/api/collections/${collectionSlug}/entries/${entryId}`;
      const response = await fetch(url, {
        method: isCreating ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(
          saveBody(saveData, isCreating, startedFrom.current)
        ),
      });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => ({}));
        const where = refusedPage(body);
        refuse({
          message: saveErrorMessage(body, response.statusText),
          ...(where === undefined ? {} : { page: where }),
        });
        return;
      }

      const result = (await response.json()) as {
        message?: string;
        item?: Record<string, unknown>;
      } & Record<string, unknown>;
      const savedEntry: Record<string, unknown> = result.item ?? result;
      startedFrom.current = versionAfterSave(savedEntry, startedFrom.current);
      void queryClient.invalidateQueries({
        queryKey: ["entries", "list", collectionSlug],
      });
      void queryClient.invalidateQueries({ queryKey: ["entries", "count"] });
      if (!isCreating && entryId) {
        void queryClient.invalidateQueries({
          queryKey: ["entries", "detail", collectionSlug, entryId],
        });
      }
      markAsSaved();
      // What the stored form now holds, whatever was edited meanwhile.
      markFieldsSaved(namesOf(saveData.fields));
      toast.success(isCreating ? "Form created" : "Form saved");
      if (onSuccess) onSuccess(savedEntry);
    } catch (error) {
      refuse({ message: saveFailureMessage(error) });
    } finally {
      setIsSaving(false);
    }
  }, [
    formData,
    fields,
    settings,
    notifications,
    onSave,
    onSuccess,
    isCreating,
    collectionSlug,
    entryId,
    queryClient,
    markAsSaved,
    beginSave,
    markFieldsSaved,
    // Read inside, so it belongs here. Without it the callback closes over the
    // claim as it stood when the form mounted, and a colleague taking the
    // document over mid-session would leave this still committing.
    documentLock?.actionsDisabled,
  ]);

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDelete = useCallback(async () => {
    // The commit is where the refusal lives, as for Save: a colleague who
    // took the form while the question was open holds it now, and the claim
    // is advisory on the server, so nothing else would stop the delete.
    if (entryId === undefined || documentLock?.actionsDisabled === true) {
      return;
    }
    const response = await fetch(
      `/admin/api/collections/${collectionSlug}/entries/${entryId}`,
      { method: "DELETE", credentials: "include" }
    ).catch(() => undefined);
    if (response === undefined || !response.ok) {
      const body: unknown = await response?.json().catch(() => ({}));
      toast.error(
        saveErrorMessage(body, response?.statusText ?? "").replace(
          /^Failed to save form/,
          "Couldn't delete the form"
        )
      );
      return;
    }
    // Nothing is left to save, so leaving is not asked about.
    markAsSaved();
    void queryClient.invalidateQueries({
      queryKey: ["entries", "list", collectionSlug],
    });
    toast.success("Form deleted");
    onDelete?.();
  }, [
    entryId,
    collectionSlug,
    markAsSaved,
    queryClient,
    onDelete,
    // Read inside, so a claim taken while the dialog is open is the one read.
    documentLock?.actionsDisabled,
  ]);

  // ── Tabs ──────────────────────────────────────────────────────────────────
  const saved = !isCreating && entryId !== undefined;
  const tabs = formEditorPages(saved).map(
    (each): FormEditorTab =>
      editorTab(each, {
        saved: saved ? { collectionSlug, entryId } : undefined,
        choose: choosePage,
        counts: {
          builder: fields.length,
          notifications: notifications.length,
          submissions: submissionCount,
        },
      })
  );
  const pageHref = (target: FormPageId): string =>
    saved ? formPageAddress(collectionSlug, entryId, target) : `#${target}`;

  const holdsWrites = documentLock?.actionsDisabled === true;

  return (
    <>
      <FormEditorBar
        status={formData.status}
        onStatusChange={status => updateFormData({ status })}
        changeCount={changeCount}
        saving={isSaving}
        onUndo={undo}
        {...(saved && submissionCount !== undefined
          ? {
              submissions: {
                count: submissionCount,
                href: pageHref("submissions"),
              },
            }
          : {})}
        formId={formData.slug}
        onCopyFormId={() => {
          void copyText(formData.slug).then(copied =>
            copied
              ? toast.success("Form ID copied")
              : toast.error("Couldn't copy the form ID")
          );
        }}
        {...(saved && onDelete !== undefined
          ? { onDelete: () => setConfirmingDelete(true) }
          : {})}
        onSave={() => {
          void handleSave();
        }}
        saveDisabled={
          isSaving || holdsWrites || readOnly || (!isCreating && !isDirty)
        }
        readOnly={readOnly}
      />

      <FormEditorHeader
        name={formData.name}
        fieldCount={fields.length}
        formId={formData.slug}
        tabs={tabs}
        current={page}
      />

      {refusal === null ? null : (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription>
            <span>{refusal.message}</span>
            {refusal.page === undefined || refusal.page === page ? null : (
              <>
                {" "}
                <a
                  href={pageHref(refusal.page)}
                  className="font-medium underline underline-offset-2"
                  onClick={event =>
                    followTab(event, pageHref(refusal.page ?? "builder"), {
                      saved,
                      choose: () => choosePage(refusal.page ?? "builder"),
                    })
                  }
                >
                  Go to {pageLabel(refusal.page)}
                </a>
              </>
            )}
          </AlertDescription>
        </Alert>
      )}

      <PageBody page={page}>
        {pageContent(page, {
          builder: () => (
            <FieldCards
              enabledTypes={config.enabledTypes}
              disabledFieldTypes={config.disabledFieldTypes}
              onAddField={handleAddField}
            />
          ),
          preview: () => <FormPreview fields={fields} formData={formData} />,
          settings: () => (
            <div className="flex flex-col gap-10">
              <FormIdentitySection />
              <FormSettingsTab
                spamDefaults={config.spamDefaults}
                redirectCollections={config.redirectCollections}
                redirectConfigFailed={config.failed}
              />
            </div>
          ),
          notifications: () => (
            <FormNotificationsTab defaults={config.notificationDefaults} />
          ),
          submissions: () =>
            entryId === undefined ? null : (
              <SubmissionsView
                formId={entryId}
                {...(config.submissionsSlug === undefined
                  ? {}
                  : { collectionSlug: config.submissionsSlug })}
              />
            ),
        })}
      </PageBody>

      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this form?</AlertDialogTitle>
            <AlertDialogDescription>
              {formData.name.trim() === ""
                ? "The form is deleted for good, and the site can no longer show it."
                : `"${formData.name}" is deleted for good, and the site can no longer show it.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep the form</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={holdsWrites || readOnly}
              onClick={() => {
                void handleDelete();
              }}
            >
              Delete form
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** The content of each page, drawn only for the page on screen. */
function pageContent(
  page: FormPageId,
  pages: Record<FormPageId, () => ReactNode>
): ReactNode {
  return pages[page]();
}

/**
 * Follow a tab: a saved form moves to the page's address through the admin;
 * a new form, which has no address yet, switches the page in place.
 */
function followTab(
  event: MouseEvent<HTMLAnchorElement>,
  href: string,
  target: { saved: boolean; choose: () => void }
): void {
  if (target.saved) {
    followWithinAdmin(event, href);
    return;
  }
  event.preventDefault();
  target.choose();
}

/** One tab of the header: its label, address, count, and how it is followed. */
function editorTab(
  page: FormPageId,
  context: {
    saved: { collectionSlug: string; entryId: string } | undefined;
    choose: (page: FormPageId) => void;
    counts: Partial<Record<FormPageId, number | undefined>>;
  }
): FormEditorTab {
  const href =
    context.saved === undefined
      ? `#${page}`
      : formPageAddress(
          context.saved.collectionSlug,
          context.saved.entryId,
          page
        );
  const count = context.counts[page];
  return {
    page,
    label: pageLabel(page),
    href,
    ...(count === undefined || count === 0 ? {} : { count }),
    onClick: event =>
      followTab(event, href, {
        saved: context.saved !== undefined,
        choose: () => context.choose(page),
      }),
  };
}

/**
 * What stops a save before it is sent, and where it is fixed: a form needs a
 * field, and a notification needs a name and good addresses. A notification is
 * written to the form as it is typed, so nothing between the editor and here
 * refuses one; both preconditions are answered by the module the editor asks.
 */
function blockedBeforeSave(
  fields: readonly AnyFormField[],
  notifications: readonly FormNotification[]
): SaveRefusal | undefined {
  if (fields.length === 0) {
    return { message: "Add at least one field to the form.", page: "builder" };
  }
  const blocked = notificationsBlockingSave(notifications);
  return blocked ? { message: blocked, page: "notifications" } : undefined;
}

/** Copy text to the clipboard, answering whether it was copied. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Main Component (provides context)
// ============================================================================

/**
 * What to tell an author when a save is refused.
 *
 * A validation refusal carries the generic `"Validation failed."` at the top
 * level and puts the actionable part in `data.errors`. Reporting only the top
 * level tells an author their form was rejected and nothing about what to
 * change — every rule in the collection produces that same sentence.
 */
export function saveErrorMessage(body: unknown, statusText: string): string {
  const error = (
    body as {
      error?: {
        code?: string;
        message?: string;
        data?: {
          errors?: { message?: string }[];
          changedBy?: { name?: unknown };
        };
      };
    }
  )?.error;

  // Refused because someone saved the form since: who, where the refusal
  // names them, and what to do. The edits stay in the editor.
  if (error?.code === "STALE_VERSION") {
    const name = error.data?.changedBy?.name;
    const who =
      typeof name === "string" && name.trim() !== "" ? name.trim() : "Someone";
    return `${who} changed this form since you opened it. Reload to see their change; your edits are still here, not saved.`;
  }

  const fieldIssues = (error?.data?.errors ?? [])
    .map(issue => issue.message)
    .filter((message): message is string => Boolean(message));

  return (
    fieldIssues.join(" ") ||
    error?.message ||
    `Failed to save form: ${statusText}`
  );
}

/**
 * A new field from the picker: the type's defaults, the label the person
 * typed, and the name it gives, made unique among `names` (a second "Email"
 * becomes `email_2`). Without a choice, or a label that gives no name, the
 * type's own label and name.
 */
function fieldFromChoice(
  type: FormFieldTypeId,
  choice: FieldPickerChoice | undefined,
  names: readonly string[]
): AnyFormField {
  const fromType = createFieldFromType(type, names);
  const label = choice?.label.trim();
  return {
    ...fromType,
    label: label || fromType.label,
    name: choice?.name ? generateFieldName(choice.name, names) : fromType.name,
  };
}

/** What a failed save tells the person. */
function saveFailureMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Failed to save form";
}

/** The names fields are stored under. */
function namesOf(fields: readonly AnyFormField[]): string[] {
  return fields.map(field => field.name);
}

/**
 * Saves through the host's own callback, waiting for the promise it may
 * return, then reports which way it went: on success, the names of the fields
 * it was handed, which the stored form now holds whatever was edited meanwhile.
 */
async function saveThroughHost(
  onSave: (data: unknown) => void | Promise<void>,
  data: { fields: readonly AnyFormField[] },
  report: {
    saved: (names: readonly string[]) => void;
    failed: (message: string) => void;
  }
): Promise<void> {
  try {
    await onSave(data);
  } catch (error) {
    report.failed(saveFailureMessage(error));
    return;
  }
  report.saved(namesOf(data.fields));
}

export function FormBuilderView({
  id,
  entryId,
  collection,
  collectionSlug,
  isCreating,
  initialData,
  onSave,
  onSuccess,
  onDelete,
  documentLock,
  view,
}: FormBuilderViewProps): JSX.Element {
  const resolvedEntryId = entryId || id || initialData?.id;
  const resolvedCollectionSlug = collectionSlug || collection || "forms";
  const resolvedIsCreating = isCreating ?? !resolvedEntryId;
  const providerKey = resolvedEntryId || "new";

  return (
    <FormBuilderProvider
      key={providerKey}
      readOnly={documentLock?.readOnly === true}
      initialData={{
        id: resolvedEntryId,
        name: initialData?.name,
        slug: initialData?.slug,
        description: initialData?.description,
        status: initialData?.status,
        closedMessage: initialData?.closedMessage,
        fields: initialData?.fields as FormField[],
        settings: initialData?.settings as Record<string, unknown>,
        notifications: initialData?.notifications as FormNotification[],
      }}
    >
      <FormEditor
        isCreating={resolvedIsCreating}
        collectionSlug={resolvedCollectionSlug}
        entryId={resolvedEntryId}
        onSave={onSave}
        onSuccess={onSuccess}
        onDelete={onDelete}
        documentLock={documentLock}
        version={initialData?._rev}
        view={view}
      />
    </FormBuilderProvider>
  );
}

export default FormBuilderView;
