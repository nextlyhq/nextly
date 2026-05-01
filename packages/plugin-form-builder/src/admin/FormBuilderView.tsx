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

import "../styles/form-builder.css";

import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
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
} from "@revnixhq/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import type { FormField, FormFieldType } from "../types";

import { FieldEditor } from "./components/builder/FieldEditor";
import { FieldLibrary } from "./components/builder/FieldLibrary";
import { FormCanvas } from "./components/builder/FormCanvas";
import { FormNotificationsTab } from "./components/builder/FormNotificationsTab";
import { FormPreview } from "./components/builder/FormPreview";
import { FormSettingsTab } from "./components/builder/FormSettingsTab";
import {
  FormBuilderProvider,
  useFormBuilder,
  createFieldFromType,
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
// Sliders / Spinner inline SVG
// ============================================================================

function SlidersIcon() {
  return (
    <svg
      className="h-3 w-3 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="4" y1="21" x2="4" y2="14" />
      <line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" />
      <line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="17" y1="16" x2="23" y2="16" />
    </svg>
  );
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
    selectedFieldId,
    activeTab,
    isDirty,
    formData,
    settings,
    notifications,
    setActiveTab,
    addField,
    moveField,
    selectField,
    deleteField,
    updateField,
    duplicateField,
    updateFormData,
    markAsSaved,
  } = useFormBuilder();

  const queryClient = useQueryClient();

  const [sidebarTab, setSidebarTab] = useState<"add" | "properties">("add");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── DnD ──────────────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over) return;

      const isFromLibrary = active.data.current?.isLibraryItem;

      if (isFromLibrary) {
        const fieldType = active.data.current?.fieldType as FormFieldType;
        if (fieldType) {
          const newField = createFieldFromType(fieldType);
          if (over.id === "canvas-drop-zone") {
            addField(newField);
          } else {
            const overIndex = fields.findIndex(f => f.name === over.id);
            addField(newField, overIndex !== -1 ? overIndex + 1 : undefined);
          }
        }
      } else {
        if (active.id !== over.id) {
          const oldIndex = fields.findIndex(f => f.name === active.id);
          const newIndex = fields.findIndex(f => f.name === over.id);
          if (oldIndex !== -1 && newIndex !== -1) {
            moveField(oldIndex, newIndex);
          }
        }
      }
    },
    [fields, addField, moveField]
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
      title: formDataWithoutId.name,
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
        const err = await response.json().catch(() => ({}));
        throw new Error(
          err.error || `Failed to save form: ${response.statusText}`
        );
      }
      const result = await response.json();
      const savedEntry = result.data || result;
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

  const handleFieldSelect = useCallback(
    (fieldName: string | null) => {
      selectField(fieldName);
      if (fieldName) setSidebarTab("properties");
    },
    [selectField]
  );

  const handleNameChange = useCallback(
    (name: string) => {
      updateFormData({ name });
      if (!formData.slug || formData.slug === slugify(formData.name)) {
        updateFormData({ slug: slugify(name) });
      }
    },
    [formData.name, formData.slug, updateFormData]
  );

  const selectedField = fields.find(f => f.name === selectedFieldId);
  const hasSelectedField = !!selectedFieldId;

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
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
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
            <span className="text-xs font-medium text-amber-600 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-md whitespace-nowrap">
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
        Outer shell — white card with rounded-md border (no shadow).
        Fills available height in the admin page container.
      */}
      <div
        className="flex border border-border bg-background overflow-hidden"
        style={{
          borderRadius: "0.5rem",
        }}
      >
        {/* =================================================================
            LEFT — scrollable main content
        ================================================================= */}
        <div className="flex-1 min-w-0">
          <div className="w-full px-8 pt-8 pb-12 space-y-6">
            {/* ── Fixed Metadata & Tab Navigation ── */}
            <div className="bg-background -mx-8 border-b border-border space-y-4">
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
                <TabsList className="bg-transparent justify-start gap-0 -mb-px border-b-0">
                  {mainTabs.map(tab => (
                    <TabsTrigger
                      key={tab.value}
                      value={tab.value}
                      style={{
                        borderBottomColor:
                          activeTab === tab.value
                            ? "hsl(var(--primary))"
                            : "transparent",
                      }}
                      className="border-b-2 relative -mb-0.5 data-[state=active]:text-primary data-[state=inactive]:text-muted-foreground hover:text-primary hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                    >
                      {tab.label}
                      {tab.count !== null && (
                        <span
                          className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-semibold rounded-md ml-2 transition-colors ${
                            activeTab === tab.value
                              ? "bg-primary/10 text-primary"
                              : "bg-muted text-muted-foreground"
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
              <div>
                <SortableContext
                  items={fields.map(f => f.name)}
                  strategy={verticalListSortingStrategy}
                >
                  <FormCanvas
                    fields={fields}
                    selectedFieldId={selectedFieldId}
                    onFieldSelect={handleFieldSelect}
                    onFieldDelete={deleteField}
                  />
                </SortableContext>
              </div>
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
                <FormNotificationsTab />
              </div>
            )}

            {/* Save error */}
            {saveError && (
              <div className="p-3 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md">
                {saveError}
              </div>
            )}
          </div>
        </div>

        {/* =================================================================
            RIGHT SIDEBAR — 360px, white bg, left border divider
            Only shown in Builder tab.
        ================================================================= */}
        {activeTab === "builder" && (
          <div
            className="shrink-0 border-l border-border bg-background flex flex-col"
            style={{ width: "360px" }}
          >
            {/* Sidebar tab bar */}
            <div
              className="shrink-0 grid grid-cols-2 gap-1.5 px-3 py-2.5 border-b border-border"
              style={{ minHeight: "52px" }}
            >
              {(
                [
                  {
                    value: "add" as const,
                    label: "Add Fields",
                    disabled: false,
                    icon: (
                      <svg
                        className="h-3 w-3 shrink-0"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                    ),
                  },
                  {
                    value: "properties" as const,
                    label: "Properties",
                    disabled: !hasSelectedField,
                    icon: <SlidersIcon />,
                  },
                ] as const
              ).map(tab => {
                const isActive = sidebarTab === tab.value;
                return (
                  <button
                    key={tab.value}
                    type="button"
                    disabled={tab.disabled}
                    onClick={() => !tab.disabled && setSidebarTab(tab.value)}
                    className={[
                      "flex items-center justify-center gap-1.5 w-full text-[13px] font-medium transition-all duration-150 border rounded-md select-none",
                      "disabled:opacity-40 disabled:cursor-not-allowed",
                      isActive
                        ? "bg-primary/5 text-primary border-primary/30 cursor-pointer"
                        : "bg-transparent border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 cursor-pointer",
                    ].join(" ")}
                    style={{ padding: "8px 12px" }}
                  >
                    {tab.icon}
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* Sidebar body */}
            <div className="flex-1 flex flex-col min-h-0">
              {/* Add Fields panel */}
              {sidebarTab === "add" && (
                <div className="flex-1 flex flex-col">
                  <FieldLibrary />
                </div>
              )}

              {/* Properties panel */}
              {sidebarTab === "properties" && (
                <div className="flex-1 flex flex-col relative">
                  {selectedField ? (
                    <FieldEditor
                      field={selectedField}
                      allFields={fields}
                      onUpdate={updates =>
                        updateField(selectedField.name, updates)
                      }
                      onDelete={() => {
                        deleteField(selectedField.name);
                        setSidebarTab("add");
                      }}
                      onDuplicate={() => duplicateField(selectedField.name)}
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full px-6 py-16 text-center">
                      <div className="flex items-center justify-center w-11 h-11 rounded-md bg-muted border border-border mb-4">
                        <SlidersIcon />
                      </div>
                      <p className="text-sm font-medium text-foreground">
                        No field selected
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Click a field in the canvas to edit its properties
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </DndContext>
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
