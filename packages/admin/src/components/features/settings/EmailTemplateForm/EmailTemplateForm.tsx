"use client";

import { type EditorView } from "@codemirror/view";
import { zodResolver } from "@hookform/resolvers/zod";
import type { JSX } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm, type Resolver, type SubmitHandler } from "react-hook-form";

import { Form } from "@admin/components/ui/form";
import { ROUTES } from "@admin/constants/routes";
import { useEmailProviders } from "@admin/hooks/queries/useEmailProviders";
import { useEmailTemplates } from "@admin/hooks/queries/useEmailTemplates";
import { generateSlug } from "@admin/lib/fields";
import { navigateTo } from "@admin/lib/navigation";
import { type EmailTemplateRecord } from "@admin/services/emailTemplateApi";

import { BodyEditor } from "./BodyEditor";
import { DataRail } from "./DataRail";
import { DetailsPanel } from "./DetailsPanel";
import { EnvelopeBar } from "./EnvelopeBar";
import { InboxStrip } from "./InboxStrip";
import { OwnershipNotices } from "./OwnershipNotices";
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
import { useOwnershipActs, type OwnershipActs } from "./useOwnershipActs";
import { useVariableInsertion } from "./useVariableInsertion";
import { VariableChips } from "./VariablesRail";
import { ownsContent } from "./workbench-model";
import { WorkbenchDialogs } from "./WorkbenchDialogs";
import { PhoneActions, WorkbenchHeader } from "./WorkbenchHeader";
import {
  WorkbenchLayout,
  type RevealRequest,
  type SheetPanel,
} from "./WorkbenchLayout";

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

type FormOf = ReturnType<typeof useForm<TemplateFormValues>>;

/** The content column: whose email it is, the inbox line, envelope and body. */
function ContentColumn({
  form,
  template,
  owns,
  keptOnOldEngine,
  acts,
  isPending,
  isLayoutRow,
  previewSubject,
  editor,
}: {
  form: FormOf;
  template?: EmailTemplateRecord;
  owns: boolean;
  keptOnOldEngine: boolean;
  acts: OwnershipActs;
  isPending: boolean;
  isLayoutRow: boolean;
  previewSubject: string;
  editor: Omit<
    React.ComponentProps<typeof BodyEditor>,
    "control" | "isPending" | "readOnly"
  >;
}) {
  const [subject, preheader, fromOverride] = form.watch([
    "subject",
    "preheader",
    "fromOverride",
  ]);
  return (
    // The column scrolls, so its cards keep their height (a shrunk card clips
    // its own fields); only the body grows into what is left.
    <div className="flex min-h-full flex-col gap-4 p-4 *:shrink-0 lg:p-6">
      <OwnershipNotices
        record={template}
        ownsContent={owns}
        keptOnOldEngine={keptOnOldEngine}
        undo={acts.undoNote}
        onOverride={() => acts.startAct("override")}
        onReview={() => acts.startAct("review")}
        onReset={() => acts.startAct("reset")}
      />
      {isLayoutRow ? null : (
        <InboxStrip
          from={fromOverride}
          subject={previewSubject || subject}
          preheader={preheader}
        />
      )}
      <div
        data-testid="workbench-envelope"
        className="overflow-hidden rounded-lg border border-border"
      >
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
          isPending={isPending}
          readOnly={!owns}
          {...editor}
        />
      </div>
    </div>
  );
}

