"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Badge,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@revnixhq/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useFieldArray,
  useForm,
  type Resolver,
  type SubmitHandler,
} from "react-hook-form";
import { z } from "zod";

import { MediaPickerDialog } from "@admin/components/features/media-library/MediaPickerDialog";
import {
  FileText,
  Loader2,
  Paperclip,
  Plus,
  Trash2,
} from "@admin/components/icons";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@admin/components/ui/form";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";
import { useEmailProviders } from "@admin/hooks/queries/useEmailProviders";
import { generateSlug } from "@admin/lib/fields";
import type {
  CreateEmailTemplatePayload,
  EmailTemplateRecord,
  UpdateEmailTemplatePayload,
} from "@admin/services/emailTemplateApi";
import type { Media } from "@admin/types/media";


// ============================================================
// Form Values Type
// ============================================================

export interface TemplateFormVariable {
  name: string;
  description: string;
  required: boolean;
}

/**
 * UI-side attachment row. `displayName` is rendered in the picker card
 * and defaults to the media's `originalFilename`. `filename` (optional)
 * is the name the recipient sees on the email — when omitted the server
 * falls back to the media's original filename.
 */
export interface TemplateFormAttachment {
  mediaId: string;
  filename?: string;
  /** Display label shown in the attachments list UI. */
  displayName: string;
  /** Optional MIME type, used for the icon badge. */
  mimeType?: string;
}

export interface TemplateFormValues {
  name: string;
  slug: string;
  subject: string;
  htmlContent: string;
  plainTextContent: string;
  useLayout: boolean;
  isActive: boolean;
  providerId: string; // empty string = "Use Default"
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
  htmlContent: z.string().min(1, "HTML content is required"),
  plainTextContent: z.string().optional().or(z.literal("")),
  useLayout: z.boolean(),
  isActive: z.boolean(),
  providerId: z.string().optional().or(z.literal("")),
  variables: z.array(templateVariableSchema),
  attachments: z.array(templateAttachmentSchema),
});

// ============================================================
// Form Defaults
// ============================================================

const DEFAULT_VALUES: TemplateFormValues = {
  name: "",
  slug: "",
  subject: "",
  htmlContent: "",
  plainTextContent: "",
  useLayout: true,
  isActive: true,
  providerId: "",
  variables: [],
  attachments: [],
};

// Sentinel value for "Use Default Provider" in Radix Select (which doesn't accept empty strings)
const USE_DEFAULT_PROVIDER = "__default__";

// ============================================================
// Common Template Variables
// ============================================================

const COMMON_VARIABLES = [
  { name: "name", description: "Recipient's display name" },
  { name: "email", description: "Recipient's email address" },
  {
    name: "url",
    description: "Action URL (e.g., reset link, verification link)",
  },
  { name: "token", description: "Security token for the action" },
  { name: "siteName", description: "Name of the site/application" },
  { name: "siteUrl", description: "Base URL of the site" },
];

// ============================================================
// Helpers
// ============================================================

/**
 * Transform flat form values into the create API payload shape.
 */
