"use client";

import { type EditorView } from "@codemirror/view";
import { zodResolver } from "@hookform/resolvers/zod";
import { Badge, Button } from "@nextlyhq/ui";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useForm, type Resolver, type SubmitHandler } from "react-hook-form";

import {
  ArrowLeft,
  Braces,
  Code,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  Send,
  Settings,
} from "@admin/components/icons";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@admin/components/ui/form";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";
import { useEmailProviders } from "@admin/hooks/queries/useEmailProviders";
import { useEmailTemplates } from "@admin/hooks/queries/useEmailTemplates";
import { generateSlug } from "@admin/lib/fields";
import { cn } from "@admin/lib/utils";
import { type EmailTemplateRecord } from "@admin/services/emailTemplateApi";

import { DataRail } from "./DataRail";
import {
  DEFAULT_VALUES,
  EMAIL_TEMPLATE_FORM_ID,
  templateSchema,
  templateToFormValues,
  type TemplateFormValues,
} from "./schema";
import { Segmented, type SegOption } from "./Segmented";
import { SendTestDialog } from "./SendTestDialog";
import { SettingsRail } from "./SettingsRail";
import { PreviewPane } from "./TemplatePreview";
import { useDerivedTemplateState } from "./useDerivedTemplateState";
import { useVariableInsertion } from "./useVariableInsertion";
import { VariablesRail } from "./VariablesRail";

// CodeMirror reaches for browser globals on import, so it loads on demand
// rather than during SSR.
const CodeMirrorEditor = lazy(() =>
  import(
    "@admin/components/features/entries/fields/text/CodeMirrorEditor"
  ).then(m => ({ default: m.CodeMirrorEditor }))
);

// ============================================================
// EmailTemplateForm — three-pane workbench
// ============================================================

