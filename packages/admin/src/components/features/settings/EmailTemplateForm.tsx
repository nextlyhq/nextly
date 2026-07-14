"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from "@nextlyhq/ui";
import Prism from "prismjs";
import "prismjs/components/prism-markup";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useFieldArray,
  useForm,
  type Resolver,
  type SubmitHandler,
} from "react-hook-form";
import Editor from "react-simple-code-editor";
import { z } from "zod";

import { MediaPickerDialog } from "@admin/components/features/media-library/MediaPickerDialog";
import {
  ArrowLeft,
  Braces,
  Code,
  Loader2,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Plus,
  Send,
  Settings,
  Smartphone,
  Sun,
  Trash2,
} from "@admin/components/icons";
import { toast } from "@admin/components/ui";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@admin/components/ui/form";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";
import { useEmailProviders } from "@admin/hooks/queries/useEmailProviders";
import {
  useEmailTemplates,
  useSendTestEmailTemplate,
} from "@admin/hooks/queries/useEmailTemplates";
import { generateSlug } from "@admin/lib/fields";
import { cn } from "@admin/lib/utils";
import type {
  CreateEmailTemplatePayload,
  EmailTemplateRecord,
  UpdateEmailTemplatePayload,
} from "@admin/services/emailTemplateApi";
import type { Media } from "@admin/types/media";

// ============================================================
// Form id (external submit hooks may still reference it).
// ============================================================

export const EMAIL_TEMPLATE_FORM_ID = "email-template-form";

// ============================================================
// Form Values Type
// ============================================================

export interface TemplateFormVariable {
  name: string;
  description: string;
  required: boolean;
}

export interface TemplateFormAttachment {
  mediaId: string;
  filename?: string;
  displayName: string;
  mimeType?: string;
}

export interface TemplateFormValues {
  name: string;
  slug: string;
  subject: string;
  preheader: string;
  htmlContent: string;
  plainTextContent: string;
  useLayout: boolean;
  isActive: boolean;
  providerId: string; // empty string = "Use Default"
  layoutId: string; // empty string = "Default layout"
  fromOverride: string;
  replyTo: string;
  variables: TemplateFormVariable[];
  attachments: TemplateFormAttachment[];
}

// ============================================================
// Zod Schema
// ============================================================

const templateVariableSchema = z.object({
  name: z
    .string()
    .min(1, "Variable name is required")
    .max(100)
    .regex(
      /^[a-zA-Z][a-zA-Z0-9_.]*$/,
      "Must start with a letter (letters, numbers, underscores, dots allowed)"
    ),
  description: z.string().max(255).optional().or(z.literal("")),
  required: z.boolean(),
});

const templateAttachmentSchema = z.object({
  mediaId: z.string().min(1),
  filename: z.string().optional(),
  displayName: z.string(),
  mimeType: z.string().optional(),
});

const templateSchema = z.object({
  name: z.string().min(1, "Template name is required").max(255),
  slug: z
    .string()
    .min(1, "Slug is required")
    .max(255)
    .regex(
      /^[a-z0-9]+(?:[-][a-z0-9]+)*$/,
      "Must be a valid slug (lowercase letters, numbers, and hyphens)"
    ),
  subject: z.string().min(1, "Email subject is required").max(500),
  preheader: z.string().max(255).optional().or(z.literal("")),
  htmlContent: z.string().min(1, "HTML content is required"),
  plainTextContent: z.string().optional().or(z.literal("")),
  useLayout: z.boolean(),
  isActive: z.boolean(),
  providerId: z.string().optional().or(z.literal("")),
  layoutId: z.string().optional().or(z.literal("")),
  fromOverride: z.string().max(320).optional().or(z.literal("")),
  replyTo: z.string().max(320).optional().or(z.literal("")),
  variables: z.array(templateVariableSchema),
  attachments: z.array(templateAttachmentSchema),
});

const DEFAULT_VALUES: TemplateFormValues = {
  name: "",
  slug: "",
  subject: "",
  preheader: "",
  htmlContent: "",
  plainTextContent: "",
  useLayout: true,
  isActive: true,
  providerId: "",
  layoutId: "",
  fromOverride: "",
  replyTo: "",
  variables: [],
  attachments: [],
};