export function formValuesToCreatePayload(
  values: TemplateFormValues
): CreateEmailTemplatePayload {
  return {
    name: values.name,
    slug: values.slug,
    subject: values.subject,
    htmlContent: values.htmlContent,
    plainTextContent: values.plainTextContent || null,
    useLayout: values.useLayout,
    isActive: values.isActive,
    providerId: values.providerId || null,
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

/**
 * Transform flat form values into the update API payload shape.
 */
export function formValuesToUpdatePayload(
  values: TemplateFormValues
): UpdateEmailTemplatePayload {
  return {
    name: values.name,
    subject: values.subject,
    htmlContent: values.htmlContent,
    plainTextContent: values.plainTextContent || null,
    useLayout: values.useLayout,
    isActive: values.isActive,
    providerId: values.providerId || null,
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

/**
 * Transform an API template record into flat form values for editing.
 */
export function templateToFormValues(
  template: EmailTemplateRecord
): TemplateFormValues {
  return {
    name: template.name,
    slug: template.slug,
    subject: template.subject,
    htmlContent: template.htmlContent,
    plainTextContent: template.plainTextContent ?? "",
    useLayout: template.useLayout,
    isActive: template.isActive,
    providerId: template.providerId ?? "",
    variables: (template.variables ?? []).map(v => ({
      name: v.name,
      description: v.description,
      required: v.required ?? false,
    })),
    attachments: (template.attachments ?? []).map(a => ({
      mediaId: a.mediaId,
      filename: a.filename,
      // Fallback display name — if the media record isn't available
      // (edit page loads the template before the media picker fetches),
      // show the override filename or the mediaId itself. The picker
      // replaces this with the real name on next open.
      displayName: a.filename ?? a.mediaId,
    })),
  };
}

// ============================================================
// Custom Variables Editor
// ============================================================

function VariableEditor({
  control,
}: {
  control: ReturnType<typeof useForm<TemplateFormValues>>["control"];
}) {
  const { fields, append, remove } = useFieldArray({
    control,
    name: "variables",
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-medium text-foreground">
            Custom Variables
          </h4>
          <p className="text-xs text-muted-foreground">
            Define custom variables for this template. Use them in content and
            subject with {"{{variableName}}"} syntax.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => append({ name: "", description: "", required: false })}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add Variable
        </Button>
      </div>

      {fields.length > 0 ? (
        <div className="space-y-2">
          {fields.map((field, index) => (
            <div
              key={field.id}
              className="flex items-start gap-2 rounded-none  border border-primary/5 bg-primary/5 p-3"
            >
              <div className="grid flex-1 gap-2 sm:grid-cols-[1fr_1.5fr]">
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
                          placeholder="Description"
                          className="h-8 text-sm"
                          {...f}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={control}
                name={`variables.${index}.required`}
                render={({ field: f }) => (
                  <FormItem className="flex items-center gap-1.5 pt-1">
                    <FormControl>
                      <Switch
                        checked={f.value}
                        onCheckedChange={f.onChange}
                        className="scale-75"
                      />
                    </FormControl>
                    <FormLabel className="text-xs text-muted-foreground !mt-0">
                      Required
                    </FormLabel>
                  </FormItem>
                )}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => remove(index)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-none  border border-primary/5 border-dashed border-primary/5 p-4 text-center text-xs text-muted-foreground">
          No custom variables defined. Click &quot;Add Variable&quot; to create
          one.
        </div>
      )}
    </div>
  );
}

// ============================================================
// Default Attachments Section
// ============================================================

/**
 * Media-library picker for a template's default attachments.
 * Attachments selected here are merged with per-send attachments at
 * send time — caller entries win on mediaId conflict.
 */
function DefaultAttachmentsSection({
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
      // Dedupe against already-selected items so re-opening the picker
      // and re-confirming doesn't duplicate existing attachments.
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
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-medium text-foreground">
            Default Attachments
          </h4>
          <p className="text-xs text-muted-foreground">
            Files attached to every send of this template. Per-send
            attachments are merged with these (same file replaces the
            default).
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setPickerOpen(true)}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add Attachment
        </Button>
      </div>

      {fields.length > 0 ? (
        <div className="space-y-2">
          {fields.map((field, index) => (
            <div
              key={field.id}
              className="flex items-center gap-3 rounded-none  border border-primary/5 bg-primary/5 p-3"
            >
              <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-medium">
                  {field.displayName}
                </p>
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
        <div className="rounded-none  border border-primary/5 border-dashed border-primary/5 p-4 text-center text-xs text-muted-foreground">
          No default attachments. Click &quot;Add Attachment&quot; to pick
          from the media library.
        </div>
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

// ============================================================
// Built-in Variables Reference
// ============================================================

function BuiltInVariablesReference() {
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-foreground">
        Built-in Variables
      </h4>
      <p className="text-xs text-muted-foreground">
        These variables are always available in every template.
      </p>
      <div className="rounded-none  border border-primary/5 bg-primary/5 p-3">
        <div className="space-y-2">
          {COMMON_VARIABLES.map(v => (
            <div key={v.name} className="flex items-start gap-2">
              <Badge variant="outline" className="font-mono text-xs shrink-0">
                {`{{${v.name}}}`}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {v.description}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// EmailTemplateForm Component
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

  const form = useForm<TemplateFormValues>({
    resolver: zodResolver(
      templateSchema
    ) as unknown as Resolver<TemplateFormValues>,
    defaultValues:
      initialValues ??
      (template ? templateToFormValues(template) : DEFAULT_VALUES),
  });

  // Fetch providers for the dropdown
  const { data: providersData } = useEmailProviders(
    { page: 0, pageSize: 100, search: "" },
    { staleTime: 60_000 }
  );
  const providers = providersData?.data ?? [];

  // Populate form when template data loads in edit mode or when initialValues change
  useEffect(() => {
    if (initialValues) {
      form.reset(initialValues);
      // Reset slug touched state for duplicates so slug auto-generates
      slugTouchedRef.current = false;
    } else if (template && isEdit) {
      form.reset(templateToFormValues(template));
    }
  }, [initialValues, template, isEdit, form]);

  // Auto-generate slug from name (only in create mode, when slug hasn't been manually edited)
  const handleNameChange = useCallback(
    (value: string, onChange: (v: string) => void) => {
      onChange(value);
      if (!isEdit && !slugTouchedRef.current) {
        form.setValue("slug", generateSlug(value), { shouldValidate: true });
      }
    },
    [isEdit, form]
  );

  return (
    <div className="space-y-6">
      {/* Form */}
      <Form {...form}>
        <form onSubmit={(e) => { void form.handleSubmit(onSubmit)(e); }} className="space-y-6">
          <div className="bg-card  border border-primary/5 rounded-none overflow-hidden">
            {/* Page Header - Inside Card */}
            <div className="flex items-center gap-3  border-b border-primary/5 bg-primary/5 px-6 py-5">
              <div
                className="shrink-0 flex items-center justify-center w-9 h-9 bg-primary/5 text-primary"
              >
                <FileText className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-xl font-semibold">
                  {isEdit ? "Edit Email Template" : "Create Email Template"}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {isEdit
                    ? "Update the email template content and settings"
                    : "Create a new email template for your application"}
                </p>
              </div>
            </div>

            <Tabs defaultValue="content">
              <div className="border-b border-primary/5 px-6 pt-4">
                <TabsList>
                  <TabsTrigger value="content">Content</TabsTrigger>
                  <TabsTrigger value="settings">Settings</TabsTrigger>
                </TabsList>
              </div>

              {/* Content Tab */}
              <TabsContent value="content" className="mt-0 p-6 space-y-6">
                {/* Template Name */}
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Template Name</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g. Welcome Email"
                          {...field}
                          onChange={e =>
                            handleNameChange(e.target.value, field.onChange)
                          }
                        />
                      </FormControl>
                      <FormDescription>
                        A descriptive name for this email template
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Email Subject */}
                <FormField
                  control={form.control}
                  name="subject"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email Subject</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g. Welcome to our platform!"
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        {"Supports variables like {{name}} for personalization"}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* HTML Content */}
                <FormField
                  control={form.control}
                  name="htmlContent"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>HTML Content</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="<html>&#10;  <body>&#10;    <h1>Hello {{name}}</h1>&#10;  </body>&#10;</html>"
                          className="min-h-[300px] font-mono text-sm"
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        {
                          "Use variables like {{name}} that will be replaced with actual values when the email is sent."
                        }
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Plain Text Content */}
                <FormField
                  control={form.control}
                  name="plainTextContent"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Plain Text Content{" "}
                        <span className="text-muted-foreground font-normal">
                          (Optional)
                        </span>
                      </FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Plain text fallback for email clients that don't support HTML..."
                          className="min-h-[150px]"
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        Fallback content for email clients that don&apos;t
                        support HTML
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </TabsContent>

              {/* Settings Tab */}
              <TabsContent value="settings" className="mt-0 p-6 space-y-6">
                {/* Template Slug */}
                <FormField
                  control={form.control}
                  name="slug"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Template Slug</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g. welcome-email"
                          {...field}
                          onChange={e => {
                            field.onChange(e.target.value);
                            slugTouchedRef.current = true;
                          }}
                          disabled={isEdit}
                          className="placeholder:text-muted-foreground/50"
                        />
                      </FormControl>
                      <FormDescription>
                        {isEdit
                          ? "Slug cannot be changed after creation"
                          : "Auto-generated from name. Used for programmatic reference."}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Email Provider */}
                <FormField
                  control={form.control}
                  name="providerId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email Provider</FormLabel>
                      <Select
                        value={field.value || USE_DEFAULT_PROVIDER}
                        onValueChange={val =>
                          field.onChange(
                            val === USE_DEFAULT_PROVIDER ? "" : val
                          )
                        }
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Use Default Provider" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value={USE_DEFAULT_PROVIDER}>
                            Use Default Provider
                          </SelectItem>
                          {providers.map(p => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name}
                              {p.isDefault ? " (Default)" : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        Override the default provider for this template, or
                        leave as default
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Use Layout */}
                <FormField
                  control={form.control}
                  name="useLayout"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-none  border border-primary/5 p-4">
                      <div className="space-y-0.5">
                        <FormLabel>Use Layout (Header/Footer)</FormLabel>
                        <FormDescription>
                          Wrap this template with the shared email header and
                          footer. Turn off for templates that need a custom
                          layout.
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                {/* Active */}
                <FormField
                  control={form.control}
                  name="isActive"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-none  border border-primary/5 p-4">
                      <div className="space-y-0.5">
                        <FormLabel>Active</FormLabel>
                        <FormDescription>
                          Only active templates can be used for sending emails
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                {/* Default Attachments */}
                <DefaultAttachmentsSection control={form.control} />

                {/* Custom Variables Editor */}
                <VariableEditor control={form.control} />

                {/* Built-in Variables Reference */}
                <BuiltInVariablesReference />
              </TabsContent>
            </Tabs>
          </div>

          {/* Form Actions */}
          <div className="flex justify-end gap-3">
            <Link href={ROUTES.SETTINGS_EMAIL_TEMPLATES}>
              <Button type="button" variant="outline" disabled={isPending}>
                Cancel
              </Button>
            </Link>
            <Button type="submit" disabled={isPending}>
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {isEdit ? "Updating..." : "Creating..."}
                </>
              ) : isEdit ? (
                "Update Template"
              ) : (
                "Create Template"
              )}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
