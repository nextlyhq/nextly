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
  Card,
  FieldShell,
  FormActions,
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

import type { FormField, FormFieldTypeId } from "../types";

import { FieldCards } from "./components/builder/FieldCards";
import {
  FormNotificationsTab,
  type NotificationDefaults,
} from "./components/builder/FormNotificationsTab";
import { FormPreview } from "./components/builder/FormPreview";
import {
  FormSettingsTab,
  type SpamDefaults,
} from "./components/builder/FormSettingsTab";
import { notificationsBlockingSave } from "./components/builder/notification-addresses";
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

  // Type ids the host explicitly disabled (`config.fields[type] === false`),
  // including plugin type ids — so the host exclude layer applies to
  // contributed field types too, not just built-ins.
  const [disabledFieldTypes, setDisabledFieldTypes] = useState<Set<string>>(
    () => new Set()
  );

  // The host's notification defaults (plugin options). `null` until the
  // config request settles; `{}` when the request failed or nothing is
  // configured, so consumers can distinguish "loading" from "no defaults".
  const [notificationDefaults, setNotificationDefaults] =
    useState<NotificationDefaults | null>(null);

  // Plugin-level spam defaults, so the Settings tab can show what
  // "inherit" resolves to. `null` while the config request settles.
  const [spamDefaults, setSpamDefaults] = useState<SpamDefaults | null>(null);

  // Collections a form may redirect to. `null` while the config request
  // settles, so the Settings tab can tell "not configured" from "not known
  // yet" and not flash the option away.
  const [redirectCollections, setRedirectCollections] = useState<
    string[] | null
  >(null);

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
            spamProtection?: SpamDefaults;
            redirectCollections?: string[];
          } | null
        ) => {
          if (cancelled) return;
          setEnabledTypes(
            config?.fields
              ? allTypes.filter(type => config.fields?.[type] !== false)
              : allTypes
          );
          setDisabledFieldTypes(
            new Set(
              Object.entries(config?.fields ?? {})
                .filter(([, enabled]) => enabled === false)
                .map(([type]) => type)
            )
          );
          setNotificationDefaults(config?.notifications ?? {});
          setSpamDefaults(config?.spamProtection ?? {});
          setRedirectCollections(config?.redirectCollections ?? []);
        }
      )
      .catch(() => {
        if (cancelled) return;
        setEnabledTypes(allTypes);
        setNotificationDefaults({});
        setSpamDefaults({});
        setRedirectCollections([]);
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
    (type: FormFieldTypeId) => {
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

    // A notification is written to the form as it is typed, so nothing between
    // the editor and here refuses one. The sheet this replaced disabled its own
    // commit for a blank name, and the field rejects a malformed address on
    // blur — both preconditions move to this save, which is now the only
    // commit, and both are answered by the module the editor itself asks.
    const blocked = notificationsBlockingSave(notifications);
    if (blocked) {
      toast.error(blocked);
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
  // The host page owns the measure, the centring and the padding — this view
  // renders as content inside its frame, under its breadcrumb. Declaring a
  // shell here would nest one inset inside another and put this heading out of
  // line with that breadcrumb. Nothing below hand-rolls a card, a width cap or
  // a hack to escape either.
  return (
    <>
      {/* ── Page header ── */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground tracking-tight">
          {isCreating ? "Create Form" : "Edit Form"}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {isCreating
            ? "Design a new form with drag-and-drop fields."
            : "Modify your form fields and settings."}
        </p>
      </div>

      {/* ── Form metadata ──
          A card, so the fields that identify the form read as one group and
          have a surface to sit on. The builder canvas below is deliberately
          NOT carded: it draws its own drop zone, and a frame around a frame
          reads as a nested box rather than as structure. */}
      <Card className="mb-6 px-6 py-5">
        <div className="flex flex-wrap gap-4">
          <FieldShell
            label="Form Name"
            htmlFor="form-name"
            className="flex-1 min-w-[200px]"
          >
            <Input
              type="text"
              value={formData.name || ""}
              onChange={e => handleNameChange(e.target.value)}
              placeholder="e.g., Contact Form"
            />
          </FieldShell>

          <FieldShell
            label="Slug"
            htmlFor="form-slug"
            className="flex-1 min-w-[160px]"
          >
            <Input
              type="text"
              value={formData.slug || ""}
              onChange={e => updateFormData({ slug: e.target.value })}
              placeholder="e.g., contact-form"
              className="placeholder:text-muted-foreground"
            />
          </FieldShell>

          {/* Status is a Radix Select: its Root accepts a fixed prop list and
              forwards none of the rest to the trigger DOM node, so a
              FieldShell clone's id/aria-describedby/aria-invalid would land
              on a component that drops them rather than on the focusable
              trigger. The render-function form of `children` sidesteps
              that: FieldShell hands the computed wiring to this function,
              which applies it to SelectTrigger — the actual focusable,
              ARIA-bearing element — instead of a clone that can never reach
              past `Select`'s root. */}
          <div className="w-36">
            <FieldShell label="Status" htmlFor="form-status">
              {({ id, describedBy, invalid }) => (
                <Select
                  value={formData.status || "draft"}
                  onValueChange={value =>
                    updateFormData({
                      status: value as "draft" | "published" | "closed",
                    })
                  }
                >
                  <SelectTrigger
                    id={id}
                    aria-describedby={describedBy}
                    aria-invalid={invalid}
                  >
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="published">Published</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </FieldShell>
          </div>
        </div>
      </Card>

      {/* ── Main tab navigation ──
          On the page rather than inside the card above: the rail switches what
          is BELOW it, so grouping it with the metadata would attach it to the
          wrong thing. */}
      <div className="border-b border-border mb-6">
        <Tabs
          value={activeTab}
          onValueChange={v => setActiveTab(v as typeof activeTab)}
        >
          {/* Layout only. The underline, the active and hover colours, the
              focus ring and the disabled state all come from the shared
              primitive; restating them here is how two copies of one
              appearance start drifting.

              The strip can overflow its container, so it asks for scrolling
              through `scrollable` rather than by putting `overflow-x-auto` on
              the list: that spelling makes the LIST the scroll container, which
              costs the rail its indicator. */}
          <TabsList scrollable className="bg-transparent justify-start gap-0">
            {mainTabs.map(tab => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="shrink-0 whitespace-nowrap"
              >
                {tab.label}
                {/* `rounded-sm`, the adornment step, matching the shared
                    Badge and the identically sized notification count.
                    Square is the TAB's corner and it exists so the
                    underline runs flush to the trigger's edges; a chip
                    inside the label inherits none of that reasoning, and
                    carrying it made the count read as a second tab. */}
                {tab.count !== null && (
                  <span
                    className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-semibold rounded-sm ml-2 transition-colors ${
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
          disabledFieldTypes={disabledFieldTypes}
          onAddField={handleAddField}
        />
      )}

      {/* Preview tab */}
      {activeTab === "preview" && (
        <FormPreview fields={fields} formData={formData} />
      )}

      {/* Settings tab */}
      {activeTab === "settings" && (
        <FormSettingsTab
          spamDefaults={spamDefaults}
          redirectCollections={redirectCollections}
        />
      )}

      {/* Notifications tab */}
      {activeTab === "notifications" && (
        <FormNotificationsTab defaults={notificationDefaults} />
      )}

      {/* Save error */}
      {saveError && (
        // Full-strength destructive border so the error box boundary is perceivable over its tinted fill.
        <div className="mt-6 p-3 text-sm text-destructive bg-destructive/10 border border-destructive rounded-none">
          {saveError}
        </div>
      )}

      {/* A form commits as one document, so there is exactly one action bar,
          fed the dirty flag the form state already tracks rather than a
          second computation of it. */}
      <FormActions dirty={isDirty}>
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
      </FormActions>
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
