"use client";

/**
 * Component Builder — Edit Page
 *
 * Mirrors the Collection / Single edit pages: BuilderToolbar at top,
 * BuilderFieldList in body inside DndContext, overlays mounted lazily.
 *
 * Schema-change preview + apply pipeline wired the same way as the
 * collection builder — SafeChangeConfirmDialog / SchemaChangeDialog /
 * RestartContext. Components-specific deltas:
 * - No HooksEditorSheet (showHooks: false in COMPONENT_BUILDER_CONFIG).
 * - Uses componentApi.previewSchemaChanges / applySchemaChanges.
 * - Settings modal uses Category instead of adminGroup; no Status/Order/Plural.
 *
 * Locked code-first Components render in readOnly mode.
 */

import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { zodResolver } from "@hookform/resolvers/zod";
import { Skeleton } from "@revnixhq/ui";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";

import {
  BuilderFieldList,
  BuilderSettingsModal,
  BuilderToolbar,
  FieldEditorSheet,
  FieldPickerModal,
  SafeChangeConfirmDialog,
  SchemaChangeDialog,
  type BuilderSettingsValues,
} from "@admin/components/features/schema-builder";
import type { BuilderField } from "@admin/components/features/schema-builder/types";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { toast } from "@admin/components/ui";
import { useRestart } from "@admin/context/RestartContext";
import {
  useComponent,
  useUpdateComponent,
} from "@admin/hooks/queries/useComponents";
import { useFieldBuilder } from "@admin/hooks/useFieldBuilder";
import {
  convertToBuilderField,
  convertToFieldDefinition,
  DEFAULT_SYSTEM_FIELDS,
} from "@admin/lib/builder";
import { countDirtyFields } from "@admin/lib/builder/dirty-tracking";
import { packIntoRows, parseWidth } from "@admin/lib/builder/reflow";
import { componentApi } from "@admin/services/componentApi";
import type {
  FieldResolution,
  SchemaPreviewResponse,
  SchemaRenameResolution,
} from "@admin/services/schemaApi";
import type { FieldDefinition } from "@admin/types/collection";
import type { SchemaField } from "@admin/types/entities";

import { COMPONENT_BUILDER_CONFIG } from "./builder-config";

const componentFormSchema = z.object({
  singularName: z
    .string()
    .min(1, "Name is required")
    .max(255, "Name is too long"),
});

type FormData = z.infer<typeof componentFormSchema>;

type ActiveOverlay =
  | { kind: "none" }
  | { kind: "settings" }
  | { kind: "picker"; insertAt: number }
  | { kind: "edit"; fieldId: string };

interface ComponentBuilderEditPageProps {
  params?: { slug?: string };
}