type RailTab = "variables" | "data" | "settings";

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

  const [railTab, setRailTab] = useState<RailTab>("variables");
  const [railOpen, setRailOpen] = useState(true);
  const [editorTab, setEditorTab] = useState<"html" | "text">("html");
  const [sampleOverride, setSampleOverride] = useState<string | null>(null);
  const [sendTestOpen, setSendTestOpen] = useState(false);

  const form = useForm<TemplateFormValues>({
    resolver: zodResolver(
      templateSchema
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

  // The row being edited keeps its kind; layouts are wrappers, not bodies.
  const currentKind = template?.kind ?? "template";
  const isLayoutRow = currentKind === "layout";

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
  const railTabs: SegOption<RailTab>[] = [
    {
      value: "variables",
      icon: <Braces className="h-3.5 w-3.5" />,
      label: "Variables",
    },
    { value: "data", icon: <Code className="h-3.5 w-3.5" />, label: "Data" },
    {
      value: "settings",
      icon: <Settings className="h-3.5 w-3.5" />,
      label: "Settings",
    },
  ];

  return (
    <Form {...form}>
      <form
        id={EMAIL_TEMPLATE_FORM_ID}
        onSubmit={e => {
          void form.handleSubmit(onSubmit)(e);
        }}
        className="flex h-full min-h-0 flex-col bg-background"
        aria-busy={isPending}
      >
        {/* ── Top bar ─────────────────────────────────────────── */}
        <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2.5">
          <Link
            href={ROUTES.SETTINGS_EMAIL_TEMPLATES}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-input text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Back to templates"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>

          <div className="min-w-0 flex-1">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <input
                  {...field}
                  onChange={e =>
                    handleNameChange(e.target.value, field.onChange)
                  }
                  disabled={isPending}
                  placeholder="Untitled template"
                  aria-label="Template name"
                  className="w-full max-w-md truncate bg-transparent text-lg font-semibold text-foreground outline-none placeholder:text-muted-foreground"
                />
              )}
            />
            <div className="font-mono text-xs text-muted-foreground">
              {slug || "no-slug"}
            </div>
          </div>

          <Badge
            variant={isActive ? "default" : "outline"}
            className="shrink-0"
          >
            {isActive ? "Active" : "Inactive"}
          </Badge>
          {isDirty ? (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning"
              title="Unsaved changes"
              aria-label="Unsaved changes"
            />
          ) : null}

          {isEdit && (
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => setSendTestOpen(true)}
            >
              <Send className="h-4 w-4" />
              Send test
            </Button>
          )}
          <Link href={ROUTES.SETTINGS_EMAIL_TEMPLATES}>
            <Button type="button" variant="outline" disabled={isPending}>
              Cancel
            </Button>
          </Link>
          <Button type="submit" disabled={isPending}>
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {isEdit ? "Saving…" : "Creating…"}
              </>
            ) : isEdit ? (
              "Save"
            ) : (
              "Create template"
            )}
          </Button>
        </header>

        {isEdit && (
          <SendTestDialog
            open={sendTestOpen}
            onOpenChange={setSendTestOpen}
            templateName={name}
            slug={slug}
            sampleData={sampleData}
          />
        )}

        {/* ── Body: three panes (fixed rail + two equal panes) ── */}
        {/*
         * `auto-rows-min` is what makes the stacked layout scroll instead of
         * overlap, and it is load-bearing below `xl`.
         *
         * Stacked, the panes are rows of a grid whose own height is definite
         * (`flex-1` inside a fixed-height column). Default `auto` rows in a
         * definite-height grid are STRETCHED to fill it, so three rows share
         * the height and each lands near 250px — while the editor and preview
         * carry `min-h-[380px]` and `min-h-[420px]` floors. A row shorter than
         * its content would normally scroll, but each pane also carries
         * `min-h-0` and its overflow is only hidden at `xl`, so the content
         * spilled out of its own row and drew on top of the pane below it.
         *
         * Sizing the rows to their content instead lets `overflow-y-auto` on
         * this container do the scrolling, which is what it was there for.
         *
         * Reset at `xl`, where the panes become side-by-side columns that must
         * FILL the viewport height rather than shrink to their content —
         * `min-content` there leaves a dead band below them.
         */}
        <div
          className={cn(
            "grid min-h-0 flex-1 auto-rows-min grid-cols-1 overflow-y-auto xl:auto-rows-auto xl:overflow-hidden",
            railOpen ? "xl:grid-cols-[320px_1fr_1fr]" : "xl:grid-cols-[1fr_1fr]"
          )}
        >
          {/* Left rail */}
          <aside
            className={cn(
              "flex min-h-0 min-w-0 flex-col border-b border-border xl:border-b-0 xl:border-r xl:overflow-hidden",
              !railOpen && "hidden"
            )}
          >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border p-2">
              <Segmented<RailTab>
                value={railTab}
                onChange={setRailTab}
                options={railTabs}
              />
              <button
                type="button"
                onClick={() => setRailOpen(false)}
                aria-label="Hide panel"
                title="Hide panel"
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {railTab === "variables" && (
                <VariablesRail
                  control={form.control}
                  declared={variables ?? []}
                  onInsert={insertVariable}
                />
              )}
              {railTab === "data" && (
                <DataRail
                  sampleText={sampleText}
                  onSampleChange={setSampleOverride}
                  onReset={() => setSampleOverride(null)}
                  sampleError={sampleError}
                  unknownVariables={unknownVariables}
                />
              )}
              {railTab === "settings" && (
                <SettingsRail
                  control={form.control}
                  isEdit={isEdit}
                  isPending={isPending}
                  isLayoutRow={isLayoutRow}
                  providers={providers}
                  layouts={layouts}
                />
              )}
            </div>
          </aside>

          {/* Center: envelope + editor */}
          <section className="flex min-h-0 min-w-0 flex-col border-b border-border xl:border-b-0 xl:border-r xl:overflow-hidden">
            {/* Envelope */}
            <div className="shrink-0 border-b border-border p-3">
              <FormField
                control={form.control}
                name="subject"
                render={({ field }) => (
                  <FormItem className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Subject
                      </span>
                      <FormControl>
                        <input
                          {...field}
                          disabled={isPending}
                          placeholder="Welcome to {{appName}}"
                          className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                        />
                      </FormControl>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Editor toolbar */}
            <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
              {!railOpen ? (
                <button
                  type="button"
                  onClick={() => setRailOpen(true)}
                  aria-label="Show panel"
                  title="Show panel"
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-input text-muted-foreground transition-colors hover:text-foreground"
                >
                  <PanelLeftOpen className="h-4 w-4" />
                </button>
              ) : null}
              <Segmented<"html" | "text">
                value={editorTab}
                onChange={setEditorTab}
                options={[
                  { value: "html", label: "HTML" },
                  { value: "text", label: "Plain text" },
                ]}
              />
              {unknownVariables.length > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    setRailOpen(true);
                    setRailTab("data");
                  }}
                  className="ml-auto text-xs text-warning hover:underline"
                >
                  {unknownVariables.length} unknown variable
                  {unknownVariables.length === 1 ? "" : "s"}
                </button>
              ) : null}
            </div>

            {/* Editor body */}
            <div
              ref={editorWrapRef}
              className="html-code-editor min-h-[380px] flex-1 overflow-auto bg-background xl:min-h-0"
            >
              {editorTab === "html" ? (
                <FormField
                  // Distinct key so React mounts a fresh Controller per tab.
                  // Without it, one Controller's `name` would flip between
                  // htmlContent/plainTextContent on toggle and react-hook-form
                  // leaks/blanks the values after repeated switches.
                  key="editor-html"
                  control={form.control}
                  name="htmlContent"
                  render={({ field }) => (
                    <Suspense
                      fallback={
                        <div className="min-h-[380px] w-full animate-pulse bg-muted/30" />
                      }
                    >
                      <CodeMirrorEditor
                        value={field.value ?? ""}
                        onChange={val => {
                          if (!isPending) field.onChange(val);
                        }}
                        onCreateEditor={view => {
                          htmlEditorViewRef.current = view;
                        }}
                        language="html"
                        disabled={isPending}
                        readOnly={false}
                        minHeight={380}
                        editorOptions={{ tabSize: 2 }}
                        placeholder={
                          "<h1>Hello {{userName}}</h1>\n<p>Welcome to {{appName}}.</p>"
                        }
                      />
                    </Suspense>
                  )}
                />
              ) : (
                <FormField
                  key="editor-text"
                  control={form.control}
                  name="plainTextContent"
                  render={({ field }) => (
                    <textarea
                      {...field}
                      value={field.value ?? ""}
                      disabled={isPending}
                      placeholder="Plain-text fallback sent alongside the HTML…"
                      className="h-full min-h-[380px] w-full resize-none bg-background p-3.5 font-mono text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground xl:min-h-full"
                    />
                  )}
                />
              )}
            </div>
          </section>

          {/* Right: preview */}
          <section className="flex min-h-0 min-w-0 flex-col xl:overflow-hidden">
            <div className="min-h-[420px] flex-1 xl:min-h-0">
              <PreviewPane
                html={previewHtml}
                text={previewText}
                subject={previewSubject}
                format={editorTab}
              />
            </div>
          </section>
        </div>
      </form>
    </Form>
  );
}