export function EmailTemplateForm({
  mode,
  template,
  initialValues,
  isPending,
  onSubmit,
}: EmailTemplateFormProps): JSX.Element {
  const isEdit = mode === "edit";
  const slugTouchedRef = useRef(false);
  const editorWrapRef = useRef<HTMLDivElement>(null);
  const htmlEditorViewRef = useRef<EditorView | null>(null);

  const [editorTab, setEditorTab] = useState<"html" | "text">("html");
  const [sheet, setSheet] = useState<SheetPanel | null>(null);
  const [revealRequest, setRevealRequest] = useState<RevealRequest>({
    panel: "edit",
    seq: 0,
  });
  const reveal = (panel: RevealRequest["panel"]) =>
    setRevealRequest(previous => ({ panel, seq: previous.seq + 1 }));
  const [sampleOverride, setSampleOverride] = useState<string | null>(null);
  const [sendTestOpen, setSendTestOpen] = useState(false);

  // The row being edited keeps its kind; layouts are wrappers, not bodies.
  const currentKind = template?.kind ?? "template";
  const isLayoutRow = currentKind === "layout";
  // Emails are listed under Messages, and layouts and partials under Design;
  // leaving the workbench returns to the tab that lists it.
  const listedUnderDesign = currentKind !== "template";
  const listHref = listedUnderDesign ? ROUTES.EMAIL_DESIGN : ROUTES.EMAIL;
  const owns = ownsContent(template);

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

  const { data: allTemplates } = useEmailTemplates();
  const layouts = useMemo(
    () => (allTemplates ?? []).filter(t => t.kind === "layout"),
    [allTemplates]
  );
  // Only the list says whether an email is kept on the previous engine.
  const keptOnOldEngine = Boolean(
    allTemplates?.find(t => t.id === template?.id)?.keptOnOldEngine
  );

  const acts = useOwnershipActs({
    template,
    isDirty: form.formState.isDirty,
    listHref,
  });

  const [
    htmlContent,
    plainTextContent,
    subject,
    preheader,
    useLayout,
    isActive,
    slug,
    name,
    variables,
    layoutId,
  ] = form.watch([
    "htmlContent",
    "plainTextContent",
    "subject",
    "preheader",
    "useLayout",
    "isActive",
    "slug",
    "name",
    "variables",
    "layoutId",
  ]);

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

  const derived = useDerivedTemplateState({
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

  const toggleSheet = (panel: SheetPanel) =>
    setSheet(current => (current === panel ? null : panel));
  const openSendTest = () => setSendTestOpen(true);
  const openOverride = () => acts.startAct("override");

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
            // The editor's own fields first: they're the content itself.
            const regions = regionsForRefusal(Object.keys(errors));
            if (regions.content) {
              reveal("edit");
            } else if (regions.details) {
              setSheet("details");
              reveal("details");
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
          revealRequest={revealRequest}
          header={tier => (
            <WorkbenchHeader
              tier={tier}
              control={form.control}
              onNameChange={handleNameChange}
              record={template}
              isEdit={isEdit}
              isPending={isPending}
              isDirty={form.formState.isDirty}
              isActive={isActive}
              ownsContent={owns}
              hasData={!isLayoutRow}
              sheet={sheet}
              onToggleSheet={toggleSheet}
              onExit={() => navigateTo(listHref)}
              exitLabel={
                listedUnderDesign ? "Back to Design" : "Back to Messages"
              }
              onSendTest={openSendTest}
              onOverride={openOverride}
              menu={acts.menu}
            />
          )}
          content={
            <ContentColumn
              form={form}
              template={template}
              owns={owns}
              keptOnOldEngine={keptOnOldEngine}
              acts={acts}
              isPending={isPending}
              isLayoutRow={isLayoutRow}
              previewSubject={derived.previewSubject}
              editor={{
                editorTab,
                onEditorTabChange: setEditorTab,
                editorWrapRef,
                htmlEditorViewRef,
                chips: (
                  <VariableChips
                    declared={variables ?? []}
                    onInsert={insertVariable}
                  />
                ),
              }}
            />
          }
          preview={
            <PreviewPane
              html={derived.previewHtml}
              text={derived.previewText}
              subject={derived.previewSubject}
              format={editorTab}
              isPending={derived.isPreviewPending}
              error={derived.previewError}
            />
          }
          data={
            isLayoutRow ? null : (
              <DataRail
                sampleText={derived.sampleText}
                onSampleChange={setSampleOverride}
                onReset={() => setSampleOverride(null)}
                sampleError={derived.sampleError}
                unknownVariables={derived.unknownVariables}
              />
            )
          }
          details={
            <DetailsPanel
              control={form.control}
              isEdit={isEdit}
              isPending={isPending}
              isLayoutRow={isLayoutRow}
              providers={providersData?.data ?? []}
              layouts={layouts}
              declared={variables ?? []}
              onInsert={insertVariable}
              ownsContent={owns}
              carriesSecret={template?.carriesSecret === true}
            />
          }
          phoneBar={
            <PhoneActions
              isEdit={isEdit}
              isPending={isPending}
              ownsContent={owns}
              onSendTest={openSendTest}
              onOverride={openOverride}
            />
          }
        />

        {isEdit && (
          <SendTestDialog
            open={sendTestOpen}
            onOpenChange={setSendTestOpen}
            templateId={template?.id ?? ""}
            templateName={name}
            slug={slug}
            sampleData={derived.sampleData}
          />
        )}
      </form>

      {template ? (
        <WorkbenchDialogs
          template={template}
          acts={acts}
          onDiscardEdits={() => form.reset(templateToFormValues(template))}
        />
      ) : null}
    </Form>
  );
}
