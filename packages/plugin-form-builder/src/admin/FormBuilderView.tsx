"use client";

/**
 * Form Builder View
 *
 * Custom admin view that provides a visual drag-and-drop form builder.
 * Layout mirrors the Collection Builder for visual consistency.
 *
 * @module admin/FormBuilderView
 * @since 0.1.0
 */

"use client";

import {
  Button,
  Input,
  toast,
  Tabs,
  TabsList,
  TabsTrigger,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@nextlyhq/ui";
import { useQueryClient } from "@tanstack/react-query";
import type { FormFieldCatalogType } from "nextly/field-catalog";
import { FORM_FIELD_TYPE_CATALOG } from "nextly/field-catalog";
import { useCallback, useEffect, useRef, useState } from "react";

import type { FormField } from "../types";

import { FieldCards } from "./components/builder/FieldCards";
import {
  FormNotificationsTab,
  type NotificationDefaults,
} from "./components/builder/FormNotificationsTab";
import { FormPreview } from "./components/builder/FormPreview";
import { FormSettingsTab } from "./components/builder/FormSettingsTab";
import {
  FormBuilderProvider,
  useFormBuilder,
  createFieldFromType,
  createNotification,
  type FormNotification,
} from "./context/FormBuilderContext";

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
    fields?: unknown[];
    settings?: Record<string, unknown>;
    notifications?: unknown[];
  };
  onSave?: (data: unknown) => void;
  onSuccess?: (entry?: Record<string, unknown>) => void;
  onCancel?: () => void;
}

// ============================================================================
// Helper
// ============================================================================

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ============================================================================
// Inner Component (uses context)
// ============================================================================

