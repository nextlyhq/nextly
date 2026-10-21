"use client";

import { type EditorView } from "@codemirror/view";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@nextlyhq/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm, type Resolver, type SubmitHandler } from "react-hook-form";

import { isDeletable } from "@admin/components/features/email-hub/messages/messages-model";
import { TemplateDeleteDialog } from "@admin/components/features/email-hub/TemplateDialogs";
import { toast } from "@admin/components/ui";
import { Form } from "@admin/components/ui/form";
import {
  EMAIL_TEMPLATE_CREATE_PERMISSIONS,
  EMAIL_TEMPLATE_DELETE_PERMISSIONS,
  holdsAny,
} from "@admin/constants/email-hub";
import { ROUTES, withQuery } from "@admin/constants/routes";
import { useEmailProviders } from "@admin/hooks/queries/useEmailProviders";
import {
  useDeleteEmailTemplate,
  useEmailTemplates,
  useOverrideEmailTemplate,
  useResetEmailTemplate,
  useUndoOwnerUpdate,
} from "@admin/hooks/queries/useEmailTemplates";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import { generateSlug } from "@admin/lib/fields";
import { navigateTo } from "@admin/lib/navigation";
import {
  type EmailTemplateRecord,
  type EmailTemplateVersion,
  type OwnerUpdateUndo,
} from "@admin/services/emailTemplateApi";

import { BodyEditor } from "./BodyEditor";
import { DataRail } from "./DataRail";
import { DetailsPanel } from "./DetailsPanel";
import { EnvelopeBar } from "./EnvelopeBar";
import { InboxStrip } from "./InboxStrip";
import {
  OverrideDialog,
  ResetDialog,
  UnsavedBeforeReviewDialog,
} from "./OwnershipDialogs";
import { OwnershipNotices, type UndoNote } from "./OwnershipNotices";
import { OwnerUpdateReview } from "./OwnerUpdateReview";
import { regionsForRefusal } from "./refusal-routing";
import {
  DEFAULT_VALUES,
  EMAIL_TEMPLATE_FORM_ID,
  templateSchemaFor,
  templateToFormValues,
  type TemplateFormValues,
} from "./schema";
import { SendTestDialog } from "./SendTestDialog";
import { PreviewPane } from "./TemplatePreview";
import { useDerivedTemplateState } from "./useDerivedTemplateState";
import { useVariableInsertion } from "./useVariableInsertion";
import { VariableChips } from "./VariablesRail";
import { ownerName, ownsContent } from "./workbench-model";
import { SaveButton, WorkbenchHeader } from "./WorkbenchHeader";
import { WorkbenchLayout, type SheetPanel } from "./WorkbenchLayout";

// ============================================================
// EmailTemplateForm — the template workbench
// ============================================================

export interface EmailTemplateFormProps {
  mode: "create" | "edit";
  template?: EmailTemplateRecord;
  initialValues?: TemplateFormValues;
  isPending: boolean;
  onSubmit: SubmitHandler<TemplateFormValues>;
}

type WorkbenchDialog = "override" | "reset" | "review" | "unsaved" | "delete";

/** What an Undo puts back: the site's text before a Reset, or a review's. */
type Undoable =
  | { kind: "reset"; version: EmailTemplateVersion }
  | { kind: "review"; undo: OwnerUpdateUndo };

function versionOf(template: EmailTemplateRecord): EmailTemplateVersion {
  return {
    subject: template.subject,
    htmlContent: template.htmlContent,
    plainTextContent: template.plainTextContent,
    preheader: template.preheader,
  };
}