// Sentinels for "Use Default" (Radix Select rejects empty values).
const USE_DEFAULT_PROVIDER = "__default__";
const USE_DEFAULT_LAYOUT = "__default_layout__";

// ============================================================
// Variables & sample data
// ============================================================

// Variables the layout composition injects automatically. Everything else
// comes from the send payload and the custom variables declared below.
const BUILT_IN_VARIABLES = [
  { name: "appName", description: "Your application name" },
  { name: "year", description: "Current year" },
];

const SAMPLE_VALUE_BY_NAME: Record<string, string> = {
  appName: "Northwind",
  year: String(new Date().getFullYear()),
  userName: "Priya Raman",
  name: "Priya Raman",
  userEmail: "priya.raman@northwind.io",
  email: "priya.raman@northwind.io",
  verifyLink: "https://app.northwind.io/verify?token=8f2c1a",
  resetLink: "https://app.northwind.io/reset?token=8f2c1a",
  url: "https://app.northwind.io/action?token=8f2c1a",
  token: "8f2c1a",
  expiresIn: "30 minutes",
  siteName: "Northwind",
  siteUrl: "https://northwind.io",
};

function sampleValueForVariable(name: string): string {
  return SAMPLE_VALUE_BY_NAME[name] ?? `Sample ${name}`;
}

function buildSampleData(
  variables: TemplateFormVariable[]
): Record<string, string> {
  const data: Record<string, string> = {
    appName: SAMPLE_VALUE_BY_NAME.appName,
    year: SAMPLE_VALUE_BY_NAME.year,
  };
  for (const v of variables) {
    if (!v.name || v.name.includes(".")) continue;
    data[v.name] = sampleValueForVariable(v.name);
  }
  return data;
}

// ============================================================
// Client-side interpolation (mirrors the core {{var}} engine)
// ============================================================

const TEMPLATE_VAR_RE = /{{\s*([\w.]+)\s*}}/g;

function escapeHtmlValue(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function resolvePath(data: Record<string, unknown>, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === "object"
          ? (acc as Record<string, unknown>)[key]
          : undefined,
      data
    );
}

function interpolate(
  template: string,
  data: Record<string, unknown>,
  escape = true
): string {
  return template.replace(TEMPLATE_VAR_RE, (_m, path: string) => {
    const value = resolvePath(data, path);
    if (value === undefined || value === null) return "";
    const str =
      typeof value === "string"
        ? value
        : typeof value === "number" ||
            typeof value === "boolean" ||
            typeof value === "bigint"
          ? String(value)
          : (JSON.stringify(value) ?? "");
    return escape ? escapeHtmlValue(str) : str;
  });
}

function collectVariableNames(source: string): string[] {
  const names = new Set<string>();
  for (const match of source.matchAll(TEMPLATE_VAR_RE)) names.add(match[1]);
  return [...names];
}

// ============================================================
// Payload transforms
// ============================================================

export function formValuesToCreatePayload(
  values: TemplateFormValues
): CreateEmailTemplatePayload {
  return {
    name: values.name,
    slug: values.slug,
    subject: values.subject,
    preheader: values.preheader || null,
    htmlContent: values.htmlContent,
    plainTextContent: values.plainTextContent || null,
    useLayout: values.useLayout,
    isActive: values.isActive,
    providerId: values.providerId || null,
    layoutId: values.layoutId || null,
    fromOverride: values.fromOverride || null,
    replyTo: values.replyTo || null,
    variables: values.variables.length > 0 ? values.variables : null,
    attachments:
      values.attachments.length > 0
        ? values.attachments.map(a => ({
            mediaId: a.mediaId,
            ...(a.filename ? { filename: a.filename } : {}),
          }))
        : null,
  };
}

export function formValuesToUpdatePayload(
  values: TemplateFormValues
): UpdateEmailTemplatePayload {
  return {
    name: values.name,
    subject: values.subject,
    preheader: values.preheader || null,
    htmlContent: values.htmlContent,
    plainTextContent: values.plainTextContent || null,
    useLayout: values.useLayout,
    isActive: values.isActive,
    providerId: values.providerId || null,
    layoutId: values.layoutId || null,
    fromOverride: values.fromOverride || null,
    replyTo: values.replyTo || null,
    variables: values.variables.length > 0 ? values.variables : null,
    attachments:
      values.attachments.length > 0
        ? values.attachments.map(a => ({
            mediaId: a.mediaId,
            ...(a.filename ? { filename: a.filename } : {}),
          }))
        : null,
  };
}