export default function ComponentBuilderEditPage({
  params,
}: ComponentBuilderEditPageProps): React.ReactElement {
  const slug = params?.slug;
  const { data: component, isLoading, error } = useComponent(slug);

  const builder = useFieldBuilder<FormData>({
    resolver: zodResolver(componentFormSchema),
    defaultValues: { singularName: "" },
  });

  const [settings, setSettings] = useState<BuilderSettingsValues | null>(null);
  const [active, setActive] = useState<ActiveOverlay>({ kind: "none" });
  const [isInitialized, setIsInitialized] = useState(false);
  const [originalFields, setOriginalFields] = useState<
    readonly BuilderField[] | null
  >(null);

  // Schema change confirmation state.
  const [previewData, setPreviewData] = useState<SchemaPreviewResponse | null>(
    null
  );
  const [showSchemaDialog, setShowSchemaDialog] = useState(false);
  const [showSafeDialog, setShowSafeDialog] = useState(false);
  const [isApplyingSchema, setIsApplyingSchema] = useState(false);
  const { startRestart, stopRestart } = useRestart();

  const { mutate: updateComponent, isPending: isSaving } = useUpdateComponent();

  // Initialize builder + settings from the loaded Component.
  useEffect(() => {
    if (!component || isInitialized) return;

    builder.form.reset({
      singularName: component.label || component.slug || "",
    });

    const userSchemaFields = (component.fields ?? []).filter(
      (f: SchemaField) => f.name !== "title" && f.name !== "slug"
    );
    const builderFields = userSchemaFields.map(
      (field: SchemaField, index: number) =>
        convertToBuilderField(field as unknown as FieldDefinition, index)
    );
    const allFields = [...DEFAULT_SYSTEM_FIELDS, ...builderFields];
    builder.setFields(allFields);

    setOriginalFields(allFields.filter(f => !f.isSystem));

    const adminBlock = (component.admin ?? {}) as Record<string, unknown>;
    setSettings({
      singularName: component.label || component.slug || "",
      slug: component.slug,
      description: component.description || "",
      icon: (adminBlock.icon as string | undefined) || "Puzzle",
      category: (adminBlock.category as string | undefined) || "",
    });

    setIsInitialized(true);
  }, [component, builder, isInitialized]);

  const isLocked = component?.locked === true;

  const unsavedCount = useMemo(() => {
    if (!originalFields) return 0;
    return countDirtyFields(
      originalFields,
      builder.fields.filter(f => !f.isSystem)
    );
  }, [builder.fields, originalFields]);

  const getValidatedFields = useCallback((): FieldDefinition[] | null => {
    const userFields = builder.fields.filter(
      f => !f.isSystem && f.name !== "title" && f.name !== "slug"
    );
    const validation = builder.validateFields(userFields);
    if (!validation.valid) {
      toast.error(validation.errorMessage);
      return null;
    }
    return userFields.map(convertToFieldDefinition);
  }, [builder]);

  const applyComponentSchemaChanges = useCallback(
    async (
      fieldDefinitions: FieldDefinition[],
      schemaVersion: number,
      resolutions: Record<string, FieldResolution>,
      renameResolutions: SchemaRenameResolution[]
    ) => {
      if (!slug) return;
      setIsApplyingSchema(true);
      if (typeof window !== "undefined") window.__nextlySchemaApplying = true;
      startRestart();
      try {
        const result = await componentApi.applySchemaChanges(
          slug,
          fieldDefinitions,
          schemaVersion,
          resolutions,
          renameResolutions
        );
        if (result.success) {
          const componentLabel = settings?.singularName?.trim() || slug;
          const summarySuffix =
            result.toastSummary && result.toastSummary !== "no changes"
              ? `. ${result.toastSummary}`
              : "";
          stopRestart(true, `${componentLabel} schema updated${summarySuffix}`);
          setShowSchemaDialog(false);
          setShowSafeDialog(false);
          setPreviewData(null);
          setOriginalFields(builder.fields.filter(f => !f.isSystem));
        } else {
          stopRestart(
            false,
            result.message || "Failed to apply schema changes"
          );
        }
      } catch (err) {
        const errorObj = err as { message?: string };
        stopRestart(
          false,
          errorObj?.message || "An error occurred while applying changes"
        );
      } finally {
        setIsApplyingSchema(false);
        if (typeof window !== "undefined")
          window.__nextlySchemaApplying = false;
      }
    },
    [slug, startRestart, stopRestart, settings?.singularName, builder.fields]
  );

  const saveSettingsOnly = useCallback(
    (fieldDefinitions: FieldDefinition[]) => {
      if (!slug || !settings) return;
      updateComponent(
        {
          componentSlug: slug,
          updates: {
            label: settings.singularName,
            description: settings.description,
            fields: fieldDefinitions as unknown as Record<string, unknown>[],
            admin: {
              category: settings.category,
              icon: settings.icon,
            },
          },
        },
        {
          onSuccess: () => {
            toast.success("Component updated");
            setOriginalFields(builder.fields.filter(f => !f.isSystem));
          },
          onError: err => {
            const errorObj = err as { message?: string };
            toast.error(
              errorObj?.message ||
                "An unexpected error occurred while updating the component."
            );
          },
        }
      );
    },
    [slug, settings, updateComponent, builder.fields]
  );

  const handleSave = useCallback(async () => {
    if (!slug) {
      toast.error("Component slug is missing");
      return;
    }

    const fieldDefinitions = getValidatedFields();
    if (!fieldDefinitions) return;

    try {
      const preview = await componentApi.previewSchemaChanges(
        slug,
        fieldDefinitions
      );

      if (!preview.hasChanges) {
        saveSettingsOnly(fieldDefinitions);
        return;
      }

      if (preview.classification === "safe") {
        setPreviewData(preview);
        setShowSafeDialog(true);
        return;
      }

      setPreviewData(preview);
      setShowSchemaDialog(true);
    } catch (err) {
      const errorObj = err as { message?: string };
      toast.error(errorObj?.message || "Failed to preview schema changes");
    }
  }, [slug, getValidatedFields, saveSettingsOnly]);

  const handleRowDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const activeIdStr = String(active.id);
      const overIdStr = String(over.id);
      if (!activeIdStr.startsWith("row-") || !overIdStr.startsWith("row-")) {
        return;
      }
      const userFields = builder.fields.filter(f => !f.isSystem);
      const systemFields = builder.fields.filter(f => f.isSystem);
      const rows = packIntoRows(
        userFields.map(f => ({
          id: f.id,
          width: parseWidth(f.admin?.width),
          _field: f,
        }))
      );
      const oldIdx = Number(activeIdStr.slice("row-".length));
      const newIdx = Number(overIdStr.slice("row-".length));
      if (Number.isNaN(oldIdx) || Number.isNaN(newIdx)) return;
      const reorderedRows = arrayMove(rows, oldIdx, newIdx);
      const reorderedUserFields = reorderedRows.flatMap(row =>
        row.map(r => (r as { _field: BuilderField })._field)
      );
      builder.handleFieldsReorder([...systemFields, ...reorderedUserFields]);
    },
    [builder]
  );

  // ---------------------------- Loading / error guards ----------------------

  if (!slug) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <h2 className="text-lg font-semibold text-foreground mb-2">
            Component Not Found
          </h2>
          <p className="text-muted-foreground">
            No component slug was provided.
          </p>
        </div>
      </div>
    );
  }

  if (isLoading || !isInitialized) {
    return (
      <div className="h-screen flex flex-col bg-background">
        <div className="p-6  border-b border-primary/5">
          <Skeleton className="h-8 w-48 mb-2" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="flex-1 p-4">
          <Skeleton className="h-12 w-full mb-2" />
          <Skeleton className="h-12 w-full mb-2" />
          <Skeleton className="h-12 w-full" />
        </div>
      </div>
    );
  }

  if (error || !component || !settings) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <PageErrorFallback />
      </div>
    );
  }

  // ---------------------------- Render --------------------------------------

  const editingField =
    active.kind === "edit"
      ? builder.fields.find(f => f.id === active.fieldId)
      : null;

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <BuilderToolbar
        config={COMPONENT_BUILDER_CONFIG}
        name={settings.singularName || slug}
        icon={settings.icon}
        source={component.source}
        locked={isLocked}
        unsavedCount={unsavedCount}
        onOpenSettings={() => setActive({ kind: "settings" })}
        onSave={() => void handleSave()}
      />

      <DndContext
        sensors={builder.sensors}
        onDragStart={builder.handleDragStart}
        onDragEnd={handleRowDragEnd}
      >
        <BuilderFieldList
          fields={builder.fields}
          readOnly={isLocked}
          onAddAt={insertAt => setActive({ kind: "picker", insertAt })}
          onEditField={fieldId => setActive({ kind: "edit", fieldId })}
          onDeleteField={fieldId => builder.handleFieldDelete(fieldId)}
          onReorder={() => {
            // Reorder is driven by handleRowDragEnd above.
          }}
        />
      </DndContext>

      {active.kind === "settings" && (
        <BuilderSettingsModal
          open
          mode="edit"
          config={COMPONENT_BUILDER_CONFIG}
          initialValues={settings}
          onCancel={() => setActive({ kind: "none" })}
          onSubmit={next => {
            setSettings(next);
            setActive({ kind: "none" });
          }}
        />
      )}

      {active.kind === "picker" && (
        <FieldPickerModal
          open
          excludedTypes={COMPONENT_BUILDER_CONFIG.picker.excludedTypes ?? []}
          onCancel={() => setActive({ kind: "none" })}
          onSelect={type => {
            builder.handleFieldAdd(type);
            setActive({ kind: "none" });
          }}
        />
      )}

      {active.kind === "edit" && editingField && (
        <FieldEditorSheet
          open
          mode="edit"
          field={editingField}
          siblingNames={builder.fields
            .filter(f => f.id !== editingField.id)
            .map(f => f.name)}
          readOnly={isLocked}
          onCancel={() => setActive({ kind: "none" })}
          onApply={next => {
            builder.handleFieldUpdate(next);
            setActive({ kind: "none" });
          }}
          onDelete={() => {
            builder.handleFieldDelete(editingField.id);
            setActive({ kind: "none" });
          }}
        />
      )}

      {/* Safe-change confirmation (additive only). */}
      {previewData && previewData.classification === "safe" && (
        <SafeChangeConfirmDialog
          open={showSafeDialog}
          onOpenChange={setShowSafeDialog}
          collectionName={slug}
          changes={previewData.changes}
          onConfirm={() => {
            const fieldDefs = getValidatedFields();
            if (fieldDefs) {
              void applyComponentSchemaChanges(
                fieldDefs,
                previewData.schemaVersion,
                {},
                []
              );
            }
          }}
          isApplying={isApplyingSchema}
        />
      )}

      {/* Destructive / interactive change dialog. */}
      {previewData && previewData.classification !== "safe" && (
        <SchemaChangeDialog
          open={showSchemaDialog}
          onOpenChange={setShowSchemaDialog}
          collectionName={slug}
          hasDestructiveChanges={previewData.hasDestructiveChanges}
          classification={previewData.classification}
          changes={previewData.changes}
          renamed={previewData.renamed}
          warnings={previewData.warnings}
          interactiveFields={previewData.interactiveFields}
          onConfirm={(resolutions, renameResolutions) => {
            const fieldDefs = getValidatedFields();
            if (fieldDefs) {
              void applyComponentSchemaChanges(
                fieldDefs,
                previewData.schemaVersion,
                resolutions,
                renameResolutions
              );
            }
          }}
          isApplying={isApplyingSchema}
        />
      )}

      {(isSaving || isApplyingSchema) && (
        <div aria-live="polite" className="sr-only">
          Saving component changes…
        </div>
      )}
    </div>
  );
}