function FormBuilderViewInner({
  isCreating = false,
  collectionSlug = "forms",
  entryId,
  onSave,
  onSuccess,
  onCancel,
}: Pick<
  FormBuilderViewProps,
  | "isCreating"
  | "collectionSlug"
  | "entryId"
  | "onSave"
  | "onSuccess"
  | "onCancel"
>) {
  const {
    fields,
    activeTab,
    isDirty,
    formData,
    settings,
    notifications,
    setActiveTab,
    addField,
    selectField,
    seedNotifications,
    updateFormData,
    markAsSaved,
  } = useFormBuilder();

  const queryClient = useQueryClient();

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // The host's resolved field enable/disable map. `null` until the config
  // request settles, so the Add dialog never flashes the unfiltered set. If
  // the request errors, every type is offered: the exclude list is an
  // authoring preference (the server accepts any field type in the form's
  // JSON regardless), so hiding all types on a transient failure would cost
  // more than a temporarily unfiltered picker.
  const [enabledTypes, setEnabledTypes] = useState<
    FormFieldCatalogType[] | null
  >(null);

  // The host's notification defaults (plugin options). `null` until the
  // config request settles; `{}` when the request failed or nothing is
  // configured, so consumers can distinguish "loading" from "no defaults".
  const [notificationDefaults, setNotificationDefaults] =
    useState<NotificationDefaults | null>(null);

  useEffect(() => {
    let cancelled = false;
    const allTypes = FORM_FIELD_TYPE_CATALOG.map(entry => entry.type);
    void fetch(
      "/admin/api/plugins/@nextlyhq/plugin-form-builder/builder-config",
      { credentials: "include" }
    )
      .then(response => (response.ok ? response.json() : null))
      .then(
        (
          config: {
            fields?: Record<string, boolean>;
            notifications?: NotificationDefaults;
          } | null
        ) => {
          if (cancelled) return;
          setEnabledTypes(
            config?.fields
              ? allTypes.filter(type => config.fields?.[type] !== false)
              : allTypes
          );
          setNotificationDefaults(config?.notifications ?? {});
        }
      )
      .catch(() => {
        if (cancelled) return;
        setEnabledTypes(allTypes);
        setNotificationDefaults({});
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Seed a new form with the default admin-notification rule once the host
  // defaults are known. Guarded by a ref so deleting the seeded rule is
  // final — the effect must never re-seed a list the user emptied.
  const seededRef = useRef(false);
  useEffect(() => {
    if (!isCreating || notificationDefaults === null || seededRef.current) {
      return;
    }
    seededRef.current = true;
    seedNotifications([
      {
        ...createNotification(),
        name: "Admin notification",
        to: notificationDefaults.defaultToEmail ?? "",
      },
    ]);
  }, [isCreating, notificationDefaults, seedNotifications]);

  const handleAddField = useCallback(
    (type: FormFieldCatalogType) => {
      const newField = createFieldFromType(
        type,
        fields.map(f => f.name)
      );
      addField(newField);
      selectField(newField.name);
    },
    [fields, addField, selectField]
  );

  // ── Save / Cancel ─────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    // Check if there are fields
    if (fields.length === 0) {
      toast.error("Please add at least one field to the form");
      return;
    }

    const { id: _id, ...formDataWithoutId } = formData;
    const saveData = {
      ...formDataWithoutId,
      fields,
      settings,
      notifications,
    };

    if (onSave) {
      onSave(saveData);
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    try {
      const url = isCreating
        ? `/admin/api/collections/${collectionSlug}/entries`
        : `/admin/api/collections/${collectionSlug}/entries/${entryId}`;
      const response = await fetch(url, {
        method: isCreating ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(saveData),
      });
      if (!response.ok) {
        const err = (await response.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        throw new Error(
          err.error?.message ?? `Failed to save form: ${response.statusText}`
        );
      }

      const result = (await response.json()) as {
        message?: string;
        item?: Record<string, unknown>;
      } & Record<string, unknown>;
      const savedEntry: Record<string, unknown> = result.item ?? result;
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
      toast.success(
        isCreating ? "Form created successfully" : "Form updated successfully"
      );
      if (onSuccess) onSuccess(savedEntry);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to save form";
      setSaveError(message);
      toast.error(message);
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
  ]);

  const handleCancel = useCallback(() => {
    if (onCancel) onCancel();
    else if (typeof window !== "undefined") window.history.back();
  }, [onCancel]);

  const handleNameChange = useCallback(
    (name: string) => {
      updateFormData({ name });
      if (!formData.slug || formData.slug === slugify(formData.name)) {
        updateFormData({ slug: slugify(name) });
      }
    },
    [formData.name, formData.slug, updateFormData]
  );

  // Main tabs
  const mainTabs = [
    {
      value: "builder" as const,
      label: "Builder",
      count: fields.length > 0 ? fields.length : null,
    },
    {
      value: "preview" as const,
      label: "Preview",
      count: null,
    },
    { value: "settings" as const, label: "Settings", count: null },
    {
      value: "notifications" as const,
      label: "Notifications",
      count: notifications.length > 0 ? notifications.length : null,
    },
  ];

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Page header (Outside the white card) ── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6 px-1">
        <div>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">
            {isCreating ? "Create Form" : "Edit Form"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isCreating
              ? "Design a new form with drag-and-drop fields."
              : "Modify your form fields and settings."}
          </p>
        </div>

        {/* Action buttons — same variant/size as Collection Builder */}
        <div className="flex items-center gap-2 shrink-0">
          {isDirty && (
            <span className="text-xs font-medium text-warning bg-warning/10 border border-warning/20 px-2.5 py-1 rounded-none whitespace-nowrap">
              Unsaved changes
            </span>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCancel}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              void handleSave();
            }}
            disabled={isSaving}
            className="flex items-center gap-1.5"
          >
            {isSaving ? (
              <>
                <svg
                  className="animate-spin h-3.5 w-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                Saving…
              </>
            ) : isCreating ? (
              "Create"
            ) : (
              "Save Changes"
            )}
          </Button>
        </div>
      </div>

      {/*
        Outer shell — white card with rounded-none border (no shadow).
        Fills available height in the admin page container.
      */}
      <div className="flex border border-border bg-background overflow-hidden">
        {/* =================================================================
            LEFT — scrollable main content
        ================================================================= */}
        <div className="flex-1 min-w-0">
          <div className="w-full px-8 pt-8 pb-12 space-y-6">
            {/* ── Fixed Metadata & Tab Navigation ── */}
            {/* -mx-8 + px-8: full-width divider, inset content. */}
            <div className="bg-background -mx-8 px-8 border-b border-border space-y-4">
              <div className="flex flex-wrap gap-4">
                {/* Form Name */}
                <div className="flex-1 min-w-[200px] max-w-sm space-y-1.5">
                  <label
                    htmlFor="form-name"
                    className="text-sm font-medium text-foreground"
                  >
                    Form Name
                  </label>
                  <Input
                    id="form-name"
                    type="text"
                    value={formData.name || ""}
                    onChange={e => handleNameChange(e.target.value)}
                    placeholder="e.g., Contact Form"
                    className="bg-transparent"
                  />
                </div>

                {/* Slug */}
                <div className="flex-1 min-w-[160px] max-w-xs space-y-1.5">
                  <label
                    htmlFor="form-slug"
                    className="text-sm font-medium text-foreground"
                  >
                    Slug
                  </label>
                  <Input
                    id="form-slug"
                    type="text"
                    value={formData.slug || ""}
                    onChange={e => updateFormData({ slug: e.target.value })}
                    placeholder="e.g., contact-form"
                    className="bg-transparent placeholder:text-muted-foreground/50"
                  />
                </div>

                {/* Status */}
                <div className="w-36 space-y-1.5">
                  <label
                    htmlFor="form-status"
                    className="text-sm font-medium text-foreground"
                  >
                    Status
                  </label>
                  <Select
                    value={formData.status || "draft"}
                    onValueChange={value =>
                      updateFormData({
                        status: value as "draft" | "published" | "closed",
                      })
                    }
                  >
                    <SelectTrigger id="form-status" className="bg-transparent">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Draft</SelectItem>
                      <SelectItem value="published">Published</SelectItem>
                      <SelectItem value="closed">Closed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* ── Main tab navigation ── */}
              <Tabs
                value={activeTab}
                onValueChange={v => setActiveTab(v as typeof activeTab)}
              >
                <TabsList className="bg-transparent justify-start gap-0 -mb-px border-b-0 max-w-full overflow-x-auto">
                  {mainTabs.map(tab => (
                    <TabsTrigger
                      key={tab.value}
                      value={tab.value}
                      style={{
                        borderBottomColor:
                          activeTab === tab.value
                            ? "var(--nx-primary)"
                            : "transparent",
                      }}
                      className="shrink-0 whitespace-nowrap border-b-2 relative -mb-0.5 data-[state=active]:text-primary data-[state=inactive]:text-muted-foreground hover:text-primary hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                    >
                      {tab.label}
                      {tab.count !== null && (
                        <span
                          className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-semibold rounded-none ml-2 transition-colors ${
                            activeTab === tab.value
                              ? "bg-primary/5 text-primary"
                              : "bg-primary/5 text-muted-foreground"
                          }`}
                        >
                          {tab.count}
                        </span>
                      )}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>

            {/* ── Tab content ── */}

            {/* Builder tab */}
            {activeTab === "builder" && (
              <FieldCards
                enabledTypes={enabledTypes}
                onAddField={handleAddField}
              />
            )}

            {/* Preview tab */}
            {activeTab === "preview" && (
              <FormPreview fields={fields} formData={formData} />
            )}

            {/* Settings tab */}
            {activeTab === "settings" && (
              <div className="w-full">
                <FormSettingsTab />
              </div>
            )}

            {/* Notifications tab */}
            {activeTab === "notifications" && (
              <div className="w-full">
                <FormNotificationsTab defaults={notificationDefaults} />
              </div>
            )}

            {/* Save error */}
            {saveError && (
              <div className="p-3 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-none">
                {saveError}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ============================================================================
// Main Component (provides context)
// ============================================================================

export function FormBuilderView({
  id,
  entryId,
  collection,
  collectionSlug,
  isCreating,
  initialData,
  onSave,
  onSuccess,
  onCancel,
}: FormBuilderViewProps) {
  const resolvedEntryId = entryId || id || initialData?.id;
  const resolvedCollectionSlug = collectionSlug || collection || "forms";
  const resolvedIsCreating = isCreating ?? !resolvedEntryId;
  const providerKey = resolvedEntryId || "new";

  return (
    <FormBuilderProvider
      key={providerKey}
      initialData={{
        id: resolvedEntryId,
        name: initialData?.name,
        slug: initialData?.slug,
        description: initialData?.description,
        status: initialData?.status,
        fields: initialData?.fields as FormField[],
        settings: initialData?.settings as Record<string, unknown>,
        notifications: initialData?.notifications as FormNotification[],
      }}
    >
      <FormBuilderViewInner
        isCreating={resolvedIsCreating}
        collectionSlug={resolvedCollectionSlug}
        entryId={resolvedEntryId}
        onSave={onSave}
        onSuccess={onSuccess}
        onCancel={onCancel}
      />
    </FormBuilderProvider>
  );
}

export default FormBuilderView;