export function EmailTemplateForm({
  mode,
  template,
  initialValues,
  isPending,
  onSubmit,
}: EmailTemplateFormProps) {
  const isEdit = mode === "edit";
  const slugTouchedRef = useRef(false);
  const editorWrapRef = useRef<HTMLDivElement>(null);
  const htmlEditorViewRef = useRef<EditorView | null>(null);

  const [editorTab, setEditorTab] = useState<"html" | "text">("html");
  const [sheet, setSheet] = useState<SheetPanel | null>(null);
  const [sampleOverride, setSampleOverride] = useState<string | null>(null);
  const [sendTestOpen, setSendTestOpen] = useState(false);
  const [dialog, setDialog] = useState<WorkbenchDialog | null>(null);
  const [undoable, setUndoable] = useState<Undoable | null>(null);

  // The row being edited keeps its kind; layouts are wrappers, not bodies.
  const currentKind = template?.kind ?? "template";
  const isLayoutRow = currentKind === "layout";
  // Emails are listed under Messages, and layouts and partials under Design;
  // leaving the workbench returns to the tab that lists it.
  const listedUnderDesign = currentKind !== "template";
  const listHref = listedUnderDesign ? ROUTES.EMAIL_DESIGN : ROUTES.EMAIL;
  const owns = ownsContent(template);
  const owner = template ? ownerName(template) : "";

  const form = useForm<TemplateFormValues>({
    resolver: zodResolver(
      templateSchemaFor(isLayoutRow)
    ) as unknown as Resolver<TemplateFormValues>,
    defaultValues:
      initialValues ??
      (template ? templateToFormValues(template) : DEFAULT_VALUES),
  });

  const { data: providersData } = useEmailProviders(
    { page: 0, pageSize: 100, search: "" },
    { staleTime: 60_000 }
  );
  const providers = providersData?.data ?? [];

  const { data: allTemplates } = useEmailTemplates();
  const layouts = useMemo(
    () => (allTemplates ?? []).filter(t => t.kind === "layout"),
    [allTemplates]
  );
  // Only the list says whether an email is kept on the previous engine.
  const keptOnOldEngine = Boolean(
    template && allTemplates?.find(t => t.id === template.id)?.keptOnOldEngine
  );

  const { hasPermission } = useCurrentUserPermissions();
  const canDuplicate =
    isEdit &&
    currentKind === "template" &&
    holdsAny(hasPermission, EMAIL_TEMPLATE_CREATE_PERMISSIONS);
  const canDelete =
    isEdit &&
    template !== undefined &&
    isDeletable(template) &&
    holdsAny(hasPermission, EMAIL_TEMPLATE_DELETE_PERMISSIONS);

  const override = useOverrideEmailTemplate();
  const reset = useResetEmailTemplate();
  const undoUpdate = useUndoOwnerUpdate();
  const deleteTemplate = useDeleteEmailTemplate();

  const htmlContent = form.watch("htmlContent");
  const plainTextContent = form.watch("plainTextContent");
  const subject = form.watch("subject");
  const preheader = form.watch("preheader");
  const fromOverride = form.watch("fromOverride");
  const useLayout = form.watch("useLayout");
  const isActive = form.watch("isActive");
  const slug = form.watch("slug");
  const name = form.watch("name");
  const variables = form.watch("variables");
  const layoutId = form.watch("layoutId");
  const isDirty = form.formState.isDirty;

  useEffect(() => {
    if (initialValues) {
      form.reset(initialValues);
      slugTouchedRef.current = false;
    } else if (template && isEdit) {
      form.reset(templateToFormValues(template));
    }
  }, [initialValues, template, isEdit, form]);

  const handleNameChange = useCallback(
    (value: string, onChange: (v: string) => void) => {
      onChange(value);
      if (!isEdit && !slugTouchedRef.current) {
        form.setValue("slug", generateSlug(value), { shouldValidate: true });
      }
    },
    [isEdit, form]
  );

  // Insert a {{variable}} at the editor caret (falls back to append).
  const insertVariable = useVariableInsertion({
    form,
    editorTab,
    editorWrapRef,
    htmlEditorViewRef,
  });

  const {
    sampleText,
    sampleData,
    sampleError,
    unknownVariables,
    previewHtml,
    previewText,
    previewSubject,
    isPreviewPending,
    previewError,
  } = useDerivedTemplateState({
    variables,
    sampleOverride,
    subject,
    htmlContent,
    plainTextContent,
    preheader,
    useLayout,
    layoutId,
    kind: currentKind,
  });

  // ── Ownership acts ──────────────────────────────────────────

  const confirmOverride = () => {
    if (!template) return;
    override.mutate(
      { id: template.id },
      {
        onSuccess: () => {
          setDialog(null);
          toast.success("Overridden", {
            description: `${template.name} is now your site's version.`,
          });
        },
        onError: error =>
          toast.error("It couldn't be overridden", {
            description: error.message,
          }),
      }
    );
  };

  const confirmReset = () => {
    if (!template) return;
    const before = versionOf(template);
    reset.mutate(template.id, {
      onSuccess: () => {
        setDialog(null);
        setUndoable({ kind: "reset", version: before });
      },
      onError: error =>
        toast.error("It couldn't be reset", { description: error.message }),
    });
  };

  const startReview = () => {
    setDialog(isDirty ? "unsaved" : "review");
  };

  const runUndo = () => {
    if (!template || !undoable) return;
    const done = {
      onSuccess: () => {
        setUndoable(null);
        toast.success("Undone");
      },
      onError: (error: Error) =>
        toast.error("It couldn't be undone", { description: error.message }),
    };
    if (undoable.kind === "reset") {
      override.mutate({ id: template.id, version: undoable.version }, done);
    } else {
      undoUpdate.mutate({ id: template.id, undo: undoable.undo }, done);
    }
  };

  const undoNote: UndoNote | null = undoable
    ? {
        message:
          undoable.kind === "reset"
            ? `Reset to ${owner}'s version.`
            : `${owner}'s update applied.`,
        onUndo: runUndo,
        isPending: override.isPending || undoUpdate.isPending,
      }
    : null;

  const confirmDelete = () => {
    if (!template) return;
    deleteTemplate.mutate(template.id, {
      onSuccess: () => {
        toast.success("Email deleted", {
          description: `${template.name} has been deleted.`,
        });
        navigateTo(listHref);
      },
      onError: error =>
        toast.error("Delete failed", { description: error.message }),
    });
  };

  const deleteRefusal =
    template && !isDeletable(template)
      ? template.owner.kind === "site"
        ? "The default layout can't be deleted"
        : `Can't delete: ${owner}'s email`
      : undefined;

  const toggleSheet = (panel: SheetPanel) =>
    setSheet(current => (current === panel ? null : panel));

  // ── Regions ─────────────────────────────────────────────────

  const content = (
    <div className="flex min-h-full flex-col gap-4 p-4 lg:p-6">
      <OwnershipNotices
        record={template}
        ownsContent={owns}
        keptOnOldEngine={keptOnOldEngine}
        undo={undoNote}
        onOverride={() => setDialog("override")}
        onReview={startReview}
        onReset={() => setDialog("reset")}
      />
      {!isLayoutRow ? (
        <InboxStrip
          from={fromOverride}
          subject={previewSubject || subject}
          preheader={preheader}
        />
      ) : null}
      <div className="overflow-hidden rounded-lg border border-border">
        <EnvelopeBar
          control={form.control}
          isPending={isPending}
          isLayoutRow={isLayoutRow}
          ownsContent={owns}
        />
      </div>
      <div className="flex min-h-105 flex-1 flex-col overflow-hidden rounded-lg border border-border">
        <BodyEditor
          control={form.control}
          editorTab={editorTab}
          onEditorTabChange={setEditorTab}
          isPending={isPending}
          editorWrapRef={editorWrapRef}
          htmlEditorViewRef={htmlEditorViewRef}
          readOnly={!owns}
          chips={
            <VariableChips
              declared={variables ?? []}
              onInsert={insertVariable}
            />
          }
        />
      </div>
    </div>
  );

  const details = (
    <DetailsPanel
      control={form.control}
      isEdit={isEdit}
      isPending={isPending}
      isLayoutRow={isLayoutRow}
      providers={providers}
      layouts={layouts}
      declared={variables ?? []}
      onInsert={insertVariable}
      ownsContent={owns}
      carriesSecret={template?.carriesSecret === true}
    />
  );

  const data = isLayoutRow ? null : (
    <DataRail
      sampleText={sampleText}
      onSampleChange={setSampleOverride}
      onReset={() => setSampleOverride(null)}
      sampleError={sampleError}
      unknownVariables={unknownVariables}
    />
  );

  return (
    <Form {...form}>
      <form
        id={EMAIL_TEMPLATE_FORM_ID}
        onSubmit={e => {
          /*
           * The second argument is what stops a refusal being silent. The
           * Details sheet opens on demand, so a field it owns can be invalid
           * while the only message for it is unmounted: `handleSubmit` then
           * declines and nothing appears, which reads as a Save button that
           * does nothing.
           */
          void form.handleSubmit(onSubmit, errors => {
            if (regionsForRefusal(Object.keys(errors)).details) {
              setSheet("details");
            }
          })(e);
        }}
        className="h-full min-h-0"
        aria-busy={isPending}
      >
        <WorkbenchLayout
          splitLabel="Editor and preview"
          sheet={sheet}
          onSheetChange={setSheet}
          header={tier => (
            <WorkbenchHeader
              tier={tier}
              control={form.control}
              onNameChange={handleNameChange}
              record={template}
              isEdit={isEdit}
              isPending={isPending}
              isDirty={isDirty}
              isActive={isActive}
              ownsContent={owns}
              hasData={!isLayoutRow}
              sheet={sheet}
              onToggleSheet={toggleSheet}
              onExit={() => navigateTo(listHref)}
              exitLabel={
                listedUnderDesign ? "Back to Design" : "Back to Messages"
              }
              onSendTest={() => setSendTestOpen(true)}
              onOverride={() => setDialog("override")}
              menu={{
                onDuplicate: canDuplicate
                  ? () =>
                      navigateTo(
                        withQuery(ROUTES.EMAIL_MESSAGES_CREATE, {
                          duplicate: template?.id ?? "",
                        })
                      )
                  : undefined,
                onReview: template?.ownerChanged ? startReview : undefined,
                onReset: template?.overridden
                  ? () => setDialog("reset")
                  : undefined,
                onDelete: canDelete ? () => setDialog("delete") : undefined,
                deleteRefusal,
              }}
            />
          )}
          content={content}
          preview={
            <PreviewPane
              html={previewHtml}
              text={previewText}
              subject={previewSubject}
              format={editorTab}
              isPending={isPreviewPending}
              error={previewError}
            />
          }
          data={data}
          details={details}
          phoneBar={
            <>
              {isEdit ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={isPending}
                  onClick={() => setSendTestOpen(true)}
                >
                  Send test
                </Button>
              ) : null}
              {!owns ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={isPending}
                  onClick={() => setDialog("override")}
                >
                  Override
                </Button>
              ) : null}
              <SaveButton isEdit={isEdit} isPending={isPending} />
            </>
          }
        />

        {isEdit && (
          <SendTestDialog
            open={sendTestOpen}
            onOpenChange={setSendTestOpen}
            templateName={name}
            slug={slug}
            sampleData={sampleData}
          />
        )}
      </form>

      {template ? (
        <>
          <OverrideDialog
            open={dialog === "override"}
            onOpenChange={open => setDialog(open ? "override" : null)}
            name={template.name}
            owner={owner}
            isPending={override.isPending}
            onConfirm={confirmOverride}
          />
          <ResetDialog
            open={dialog === "reset"}
            onOpenChange={open => setDialog(open ? "reset" : null)}
            name={template.name}
            owner={owner}
            isPending={reset.isPending}
            onConfirm={confirmReset}
          />
          <UnsavedBeforeReviewDialog
            open={dialog === "unsaved"}
            onOpenChange={open => setDialog(open ? "unsaved" : null)}
            onDiscard={() => {
              form.reset(templateToFormValues(template));
              setDialog("review");
            }}
          />
          <OwnerUpdateReview
            open={dialog === "review"}
            onOpenChange={open => setDialog(open ? "review" : null)}
            templateId={template.id}
            name={template.name}
            owner={owner}
            onApplied={undo => setUndoable({ kind: "review", undo })}
          />
          <TemplateDeleteDialog
            open={dialog === "delete"}
            onOpenChange={open => setDialog(open ? "delete" : null)}
            template={{ id: template.id, name: template.name }}
            onConfirm={confirmDelete}
            isLoading={deleteTemplate.isPending}
          />
        </>
      ) : null}
    </Form>
  );
}
