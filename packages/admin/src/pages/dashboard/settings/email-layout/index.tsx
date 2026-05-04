"use client";

import { Button, Skeleton } from "@revnixhq/ui";
import Prism from "prismjs";
import "prismjs/components/prism-markup";
import type React from "react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import Editor from "react-simple-code-editor";

import {
  SettingsLayout,
  SettingsRow,
  SettingsSection,
} from "@admin/components/features/settings";
import { Loader2, Save } from "@admin/components/icons";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { toast } from "@admin/components/ui";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@admin/components/ui/form";
import {
  useEmailLayout,
  useUpdateEmailLayout,
} from "@admin/hooks/queries/useEmailTemplates";

// ============================================================
// Form id used by external buttons (e.g. SettingsLayout.actions)
// to submit this form via the `form` attribute.
// ============================================================

export const EMAIL_LAYOUT_FORM_ID = "email-layout-form";

// ============================================================
// Form Values Type
// ============================================================

interface EmailLayoutFormValues {
  header: string;
  footer: string;
}

const DEFAULT_VALUES: EmailLayoutFormValues = {
  header: "",
  footer: "",
};

// ============================================================
// HTML Syntax Highlighter (mirrors EmailTemplateForm pattern)
// ============================================================

function highlightHtml(code: string): string {
  try {
    if (Prism?.languages?.markup) {
      return Prism.highlight(code, Prism.languages.markup, "markup");
    }
    return escapeHtml(code);
  } catch {
    return escapeHtml(code);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Inline Prism token theme. Inlined as a <style> tag so we don't need
 * to wire a CSS import through the admin's Tailwind-only build pipeline.
 * Uses theme tokens so dark mode looks correct without overrides.
 */
const PRISM_THEME_CSS = `
.adminapp .html-code-editor :is(.token.tag, .token.keyword) { color: rgb(220 38 38); }
.adminapp .html-code-editor .token.attr-name { color: rgb(124 58 237); }
.adminapp .html-code-editor :is(.token.attr-value, .token.string) { color: rgb(22 101 52); }
.adminapp .html-code-editor :is(.token.comment, .token.prolog, .token.doctype, .token.cdata) { color: rgb(107 114 128); font-style: italic; }
.adminapp .html-code-editor :is(.token.punctuation, .token.operator) { color: rgb(75 85 99); }
.adminapp .html-code-editor .token.entity { cursor: help; }
.adminapp .dark .html-code-editor :is(.token.tag, .token.keyword) { color: rgb(252 165 165); }
.adminapp .dark .html-code-editor .token.attr-name { color: rgb(196 181 253); }
.adminapp .dark .html-code-editor :is(.token.attr-value, .token.string) { color: rgb(134 239 172); }
.adminapp .dark .html-code-editor :is(.token.comment, .token.prolog, .token.doctype, .token.cdata) { color: rgb(156 163 175); font-style: italic; }
.adminapp .dark .html-code-editor :is(.token.punctuation, .token.operator) { color: rgb(209 213 219); }
`;

// ============================================================
// Page Component
// ============================================================

const EmailLayoutPage: React.FC = () => {
  const { data: layout, isLoading } = useEmailLayout();
  const { mutate: doUpdateLayout, isPending: isSaving } =
    useUpdateEmailLayout();

  const form = useForm<EmailLayoutFormValues>({
    defaultValues: DEFAULT_VALUES,
  });

  // Hydrate form once layout data arrives.
  useEffect(() => {
    if (layout) {
      form.reset({ header: layout.header, footer: layout.footer });
    }
  }, [layout, form]);

  const onSubmit = (values: EmailLayoutFormValues) => {
    doUpdateLayout(values, {
      onSuccess: () => {
        toast.success("Email layout saved");
        // Reset to current values so the form is no longer dirty.
        form.reset(values);
      },
      onError: err =>
        toast.error("Failed to save layout", {
          description: err instanceof Error ? err.message : "Unknown error",
        }),
    });
  };

  const isDirty = form.formState.isDirty;
  const disableSave = isSaving || isLoading || !isDirty;

  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer>
        <Form {...form}>
          {/* Inlined Prism token styling — see PRISM_THEME_CSS above. */}
          <style>{PRISM_THEME_CSS}</style>
          <form
            id={EMAIL_LAYOUT_FORM_ID}
            onSubmit={e => {
              void form.handleSubmit(onSubmit)(e);
            }}
            aria-busy={isSaving}
          >
            <SettingsLayout
              actions={
                <Button
                  type="submit"
                  form={EMAIL_LAYOUT_FORM_ID}
                  disabled={disableSave}
                  className="flex items-center gap-2"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4" />
                      Save Changes
                    </>
                  )}
                </Button>
              }
            >
              {isLoading ? (
                <div className="space-y-5">
                  <Skeleton className="h-[260px] w-full rounded-none" />
                  <Skeleton className="h-[260px] w-full rounded-none" />
                </div>
              ) : (
                <div className="space-y-5">
                  <SettingsSection label="Global Header (HTML)">
                    <FormField
                      control={form.control}
                      name="header"
                      render={({ field }) => (
                        <FormItem className="m-0">
                          <SettingsRow
                            label="Header HTML"
                            description={
                              <>
                                Prepended automatically to every email template
                                that opts in to the layout. Supports variables
                                like <code>{"{{siteName}}"}</code>.
                              </>
                            }
                          >
                            <FormControl>
                              <div
                                className="html-code-editor rounded-none border border-input bg-background transition-colors focus-within:!border-primary hover:border-primary/30 max-h-[480px] overflow-auto"
                                aria-busy={isSaving}
                              >
                                <Editor
                                  value={field.value ?? ""}
                                  onValueChange={val => {
                                    if (!isSaving) field.onChange(val);
                                  }}
                                  highlight={highlightHtml}
                                  padding={12}
                                  tabSize={2}
                                  insertSpaces
                                  textareaClassName="outline-none"
                                  placeholder={
                                    '<div style="padding: 24px; text-align: center;">\n  <!-- Header HTML -->\n</div>'
                                  }
                                  className="min-h-[220px] font-mono text-sm leading-relaxed text-foreground caret-foreground [&_textarea]:!outline-none [&_textarea]:!ring-0 [&_textarea]:placeholder:text-muted-foreground [&_textarea]:placeholder:opacity-50"
                                />
                              </div>
                            </FormControl>
                            <FormMessage className="mt-1.5" />
                          </SettingsRow>
                        </FormItem>
                      )}
                    />
                  </SettingsSection>

                  <SettingsSection label="Global Footer (HTML)">
                    <FormField
                      control={form.control}
                      name="footer"
                      render={({ field }) => (
                        <FormItem className="m-0">
                          <SettingsRow
                            label="Footer HTML"
                            description={
                              <>
                                Appended automatically to every email template
                                that opts in to the layout. Supports variables
                                like <code>{"{{siteName}}"}</code>.
                              </>
                            }
                          >
                            <FormControl>
                              <div
                                className="html-code-editor rounded-none border border-input bg-background transition-colors focus-within:!border-primary hover:border-primary/30 max-h-[480px] overflow-auto"
                                aria-busy={isSaving}
                              >
                                <Editor
                                  value={field.value ?? ""}
                                  onValueChange={val => {
                                    if (!isSaving) field.onChange(val);
                                  }}
                                  highlight={highlightHtml}
                                  padding={12}
                                  tabSize={2}
                                  insertSpaces
                                  textareaClassName="outline-none"
                                  placeholder={
                                    '<div style="padding: 24px; text-align: center; color: #666;">\n  <!-- Footer HTML -->\n</div>'
                                  }
                                  className="min-h-[220px] font-mono text-sm leading-relaxed text-foreground caret-foreground [&_textarea]:!outline-none [&_textarea]:!ring-0 [&_textarea]:placeholder:text-muted-foreground [&_textarea]:placeholder:opacity-50"
                                />
                              </div>
                            </FormControl>
                            <FormMessage className="mt-1.5" />
                          </SettingsRow>
                        </FormItem>
                      )}
                    />
                  </SettingsSection>
                </div>
              )}
            </SettingsLayout>
          </form>
        </Form>
      </PageContainer>
    </QueryErrorBoundary>
  );
};

export default EmailLayoutPage;
