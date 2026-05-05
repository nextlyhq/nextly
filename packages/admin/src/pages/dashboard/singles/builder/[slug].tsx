"use client";

/**
 * Single Builder — Edit Page
 *
 * Mirrors the Collection edit page architecture:
 *   BuilderToolbar at top, BuilderFieldList in the body inside DndContext,
 *   overlays (settings modal / picker / editor sheet / hooks sheet) mounted
 *   lazily based on a single ActiveOverlay union.
 *
 * Singles run the same preview → SchemaChangeDialog → apply pipeline as
 * Collections. Locked code-first Singles render
 * in readOnly mode (cross-cutting code-first preservation requirement).
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
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { toast } from "@admin/components/ui";
import { useRestart } from "@admin/context/RestartContext";
import { useSingleSchema, useUpdateSingle } from "@admin/hooks/queries";
import { useFieldBuilder } from "@admin/hooks/useFieldBuilder";
import {
  convertToBuilderField,
  convertToFieldDefinition,
  DEFAULT_SYSTEM_FIELDS,
  findFieldById,
  findParentContainerId,
  reorderNestedFields,
} from "@admin/lib/builder";
import { countDirtyFields } from "@admin/lib/builder/dirty-tracking";
import { nextDuplicateName } from "@admin/lib/builder/duplicate-field-name";
import { isInsideRepeatingAncestor } from "@admin/lib/builder/is-inside-repeating-ancestor";
import { packIntoRows, parseWidth } from "@admin/lib/builder/reflow";
import type {
  FieldResolution,
  SchemaPreviewResponse,
  SchemaRenameResolution,
} from "@admin/services/schemaApi";
import { singleApi } from "@admin/services/singleApi";
import type { FieldDefinition } from "@admin/types/collection";
import type { ApiSingle } from "@admin/types/entities";

import { SINGLE_BUILDER_CONFIG } from "./builder-config";

const singleFormSchema = z.object({
  singularName: z
    .string()
    .min(1, "Name is required")
    .max(255, "Name is too long"),
});

type FormData = z.infer<typeof singleFormSchema>;

type ActiveOverlay =
  | { kind: "none" }
  | { kind: "settings" }
  // PR D: parentFieldId? scopes the picker to a group/repeater.
  | { kind: "picker"; insertAt: number; parentFieldId?: string }
  // Why: NEW in PR C. Sheet renders in create mode against this draft;
  // on Apply we append, on Cancel we discard.
  // PR D: parentFieldId? extends the overlay so the new field can be
  // committed into a parent group/repeater's nested fields.
  | { kind: "create"; draft: BuilderField; parentFieldId?: string }
  | { kind: "edit"; fieldId: string };
// Why: { kind: "hooks" } variant removed in PR D -- the Hooks UI was
// removed from the toolbar (feedback Section 2).

interface SingleBuilderEditPageProps {
  params?: { slug?: string };
}

export default function SingleBuilderEditPage({
  params,
}: SingleBuilderEditPageProps): React.ReactElement {
  const slug = params?.slug;
  const { data: single, isLoading, error } = useSingleSchema(slug);

  const builder = useFieldBuilder<FormData>({
    resolver: zodResolver(singleFormSchema),
    defaultValues: { singularName: "" },
  });

  const [settings, setSettings] = useState<BuilderSettingsValues | null>(null);
  const [active, setActive] = useState<ActiveOverlay>({ kind: "none" });
  const [isInitialized, setIsInitialized] = useState(false);
  // Why: was a JSON string of just field IDs, which silently masked
  // label / width / validation / options edits. Now a frozen array we
  // diff via countDirtyFields so every meaningful edit bumps the badge.
  const [originalFields, setOriginalFields] = useState<
    readonly BuilderField[] | null
  >(null);

  const [previewData, setPreviewData] = useState<SchemaPreviewResponse | null>(
    null
  );
  const [showSchemaDialog, setShowSchemaDialog] = useState(false);
  const [showSafeDialog, setShowSafeDialog] = useState(false);
  const [isApplyingSchema, setIsApplyingSchema] = useState(false);

  const { mutate: updateSingle, isPending: isSaving } = useUpdateSingle();
  const { startRestart, stopRestart } = useRestart();

  // Initialize builder + settings from the loaded Single.
  useEffect(() => {
    if (!single || isInitialized) return;

    builder.form.reset({
      singularName: single.label || single.slug || "",
    });

    const userSchemaFields = (single.fields ?? []).filter(
      (f: { name: string }) => f.name !== "title" && f.name !== "slug"
    );
    const builderFields = userSchemaFields.map((field, index: number) =>
      convertToBuilderField(field as unknown as FieldDefinition, index)
    );
    const allFields = [...DEFAULT_SYSTEM_FIELDS, ...builderFields];
    builder.setFields(allFields);

    setOriginalFields(allFields.filter(f => !f.isSystem));

    const adminBlock = (single.admin ?? {}) as Record<string, unknown>;
    setSettings({
      singularName: single.label || single.slug || "",
      slug: single.slug,
      description: single.description || "",
      icon: (adminBlock.icon as string | undefined) || "FileText",
      adminGroup: (adminBlock.group as string | undefined) || "",
      order: adminBlock.order as number | undefined,
      // Status: defaults false for legacy Singles written before the column
      // existed.
      status: single.status === true,
    });

    setIsInitialized(true);
  }, [single, builder, isInitialized]);

  const isLocked = single?.locked === true;

  // Dirty count: number of user fields that were added, removed, or had
  // any of their editable shape change since load.
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

  const applySchemaChanges = useCallback(
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
        const result = await singleApi.applySchemaChanges(
          slug,
          fieldDefinitions,
          schemaVersion,
          resolutions,
          renameResolutions
        );
        if (result.success) {
          const label = settings?.singularName?.trim() || slug;
          const summarySuffix =
            result.toastSummary && result.toastSummary !== "no changes"
              ? `. ${result.toastSummary}`
              : "";
          stopRestart(true, `${label} schema updated${summarySuffix}`);
          setShowSchemaDialog(false);
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

  // No-schema-change path: persist labels/settings only.
  const saveSettingsOnly = useCallback(
    (fieldDefinitions: FieldDefinition[]) => {
      if (!slug || !settings) return;
      updateSingle(
        {
          slug,
          updates: {
            label: settings.singularName,
            description: settings.description,
            fields: fieldDefinitions as unknown as ApiSingle["fields"],
            admin: {
              icon: settings.icon,
              group: settings.adminGroup,
              ...(settings.order !== undefined
                ? { order: settings.order }
                : {}),
            },
            ...(settings.status === true ? { status: true } : {}),
          },
        },
        {
          onSuccess: () => {
            toast.success("Single updated");
            setOriginalFields(builder.fields.filter(f => !f.isSystem));
          },
          onError: err => {
            const errorObj = err as { message?: string };
            toast.error(
              errorObj?.message ||
                "An unexpected error occurred while updating the Single."
            );
          },
        }
      );
    },
    [slug, settings, updateSingle, builder.fields]
  );

  const handleSave = useCallback(async () => {
    if (!slug || !settings) {
      toast.error("Single slug is missing");
      return;
    }

    const fieldDefinitions = getValidatedFields();
    if (!fieldDefinitions) return;

    try {
      const preview = await singleApi.previewSchemaChanges(
        slug,
        fieldDefinitions
      );

      if (!preview.hasChanges) {
        saveSettingsOnly(fieldDefinitions);
        return;
      }

      if (
        preview.classification === "safe" &&
        !(preview.renamed && preview.renamed.length > 0)
      ) {
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
  }, [slug, settings, getValidatedFields, saveSettingsOnly]);

  // Why: PR D feedback -- duplicate icon on each field card. Same shape
  // as the collections page handler.
  const handleDuplicateField = useCallback(
    (fieldId: string) => {
      // Why: PR I -- duplicate is now reachable from nested rows in the
      // field list, not only top-level. Walk the tree to locate source
      // and its parent (if any), then append the duplicate either to
      // the parent's children or to top-level. takenNames scopes to
      // siblings so nested + top-level can share names.
      const source = findFieldById(builder.fields, fieldId);
      if (!source) return;
      const parent = findParentContainerId(builder.fields, fieldId);
      const siblings = parent
        ? (findFieldById(builder.fields, parent.containerId)?.fields ?? [])
        : builder.fields;
      const takenNames = siblings.map(f => f.name);
      const duplicate: BuilderField = {
        ...source,
        id: `field_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        name: nextDuplicateName(source.name, takenNames),
      };
      if (parent) {
        builder.handleNestedFieldAdd(parent.containerId, duplicate);
      } else {
        builder.setFields([...builder.fields, duplicate]);
      }
    },
    [builder]
  );

  // Why: DnD reorder is row-level (BuilderFieldList packs fields into rows
  // by width). We compute the OLD row layout, apply the row swap, and
  // flatten back to a fields array for handleFieldsReorder. The legacy
  // builder.handleDragEnd is built for the old palette+field-list model
  // and ignores row IDs.
  const handleRowDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const activeIdStr = String(active.id);
      const overIdStr = String(over.id);

      // Why: PR I -- nested fields use field ids in their per-parent
      // SortableContext. Within-parent reorder via reorderNestedFields.
      // Cross-parent moves intentionally a no-op (Q2).
      if (activeIdStr.startsWith("field_") && overIdStr.startsWith("field_")) {
        const activeParent = findParentContainerId(builder.fields, activeIdStr);
        const overParent = findParentContainerId(builder.fields, overIdStr);
        if (
          activeParent &&
          overParent &&
          activeParent.containerId === overParent.containerId
        ) {
          builder.setFields(prev =>
            reorderNestedFields(prev, activeIdStr, overIdStr)
          );
        }
        return;
      }

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
            Single Not Found
          </h2>
          <p className="text-muted-foreground">No Single slug was provided.</p>
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

  if (error || !single || !settings) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <PageErrorFallback />
      </div>
    );
  }

  // ---------------------------- Render --------------------------------------

  // Why: PR I -- nested children live in parent.fields[]; the shallow
  // .find() only sees top-level fields. findFieldById walks the tree
  // so clicking a nested row resolves to the right field.
  const editingField =
    active.kind === "edit"
      ? (findFieldById(builder.fields, active.fieldId) ?? null)
      : null;

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <PageContainer className="flex-1">
        <BuilderToolbar
          config={SINGLE_BUILDER_CONFIG}
          name={settings.singularName || slug}
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
            onDuplicateField={handleDuplicateField}
            // Why: PR I -- nested +Add opens picker scoped to parent.
            onAddInsideParent={parentId =>
              setActive({
                kind: "picker",
                insertAt: 0,
                parentFieldId: parentId,
              })
            }
            onReorder={() => {
              // Reorder is driven by handleDragEnd above; useFieldBuilder
              // owns the sortable wiring.
            }}
          />
        </DndContext>
      </PageContainer>

      {active.kind === "settings" && (
        <BuilderSettingsModal
          open
          mode="edit"
          config={SINGLE_BUILDER_CONFIG}
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
          // PR D: title scopes the picker to the parent for nested adds.
          title={
            active.parentFieldId
              ? // Why: PR I -- parentFieldId can point to a nested parent;
                // findFieldById walks the tree.
                `Add field to ${
                  findFieldById(builder.fields, active.parentFieldId)?.name ??
                  "parent"
                }`
              : undefined
          }
          excludedTypes={SINGLE_BUILDER_CONFIG.picker.excludedTypes ?? []}
          onCancel={() => setActive({ kind: "none" })}
          // Why: PR C flow change -- pick opens sheet in create mode.
          // Field commits on Apply, discards on Cancel.
          // PR D: thread parentFieldId through.
          onSelect={type =>
            setActive({
              kind: "create",
              parentFieldId: active.parentFieldId,
              draft: {
                id: `field_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
                name: "",
                label: "",
                type,
                validation: {},
              },
            })
          }
        />
      )}

      {active.kind === "create" && (
        <FieldEditorSheet
          open
          mode="create"
          field={active.draft}
          siblingFields={
            active.parentFieldId
              ? // Why: PR I -- parentFieldId can be nested.
                (findFieldById(builder.fields, active.parentFieldId)?.fields ??
                [])
              : builder.fields
          }
          readOnly={isLocked}
          isInsideRepeatingAncestor={
            active.parentFieldId
              ? // Why: same logic as collections page -- the new field
                // counts as nested if its parent is a repeating
                // container OR is itself nested in one. PR I:
                // findFieldById replaces shallow .find().
                (() => {
                  const parent = findFieldById(
                    builder.fields,
                    active.parentFieldId
                  );
                  if (!parent) return false;
                  const parentIsRepeating =
                    parent.type === "repeater" ||
                    (parent.type === "component" && parent.repeatable === true);
                  return (
                    parentIsRepeating ||
                    isInsideRepeatingAncestor(parent.id, builder.fields)
                  );
                })()
              : false
          }
          onCancel={() => setActive({ kind: "none" })}
          onApply={next => {
            if (active.parentFieldId) {
              builder.handleNestedFieldAdd(active.parentFieldId, next);
            } else {
              builder.setFields([...builder.fields, next]);
            }
            setActive({ kind: "none" });
          }}
          onDelete={() => setActive({ kind: "none" })}
        />
      )}

      {active.kind === "edit" && editingField && (
        <FieldEditorSheet
          open
          mode="edit"
          field={editingField}
          siblingFields={(() => {
            // Why: PR I -- when editing a nested field, siblings are the
            // parent's children (minus self), not all top-level fields.
            const parent = findParentContainerId(
              builder.fields,
              editingField.id
            );
            if (!parent) {
              return builder.fields.filter(f => f.id !== editingField.id);
            }
            const container = findFieldById(builder.fields, parent.containerId);
            return (container?.fields ?? []).filter(
              f => f.id !== editingField.id
            );
          })()}
          readOnly={isLocked}
          isInsideRepeatingAncestor={isInsideRepeatingAncestor(
            editingField.id,
            builder.fields
          )}
          onCancel={() => setActive({ kind: "none" })}
          onApply={next => {
            builder.handleFieldUpdate(next);
            setActive({ kind: "none" });
          }}
          onDelete={() => {
            builder.handleFieldDelete(editingField.id);
            setActive({ kind: "none" });
          }}
          // Why: PR I dropped onAddNestedField -- the +Add affordance for
          // nested children moved into BuilderFieldList.
        />
      )}

      {/* Hooks UI removed in PR D (feedback Section 2). */}

      {previewData &&
        previewData.classification === "safe" &&
        !(previewData.renamed && previewData.renamed.length > 0) && (
          <SafeChangeConfirmDialog
            open={showSafeDialog}
            onOpenChange={setShowSafeDialog}
            collectionName={slug}
            changes={previewData.changes}
            onConfirm={() => {
              const fieldDefs = getValidatedFields();
              if (fieldDefs) {
                void applySchemaChanges(
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

      {previewData &&
        (previewData.classification !== "safe" ||
          (previewData.renamed && previewData.renamed.length > 0)) && (
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
                void applySchemaChanges(
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
          Saving Single changes…
        </div>
      )}
    </div>
  );
}