export function templateToFormValues(
  template: EmailTemplateRecord
): TemplateFormValues {
  return {
    name: template.name,
    slug: template.slug,
    subject: template.subject,
    preheader: template.preheader ?? "",
    htmlContent: template.htmlContent,
    plainTextContent: template.plainTextContent ?? "",
    useLayout: template.useLayout,
    isActive: template.isActive,
    providerId: template.providerId ?? "",
    layoutId: template.layoutId ?? "",
    fromOverride: template.fromOverride ?? "",
    replyTo: template.replyTo ?? "",
    variables: (template.variables ?? []).map(v => ({
      name: v.name,
      description: v.description,
      required: v.required ?? false,
    })),
    attachments: (template.attachments ?? []).map(a => ({
      mediaId: a.mediaId,
      filename: a.filename,
      displayName: a.filename ?? a.mediaId,
    })),
  };
}

// ============================================================
// HTML syntax highlighter (Prism)
// ============================================================

function highlightHtml(code: string): string {
  try {
    if (Prism?.languages?.markup) {
      return Prism.highlight(code, Prism.languages.markup, "markup");
    }
    return escapeHtmlValue(code);
  } catch {
    return escapeHtmlValue(code);
  }
}

const PRISM_THEME_CSS = `
.adminapp .html-code-editor :is(.token.tag, .token.keyword) { color: rgb(220 38 38); }
.adminapp .html-code-editor .token.attr-name { color: rgb(124 58 237); }
.adminapp .html-code-editor :is(.token.attr-value, .token.string) { color: rgb(22 101 52); }
.adminapp .html-code-editor :is(.token.comment, .token.prolog, .token.doctype, .token.cdata) { color: rgb(107 114 128); font-style: italic; }
.adminapp .html-code-editor :is(.token.punctuation, .token.operator) { color: rgb(75 85 99); }
.adminapp .dark .html-code-editor :is(.token.tag, .token.keyword) { color: rgb(252 165 165); }
.adminapp .dark .html-code-editor .token.attr-name { color: rgb(196 181 253); }
.adminapp .dark .html-code-editor :is(.token.attr-value, .token.string) { color: rgb(134 239 172); }
.adminapp .dark .html-code-editor :is(.token.comment, .token.prolog, .token.doctype, .token.cdata) { color: rgb(156 163 175); font-style: italic; }
.adminapp .dark .html-code-editor :is(.token.punctuation, .token.operator) { color: rgb(209 213 219); }
`;

// ============================================================
// Small UI: segmented control
// ============================================================

