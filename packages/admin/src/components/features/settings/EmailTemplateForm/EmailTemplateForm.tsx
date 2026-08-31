"use client";

import { type EditorView } from "@codemirror/view";
import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm, type Resolver, type SubmitHandler } from "react-hook-form";

import { ImmersiveShell } from "@admin/components/layout/immersive-shell";
import { Form } from "@admin/components/ui/form";
import { ROUTES } from "@admin/constants/routes";
import { useEmailProviders } from "@admin/hooks/queries/useEmailProviders";
import { useEmailTemplates } from "@admin/hooks/queries/useEmailTemplates";
import { useMediaQuery } from "@admin/hooks/useMediaQuery";
import { generateSlug } from "@admin/lib/fields";
import { navigateTo } from "@admin/lib/navigation";
import { type EmailTemplateRecord } from "@admin/services/emailTemplateApi";

import { BodyEditor } from "./BodyEditor";
import { EditorBar } from "./EditorBar";
import { EnvelopeBar } from "./EnvelopeBar";
import { regionsForRefusal } from "./refusal-routing";
import {
  DEFAULT_VALUES,
  EMAIL_TEMPLATE_FORM_ID,
  templateSchemaFor,
  templateToFormValues,
  type TemplateFormValues,
} from "./schema";
import { SendTestDialog } from "./SendTestDialog";
import { TemplateDrawer } from "./TemplateDrawer";
import { TemplateInspector } from "./TemplateInspector";
import { PreviewPane } from "./TemplatePreview";
import { useDerivedTemplateState } from "./useDerivedTemplateState";
import { useVariableInsertion } from "./useVariableInsertion";
import { VariableChips } from "./VariablesRail";

// ============================================================
// EmailTemplateForm — three-pane workbench
// ============================================================

export interface EmailTemplateFormProps {
  mode: "create" | "edit";
  template?: EmailTemplateRecord;
  initialValues?: TemplateFormValues;
  isPending: boolean;
  onSubmit: SubmitHandler<TemplateFormValues>;
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
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  /*
   * Below this the two panes stack. `xl` is where the previous grid switched to
   * columns, and it is the width at which a 600px email and a code column stop
   * both fitting.
   */
  const isNarrow = !useMediaQuery("(min-width: 1280px)");
  const [sampleOverride, setSampleOverride] = useState<string | null>(null);
  const [sendTestOpen, setSendTestOpen] = useState(false);

  // The row being edited keeps its kind; layouts are wrappers, not bodies.
  const currentKind = template?.kind ?? "template";
  const isLayoutRow = currentKind === "layout";

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

  const htmlContent = form.watch("htmlContent");
  const plainTextContent = form.watch("plainTextContent");
  const subject = form.watch("subject");
  const useLayout = form.watch("useLayout");
  const isActive = form.watch("isActive");
  const slug = form.watch("slug");
  const name = form.watch("name");
  const variables = form.watch("variables");
  const layoutId = form.watch("layoutId");
  const isDirty = form.formState.isDirty;

  // Resolve the wrapping layout for the live preview: the explicit choice,
  // else the default-layout row, else the first available layout.
  const activeLayout = useMemo(() => {
    if (layoutId) return layouts.find(l => l.id === layoutId) ?? null;
    return layouts.find(l => l.slug === "default-layout") ?? layouts[0] ?? null;
  }, [layouts, layoutId]);

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

  // Sample data derived from declared variables unless overridden.
  const {
    sampleText,
    sampleData,
    sampleError,
    unknownVariables,
    previewHtml,
    previewText,
    previewSubject,
  } = useDerivedTemplateState({
    variables,
    sampleOverride,
    subject,
    htmlContent,
    plainTextContent,
    useLayout,
    activeLayout,
    isLayoutRow,
  });

  return (
    <Form {...form}>
      <form
        id={EMAIL_TEMPLATE_FORM_ID}
        onSubmit={e => {
          /*
           * The second argument is what stops a refusal being silent. The
           * inspector is summoned, so a field it owns can be invalid while the
           * only message for it is unmounted — `handleSubmit` then declines and
           * nothing appears, which reads as a Save button that does nothing.
           */
          void form.handleSubmit(onSubmit, errors => {
            if (regionsForRefusal(Object.keys(errors)).inspector) {
              setInspectorOpen(true);
            }
          })(e);
        }}
        className="h-full min-h-0"
        aria-busy={isPending}
      >
        <ImmersiveShell
          /*
           * `subSidebar` is the settings navigation — 256px of destinations
           * nobody editing a template is heading to. `pageFrame` is the
           * container's padding, which a full-bleed surface reads as a mistake
           * rather than as a margin. The primary rail STAYS: it is the whole of
           * the admin's navigation, and taking it is a larger claim than a
           * width problem justifies.
           */
          suppress={["subSidebar", "pageFrame"]}
          onExit={() => navigateTo(ROUTES.SETTINGS_EMAIL_TEMPLATES)}
          exitLabel="Back to templates"
          splitLabel="Editor and preview"
          /*
           * Side by side on a phone gives two columns too narrow to author in
           * or to judge from, so the panes stack. The breakpoint lives here
           * rather than in the shell because only this screen knows what its
           * own panes cost at a width.
           */
          orientation={isNarrow ? "vertical" : "horizontal"}
          bar={
            <EditorBar
              control={form.control}
              isEdit={isEdit}
              isPending={isPending}
              isActive={isActive}
              isDirty={isDirty}
              slug={slug}
              onNameChange={handleNameChange}
              onSendTest={() => setSendTestOpen(true)}
              onOpenSettings={() => setInspectorOpen(true)}
            />
          }
          band={
            <EnvelopeBar
              control={form.control}
              isPending={isPending}
              isLayoutRow={isLayoutRow}
            />
          }
          primary={
            <BodyEditor
              control={form.control}
              editorTab={editorTab}
              onEditorTabChange={setEditorTab}
              isPending={isPending}
              editorWrapRef={editorWrapRef}
              htmlEditorViewRef={htmlEditorViewRef}
              chips={
                <VariableChips
                  declared={variables ?? []}
                  onInsert={insertVariable}
                />
              }
            />
          }
          secondary={
            <PreviewPane
              html={previewHtml}
              text={previewText}
              subject={previewSubject}
              format={editorTab}
            />
          }
          inspector={
            inspectorOpen ? (
              <TemplateInspector
                control={form.control}
                isEdit={isEdit}
                isPending={isPending}
                isLayoutRow={isLayoutRow}
                providers={providers}
                layouts={layouts}
                declared={variables ?? []}
                onInsert={insertVariable}
                onClose={() => setInspectorOpen(false)}
              />
            ) : undefined
          }
          drawer={
            <TemplateDrawer
              open={drawerOpen}
              onOpenChange={setDrawerOpen}
              sampleText={sampleText}
              onSampleChange={setSampleOverride}
              onReset={() => setSampleOverride(null)}
              sampleError={sampleError}
              unknownVariables={unknownVariables}
            />
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
    </Form>
  );
}