type SegOption<T extends string> = {
  value: T;
  label?: string;
  icon?: React.ReactNode;
  title?: string;
};

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: SegOption<T>[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex items-center rounded-none border border-input">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          aria-label={o.title ?? o.label}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex h-7 items-center gap-1.5 px-2.5 text-xs transition-colors",
            value === o.value
              ? "bg-primary text-primary-foreground"
              : "bg-background text-muted-foreground hover:text-foreground"
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ============================================================
// Preview pane
// ============================================================

type PreviewDevice = "desktop" | "mobile";
type PreviewTheme = "light" | "dark";
type PreviewFormat = "html" | "text";

function PreviewPane({
  html,
  text,
  subject,
  format,
}: {
  html: string;
  text: string;
  subject: string;
  /** Driven by the editor tab so the preview always mirrors what's edited. */
  format: PreviewFormat;
}) {
  const [device, setDevice] = useState<PreviewDevice>("desktop");
  const [theme, setTheme] = useState<PreviewTheme>("light");

  const srcDoc = useMemo(() => {
    const dark = theme === "dark";
    if (format === "text") {
      return `<!doctype html><html><body style="margin:0;padding:16px;font-family:ui-monospace,monospace;font-size:13px;white-space:pre-wrap;color:${
        dark ? "#e5e7eb" : "#111827"
      };background:${
        dark ? "#0b0b0f" : "#ffffff"
      }">${escapeHtmlValue(text || "(no plain-text content)")}</body></html>`;
    }
    const pageBg = dark ? "#0b0b0f" : "#f3f4f6";
    // A <meta color-scheme> can't drive `@media (prefers-color-scheme: dark)`
    // (that follows the OS), so rewrite the email's own dark-mode query to
    // force it on/off deterministically with the toggle. Emails without a
    // dark variant are unaffected either way.
    const darkQuery = /@media\s*\(\s*prefers-color-scheme:\s*dark\s*\)/gi;
    const themedHtml = (html || "").replace(
      darkQuery,
      dark
        ? "@media all"
        : "@media (prefers-color-scheme: dark) and (min-width:100000px)"
    );
    return `<!doctype html><html><head><meta name="color-scheme" content="${
      dark ? "dark" : "light"
    }"><style>html,body{margin:0}body{background:${pageBg};padding:16px}</style></head><body>${
      themedHtml ||
      "<p style='font-family:sans-serif;color:#9ca3af'>Nothing to preview yet.</p>"
    }</body></html>`;
  }, [html, text, theme, format]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Preview
        </span>
        <span className="rounded-none border border-input px-2 py-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
          {format === "text" ? "Plain text" : "HTML"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Segmented<PreviewDevice>
            value={device}
            onChange={setDevice}
            options={[
              {
                value: "desktop",
                icon: <Monitor className="h-3.5 w-3.5" />,
                title: "Desktop width",
              },
              {
                value: "mobile",
                icon: <Smartphone className="h-3.5 w-3.5" />,
                title: "Mobile width",
              },
            ]}
          />
          <Segmented<PreviewTheme>
            value={theme}
            onChange={setTheme}
            options={[
              {
                value: "light",
                icon: <Sun className="h-3.5 w-3.5" />,
                title: "Light client",
              },
              {
                value: "dark",
                icon: <Moon className="h-3.5 w-3.5" />,
                title: "Dark client",
              },
            ]}
          />
        </div>
      </div>

      <div className="shrink-0 border-b border-border px-3 py-2 text-xs">
        <span className="text-muted-foreground">Subject: </span>
        <span className="text-foreground">
          {subject || (
            <span className="italic text-muted-foreground">(no subject)</span>
          )}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 justify-center overflow-auto bg-muted/40 p-4">
        <iframe
          // Remount on format/theme change so the sandboxed srcDoc always
          // re-renders (some browsers don't reload srcDoc in place).
          key={`${format}-${theme}`}
          title="Email preview"
          sandbox=""
          srcDoc={srcDoc}
          className="h-full min-h-[420px] rounded-none border border-border bg-white"
          style={{ width: device === "mobile" ? 375 : 640, maxWidth: "100%" }}
        />
      </div>
    </div>
  );
}

// ============================================================
// Rail: Variables tab
// ============================================================

function VariableChip({
  name,
  onInsert,
}: {
  name: string;
  onInsert: (name: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onInsert(name)}
      title={`Insert {{${name}}}`}
      className="inline-flex items-center gap-1 rounded-none border border-border bg-muted px-2 py-1 font-mono text-xs text-foreground transition-colors hover:border-foreground/40 hover:bg-muted"
    >
      <Plus className="h-3 w-3 text-muted-foreground" />
      {`{{${name}}}`}
    </button>
  );
}

function VariablesRail({
  control,
  declared,
  onInsert,
}: {
  control: ReturnType<typeof useForm<TemplateFormValues>>["control"];
  declared: TemplateFormVariable[];
  onInsert: (name: string) => void;
}) {
  const { fields, append, remove } = useFieldArray({
    control,
    name: "variables",
  });
  const builtInNames = new Set(BUILT_IN_VARIABLES.map(v => v.name));
  const declaredNames = declared
    .map(v => v.name)
    .filter(n => n && !builtInNames.has(n));

  return (
    <div className="space-y-5">
      <div>
        <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Insert a variable
        </h4>
        <p className="mb-2 text-xs text-muted-foreground">
          Click to insert at the cursor. Built-in variables are always
          available.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {BUILT_IN_VARIABLES.map(v => (
            <VariableChip key={v.name} name={v.name} onInsert={onInsert} />
          ))}
          {declaredNames.map(n => (
            <VariableChip key={n} name={n} onInsert={onInsert} />
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Declared variables
          </h4>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() =>
              append({ name: "", description: "", required: false })
            }
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add
          </Button>
        </div>
        {fields.length > 0 ? (
          <div className="space-y-2">
            {fields.map((field, index) => (
              <div
                key={field.id}
                className="rounded-none border border-border bg-muted p-2.5"
              >
                <div className="flex items-start gap-2">
                  <div className="flex-1 space-y-1.5">
                    <FormField
                      control={control}
                      name={`variables.${index}.name`}
                      render={({ field: f }) => (
                        <FormItem className="space-y-1">
                          <FormControl>
                            <Input
                              placeholder="variableName"
                              className="h-8 font-mono text-sm"
                              {...f}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={control}
                      name={`variables.${index}.description`}
                      render={({ field: f }) => (
                        <FormItem className="space-y-1">
                          <FormControl>
                            <Input
                              placeholder="Description (optional)"
                              className="h-8 text-sm"
                              {...f}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => remove(index)}
                    aria-label="Remove variable"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <FormField
                  control={control}
                  name={`variables.${index}.required`}
                  render={({ field: f }) => (
                    <FormItem className="mt-2 flex items-center gap-1.5">
                      <FormControl>
                        <Switch
                          checked={f.value}
                          onCheckedChange={f.onChange}
                          className="scale-75"
                        />
                      </FormControl>
                      <FormLabel className="!mt-0 text-xs text-muted-foreground">
                        Required
                      </FormLabel>
                    </FormItem>
                  )}
                />
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-none border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
            No custom variables. Add one to document what this template expects.
          </p>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Rail: Data tab (sample data + variable check)
// ============================================================

function DataRail({
  sampleText,
  onSampleChange,
  onReset,
  sampleError,
  unknownVariables,
}: {
  sampleText: string;
  onSampleChange: (v: string) => void;
  onReset: () => void;
  sampleError: string | null;
  unknownVariables: string[];
}) {
  return (
    <div className="space-y-5">
      <div>
        <div className="mb-1 flex items-center justify-between">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Sample data
          </h4>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={onReset}
          >
            Reset
          </Button>
        </div>
        <p className="mb-2 text-xs text-muted-foreground">
          JSON that fills the live preview. Not saved with the template.
        </p>
        <Textarea
          value={sampleText}
          onChange={e => onSampleChange(e.target.value)}
          spellCheck={false}
          className="min-h-[220px] font-mono text-xs"
          aria-invalid={Boolean(sampleError)}
        />
        {sampleError ? (
          <p className="mt-1.5 text-xs text-destructive">
            Invalid JSON: {sampleError}
          </p>
        ) : null}
      </div>

      <div>
        <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Variable check
        </h4>
        {unknownVariables.length > 0 ? (
          <div className="rounded-none border border-warning/30 bg-warning/10 p-3">
            <p className="text-xs text-foreground">
              Used but not declared or sampled (renders blank):
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {unknownVariables.map(n => (
                <Badge key={n} variant="outline" className="font-mono text-xs">
                  {`{{${n}}}`}
                </Badge>
              ))}
            </div>
          </div>
        ) : (
          <p className="rounded-none border border-border bg-muted p-3 text-xs text-muted-foreground">
            All referenced variables are declared or sampled.
          </p>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Rail: Settings tab
// ============================================================

function AttachmentsField({
  control,
}: {
  control: ReturnType<typeof useForm<TemplateFormValues>>["control"];
}) {
  const { fields, append, remove } = useFieldArray({
    control,
    name: "attachments",
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const selectedIds = useMemo(
    () => new Set(fields.map(f => f.mediaId)),
    [fields]
  );

  const handlePick = useCallback(
    (media: Media[]) => {
      for (const m of media) {
        if (selectedIds.has(m.id)) continue;
        append({
          mediaId: m.id,
          displayName: m.originalFilename ?? m.filename ?? m.id,
          mimeType: m.mimeType,
        });
      }
      setPickerOpen(false);
    },
    [append, selectedIds]
  );

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Attachments
        </h4>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => setPickerOpen(true)}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add
        </Button>
      </div>
      {fields.length > 0 ? (
        <div className="space-y-2">
          {fields.map((field, index) => (
            <div
              key={field.id}
              className="flex items-center gap-2 rounded-none border border-border bg-muted p-2.5"
            >
              <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{field.displayName}</p>
                {field.mimeType ? (
                  <p className="text-xs text-muted-foreground">
                    {field.mimeType}
                  </p>
                ) : null}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => remove(index)}
                aria-label="Remove attachment"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-none border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
          No default attachments.
        </p>
      )}
      <MediaPickerDialog
        mode="multi"
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={handlePick}
        initialSelectedIds={selectedIds}
        title="Select default attachments"
      />
    </div>
  );
}

function SettingsRail({
  control,
  isEdit,
  isPending,
  isLayoutRow,
  providers,
  layouts,
}: {
  control: ReturnType<typeof useForm<TemplateFormValues>>["control"];
  isEdit: boolean;
  isPending: boolean;
  isLayoutRow: boolean;
  providers: { id: string; name: string; isDefault?: boolean }[];
  layouts: { id: string; name: string; slug: string }[];
}) {
  return (
    <div className="space-y-5">
      {isLayoutRow && (
        <p className="rounded-none border border-border-strong bg-muted px-3 py-2 text-xs text-muted-foreground">
          This is a layout. Place{" "}
          <code className="font-mono text-foreground">{"{{content}}"}</code>{" "}
          where each email body should be injected.
        </p>
      )}
      <FormField
        control={control}
        name="slug"
        render={({ field }) => (
          <FormItem className="space-y-1.5">
            <FormLabel className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Slug
            </FormLabel>
            <FormControl>
              <Input
                placeholder="welcome-email"
                disabled={isEdit || isPending}
                className="h-8 font-mono text-sm"
                {...field}
              />
            </FormControl>
            <p className="text-xs text-muted-foreground">
              {isEdit
                ? "Fixed after creation."
                : "Programmatic reference; auto-generated from the name."}
            </p>
            <FormMessage />
          </FormItem>
        )}
      />

      {!isLayoutRow && (
        <FormField
          control={control}
          name="preheader"
          render={({ field }) => (
            <FormItem className="space-y-1.5">
              <FormLabel className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Preheader
              </FormLabel>
              <FormControl>
                <Input
                  placeholder="Preview line shown after the subject"
                  className="h-8 text-sm"
                  disabled={isPending}
                  {...field}
                />
              </FormControl>
              <p className="text-xs text-muted-foreground">
                The inbox preview snippet. Supports {"{{variables}}"}.
              </p>
              <FormMessage />
            </FormItem>
          )}
        />
      )}

      {!isLayoutRow && (
        <FormField
          control={control}
          name="providerId"
          render={({ field }) => (
            <FormItem className="space-y-1.5">
              <FormLabel className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Provider
              </FormLabel>
              <Select
                value={field.value || USE_DEFAULT_PROVIDER}
                onValueChange={val =>
                  field.onChange(val === USE_DEFAULT_PROVIDER ? "" : val)
                }
                disabled={isPending}
              >
                <FormControl>
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="Use default provider" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value={USE_DEFAULT_PROVIDER}>
                    Use default provider
                  </SelectItem>
                  {providers.map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                      {p.isDefault ? " (Default)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Override the default sending provider for this template.
              </p>
            </FormItem>
          )}
        />
      )}

      {!isLayoutRow && (
        <FormField
          control={control}
          name="fromOverride"
          render={({ field }) => (
            <FormItem className="space-y-1.5">
              <FormLabel className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                From override
              </FormLabel>
              <FormControl>
                <Input
                  placeholder="Support &lt;help@example.com&gt;"
                  className="h-8 text-sm"
                  disabled={isPending}
                  {...field}
                />
              </FormControl>
              <p className="text-xs text-muted-foreground">
                Leave blank to use the provider&apos;s From address.
              </p>
              <FormMessage />
            </FormItem>
          )}
        />
      )}

      {!isLayoutRow && (
        <FormField
          control={control}
          name="replyTo"
          render={({ field }) => (
            <FormItem className="space-y-1.5">
              <FormLabel className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Reply-To
              </FormLabel>
              <FormControl>
                <Input
                  placeholder="replies@example.com"
                  className="h-8 text-sm"
                  disabled={isPending}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      )}

      {!isLayoutRow && (
        <FormField
          control={control}
          name="useLayout"
          render={({ field }) => (
            <FormItem className="flex items-start justify-between gap-3">
              <div className="space-y-0.5">
                <FormLabel className="text-sm text-foreground">
                  Use layout
                </FormLabel>
                <p className="text-xs text-muted-foreground">
                  Wrap the body in a layout at its {"{{content}}"}.
                </p>
              </div>
              <FormControl>
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  disabled={isPending}
                />
              </FormControl>
            </FormItem>
          )}
        />
      )}

      {!isLayoutRow && layouts.length > 0 && (
        <FormField
          control={control}
          name="layoutId"
          render={({ field }) => (
            <FormItem className="space-y-1.5">
              <FormLabel className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Layout
              </FormLabel>
              <Select
                value={field.value || USE_DEFAULT_LAYOUT}
                onValueChange={val =>
                  field.onChange(val === USE_DEFAULT_LAYOUT ? "" : val)
                }
                disabled={isPending}
              >
                <FormControl>
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="Default layout" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value={USE_DEFAULT_LAYOUT}>
                    Default layout
                  </SelectItem>
                  {layouts.map(l => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Which layout wraps this template.
              </p>
            </FormItem>
          )}
        />
      )}

      {!isLayoutRow && (
        <FormField
          control={control}
          name="isActive"
          render={({ field }) => (
            <FormItem className="flex items-start justify-between gap-3">
              <div className="space-y-0.5">
                <FormLabel className="text-sm text-foreground">
                  Active
                </FormLabel>
                <p className="text-xs text-muted-foreground">
                  Inactive templates cannot be used to send.
                </p>
              </div>
              <FormControl>
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  disabled={isPending}
                />
              </FormControl>
            </FormItem>
          )}
        />
      )}

      {!isLayoutRow && <AttachmentsField control={control} />}
    </div>
  );
}

// ============================================================
// Send-test dialog
// ============================================================

function SendTestDialog({
  open,
  onOpenChange,
  templateName,
  slug,
  sampleData,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateName: string;
  slug: string;
  sampleData: Record<string, unknown>;
}) {
  const [email, setEmail] = useState("");
  const { mutate: doSend, isPending } = useSendTestEmailTemplate();

  useEffect(() => {
    if (open) setEmail("");
  }, [open]);

  const handleSubmit = () => {
    const to = email.trim();
    if (!to) return;
    doSend(
      { slug, to, variables: sampleData },
      {
        onSuccess: res => {
          if (res.success) {
            toast.success("Test email sent", {
              description: `Check ${to} for the test email.`,
            });
            onOpenChange(false);
          } else {
            toast.error("Test failed", {
              description:
                "The provider returned unsuccessful. Check your provider configuration.",
            });
          }
        },
        onError: err => {
          toast.error("Test failed", {
            description:
              err instanceof Error
                ? err.message
                : "Failed to send the test email.",
          });
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send test email</DialogTitle>
          <DialogDescription>
            Send <strong>{templateName || "this template"}</strong> to an
            address using the current sample data. This sends the saved
            template, not unsaved edits.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="send-test-email" className="text-sm font-medium">
              Recipient email
            </label>
            <Input
              id="send-test-email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              autoFocus
              required
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={isPending || !email.trim()}
            >
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sending…
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  Send test
                </>
              )}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

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
  const insertVariable = useCallback(
    (name: string) => {
      const token = `{{${name}}}`;
      const current = form.getValues("htmlContent") ?? "";
      const ta = editorWrapRef.current?.querySelector("textarea");
      if (!ta) {
        form.setValue("htmlContent", current + token, {
          shouldDirty: true,
          shouldValidate: true,
        });
        return;
      }
      const start = ta.selectionStart ?? current.length;
      const end = ta.selectionEnd ?? current.length;
      const next = current.slice(0, start) + token + current.slice(end);
      form.setValue("htmlContent", next, {
        shouldDirty: true,
        shouldValidate: true,
      });
      requestAnimationFrame(() => {
        ta.focus();
        const pos = start + token.length;
        ta.setSelectionRange(pos, pos);
      });
    },
    [form]
  );

  // Sample data derived from declared variables unless overridden.
  const suggestedSample = useMemo(
    () => buildSampleData(variables ?? []),
    [variables]
  );
  const sampleText = sampleOverride ?? JSON.stringify(suggestedSample, null, 2);
  const { sampleData, sampleError } = useMemo<{
    sampleData: Record<string, unknown>;
    sampleError: string | null;
  }>(() => {
    try {
      const parsed: Record<string, unknown> = JSON.parse(sampleText);
      return { sampleData: parsed, sampleError: null };
    } catch (e) {
      return {
        sampleData: {},
        sampleError:
          e instanceof Error ? e.message : "Invalid JSON in sample data.",
      };
    }
  }, [sampleText]);

  const knownNames = useMemo(() => {
    const set = new Set<string>(BUILT_IN_VARIABLES.map(v => v.name));
    for (const v of variables ?? []) if (v.name) set.add(v.name);
    for (const k of Object.keys(sampleData)) set.add(k);
    return set;
  }, [variables, sampleData]);

  const unknownVariables = useMemo(() => {
    const referenced = new Set<string>([
      ...collectVariableNames(subject ?? ""),
      ...collectVariableNames(htmlContent ?? ""),
    ]);
    return [...referenced].filter(n => !knownNames.has(n.split(".")[0]));
  }, [subject, htmlContent, knownNames]);

  const previewHtml = useMemo(() => {
    // A layout row previews its own wrapper with a stand-in body at the
    // {{content}} placeholder so authors can see where content lands.
    if (isLayoutRow) {
      const [before, after] = (htmlContent ?? "").split("{{content}}");
      const head = interpolate(before ?? "", sampleData, false);
      const tail = interpolate(after ?? "", sampleData, false);
      const sampleBody =
        '<p style="color:#71717a;font-style:italic;">Your email content appears here.</p>';
      return `${head}${sampleBody}${tail}`;
    }

    const body = interpolate(htmlContent ?? "", sampleData, true);
    if (!useLayout || !activeLayout) return body;
    const [before, after] = activeLayout.htmlContent.split("{{content}}");
    const head = interpolate(before ?? "", sampleData, false);
    const tail = interpolate(after ?? "", sampleData, false);
    return `${head}${body}${tail}`;
  }, [htmlContent, sampleData, useLayout, activeLayout, isLayoutRow]);

  const previewText = useMemo(
    () => interpolate(plainTextContent ?? "", sampleData, false),
    [plainTextContent, sampleData]
  );
  const previewSubject = useMemo(
    () => interpolate(subject ?? "", sampleData, false),
    [subject, sampleData]
  );

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
      <style>{PRISM_THEME_CSS}</style>
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
            className="flex h-8 w-8 items-center justify-center rounded-none border border-input text-muted-foreground transition-colors hover:text-foreground"
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
                  className="w-full max-w-md truncate bg-transparent text-lg font-semibold text-foreground outline-none placeholder:text-muted-foreground/60"
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
        <div
          className={cn(
            "grid min-h-0 flex-1 grid-cols-1 overflow-y-auto xl:overflow-hidden",
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
                className="flex h-7 w-7 items-center justify-center rounded-none text-muted-foreground transition-colors hover:text-foreground"
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
                          className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
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
                  className="flex h-7 w-7 items-center justify-center rounded-none border border-input text-muted-foreground transition-colors hover:text-foreground"
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
                    <Editor
                      value={field.value ?? ""}
                      onValueChange={val => {
                        if (!isPending) field.onChange(val);
                      }}
                      highlight={highlightHtml}
                      padding={14}
                      tabSize={2}
                      insertSpaces
                      textareaClassName="outline-none"
                      placeholder={
                        "<h1>Hello {{userName}}</h1>\n<p>Welcome to {{appName}}.</p>"
                      }
                      className="min-h-full font-mono text-sm leading-relaxed text-foreground caret-foreground [&_textarea]:outline-none! [&_textarea]:ring-0! [&_textarea]:placeholder:text-muted-foreground [&_textarea]:placeholder:opacity-50"
                    />
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
                      className="h-full min-h-[380px] w-full resize-none bg-background p-3.5 font-mono text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/50 xl:min-h-full"
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
