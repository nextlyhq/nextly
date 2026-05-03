"use client";

/**
 * Collection Builder — Edit Page
 *
 * Wires the new shared schema-builder components onto the Collection edit
 * route. Replaces the legacy BuilderPageTemplate (right-sidebar with
 * Settings/Add/Edit tabs) with:
 *   BuilderToolbar at top (sticky)
 *   BuilderFieldList in body (WYSIWYG row pack)
 *   Overlays: BuilderSettingsModal / FieldPickerModal / FieldEditorSheet /
 *             HooksEditorSheet (only one open at a time)
 *
 * Schema-change preview + apply pipeline is preserved verbatim from the
 * legacy page — same SafeChangeConfirmDialog / SchemaChangeDialog, same
 * RestartContext integration, same toast messaging. The new BuilderToolbar
 * just calls handleSave; the rest of the flow is unchanged.
 *
 * Code-first preservation: locked collections render the page in readOnly
 * mode (formerly redirected to the listing). Devs can now visually
 * inspect the schema; every editing affordance is disabled.
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
  HooksEditorSheet,
  SafeChangeConfirmDialog,
  SchemaChangeDialog,
  type BuilderSettingsValues,
  type EnabledHook,
} from "@admin/components/features/schema-builder";
import type { BuilderField } from "@admin/components/features/schema-builder/types";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { toast } from "@admin/components/ui";
import { useRestart } from "@admin/context/RestartContext";
import { useCollection, useUpdateCollection } from "@admin/hooks/queries";
import { useFieldBuilder } from "@admin/hooks/useFieldBuilder";
import {
  convertToFieldDefinition,
  convertToBuilderField,
  convertHooksToStoredFormat,
  DEFAULT_SYSTEM_FIELDS,
} from "@admin/lib/builder";
import { countDirtyFields } from "@admin/lib/builder/dirty-tracking";
import { packIntoRows, parseWidth } from "@admin/lib/builder/reflow";
import { COLLECTION_BUILDER_CONFIG } from "@admin/pages/dashboard/collections/builder/builder-config";
import {
  schemaApi,
  type SchemaPreviewResponse,
  type FieldResolution,
  type SchemaRenameResolution,
} from "@admin/services/schemaApi";
// Two import statements are intentional. With isolatedModules + esbuild,
// merging these into a single `import { type FieldDefinition,
// getCollectionFields }` block has historically been collapsed by
// prettier into both being type-only, which strips getCollectionFields
// at runtime (it's a function, not a type). See main's ce29d67.
import type { FieldDefinition } from "@admin/types/collection";
import { getCollectionFields } from "@admin/types/collection";

const collectionFormSchema = z.object({
  singularName: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(255, "Name is too long"),
  pluralName: z.string().trim().max(255, "Plural name is too long").optional(),
});

type FormData = z.infer<typeof collectionFormSchema>;

/**
 * Discriminated union for the single overlay open at a time. "none" means
 * no overlay; the other variants carry whatever per-overlay state they
 * need (the field id for the editor, the insert position for the picker).
 */
type ActiveOverlay =
  | { kind: "none" }
  | { kind: "settings" }
  | { kind: "picker"; insertAt: number }
  // Why: NEW in PR C. The user has chosen a type but hasn't committed
  // the field yet. Sheet renders in create mode against this draft; on
  // Apply we append to builder.fields, on Cancel we discard. Avoids the
  // legacy bug where canceling left an empty placeholder in the list.
  | { kind: "create"; draft: BuilderField }
  | { kind: "edit"; fieldId: string }
  | { kind: "hooks" };

interface CollectionBuilderEditPageProps {
  params?: { slug?: string };
}

export default function CollectionBuilderEditPage({
  params,
}: CollectionBuilderEditPageProps): React.ReactElement {
  const slug = params?.slug;
  const { data: collection, isLoading, error } = useCollection(slug);

  const builder = useFieldBuilder<FormData>({
    resolver: zodResolver(collectionFormSchema),
    defaultValues: { singularName: "", pluralName: "" },
  });

  const [settings, setSettings] = useState<BuilderSettingsValues | null>(null);
  const [hooks, setHooks] = useState<EnabledHook[]>([]);
  const [active, setActive] = useState<ActiveOverlay>({ kind: "none" });
  const [isInitialized, setIsInitialized] = useState(false);

  // Why: was a JSON string of just field IDs, which silently masked
  // label / width / validation / options edits. Now a frozen array we
  // diff via countDirtyFields so every meaningful edit bumps the badge.
  const [originalFields, setOriginalFields] = useState<
    readonly BuilderField[] | null
  >(null);

  // Schema change confirmation state — preserved verbatim from legacy.
  const [previewData, setPreviewData] = useState<SchemaPreviewResponse | null>(
    null
  );
  const [showSchemaDialog, setShowSchemaDialog] = useState(false);
  const [showSafeDialog, setShowSafeDialog] = useState(false);
  const [isApplyingSchema, setIsApplyingSchema] = useState(false);
  const { startRestart, stopRestart } = useRestart();

  const { mutate: updateCollection, isPending: isSaving } =
    useUpdateCollection();

  // Initialize builder + settings from the loaded collection.
  useEffect(() => {
    if (!collection || isInitialized) return;

    const singular =
      collection.labels?.singular || collection.label || collection.name || "";
    const plural = collection.labels?.plural || collection.label || "";

    builder.form.reset({
      singularName: singular,
      pluralName: plural,
    });

    const schemaFields = getCollectionFields(collection);
    const userSchemaFields = schemaFields.filter(
      (f: FieldDefinition) => f.name !== "title" && f.name !== "slug"
    );
    const builderFields = userSchemaFields.map(
      (field: FieldDefinition, index: number) =>
        convertToBuilderField(field, index)
    );
    const allFields = [...DEFAULT_SYSTEM_FIELDS, ...builderFields];
    builder.setFields(allFields);

    // Pin the load-time field array for dirty detection. countDirtyFields
    // diffs the full editable shape, so every config edit bumps the badge.
    setOriginalFields(allFields.filter(f => !f.isSystem));

    setSettings({
      singularName: singular,
      pluralName: plural,
      slug: slug ?? "",
      description: collection.description || "",
      icon: collection.admin?.icon || "Database",
      adminGroup: collection.admin?.group || "",
      order: (collection.admin as Record<string, unknown>)?.order as
        | number
        | undefined,
      // collection.status is the Draft/Published flag from PR 1; default
      // false for collections written before the column existed.
      status: (collection as { status?: boolean }).status === true,
    });

    if (collection.hooks && Array.isArray(collection.hooks)) {
      const enabledHooks: EnabledHook[] = collection.hooks.map(hook => ({
        id: `hook_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
        hookId: hook.hookId,
        enabled: hook.enabled,
        config: hook.config,
      }));
      setHooks(enabledHooks);
    }

    setIsInitialized(true);
  }, [collection, builder, isInitialized, slug]);

  const isLocked = collection?.locked === true;
  const fieldNames = useMemo(
    () => builder.fields.filter(f => f.name?.trim()).map(f => f.name),
    [builder.fields]
  );

  // Dirty count: number of user fields that were added, removed, or had
  // any of their editable shape change (label / width / validation /
  // options / defaultValue / nested fields / etc.) since load.
  const unsavedCount = useMemo(() => {
    if (!originalFields) return 0;
    return countDirtyFields(
      originalFields,
      builder.fields.filter(f => !f.isSystem)
    );
  }, [builder.fields, originalFields]);

  // Build validated field definitions from the builder state.
  // Shared by the preview path and the settings-only save path.
  const getValidatedFields = useCallback((): FieldDefinition[] | null => {
    const systemFieldNames = ["title", "slug"];
    const userFields = builder.fields.filter(
      f => !f.isSystem && !systemFieldNames.includes(f.name)
    );
    const validation = builder.validateFields(userFields);
    if (!validation.valid) {
      toast.error(validation.errorMessage);
      return null;
    }
    return userFields.map(convertToFieldDefinition);
  }, [builder]);

  // Apply schema changes after user confirmation. Same orchestration as
  // legacy — kept verbatim because the toast / restart wiring is delicate.
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
        const result = await schemaApi.apply(
          slug,
          fieldDefinitions,
          schemaVersion,
          resolutions,
          renameResolutions
        );
        if (result.success) {
          const collectionLabel = settings?.singularName?.trim() || slug;
          const summarySuffix =
            result.toastSummary && result.toastSummary !== "no changes"
              ? `. ${result.toastSummary}`
              : "";
          stopRestart(
            true,
            `${collectionLabel} schema updated${summarySuffix}`
          );
          setShowSchemaDialog(false);
          setPreviewData(null);
          // Refresh the dirty baseline so the unsaved badge clears.
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

  // Save settings/labels/hooks (no schema changes path).
  const saveSettingsOnly = useCallback(
    (fieldDefinitions: FieldDefinition[]) => {
      if (!slug || !settings) return;
      const storedHooks = convertHooksToStoredFormat(hooks);
      updateCollection(
        {
          collectionName: slug,
          updates: {
            labels: {
              singular: settings.singularName,
              plural: settings.pluralName,
            },
            description: settings.description,
            icon: settings.icon,
            group: settings.adminGroup,
            order: settings.order,
            status: settings.status === true,
            // Why: useAsTitle + timestamps were removed from the modal in
            // PR B (system title is always the display; timestamps always
            // emitted). Backend defaults take over -- code-first config can
            // still override.
            fields: fieldDefinitions,
            hooks: storedHooks.length > 0 ? storedHooks : undefined,
          },
        },
        {
          onSuccess: () => toast.success("Collection updated"),
          onError: err => {
            const errorObj = err as { message?: string };
            toast.error(
              errorObj?.message ||
                "An unexpected error occurred while updating the collection."
            );
          },
        }
      );
    },
    [slug, settings, hooks, updateCollection]
  );

  // Top-level Save schema handler — preview first, branch on classification.
  const handleSave = useCallback(async () => {
    if (!slug) {
      toast.error("Collection slug is missing");
      return;
    }

    const fieldDefinitions = getValidatedFields();
    if (!fieldDefinitions) return;

    try {
      const preview = await schemaApi.preview(slug, fieldDefinitions);

      if (!preview.hasChanges) {
        // No schema changes — just persist labels/settings/hooks.
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

  // ----------------------------------------------------------------
  // Loading / error guards
  // ----------------------------------------------------------------

  if (!slug) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <h2 className="text-lg font-semibold text-foreground mb-2">
            Collection Not Found
          </h2>
          <p className="text-muted-foreground">
            No collection slug was provided.
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

  if (error || !collection || !settings) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <PageErrorFallback />
      </div>
    );
  }

  // ----------------------------------------------------------------
  // Render
  // ----------------------------------------------------------------

  const editingField =
    active.kind === "edit"
      ? builder.fields.find(f => f.id === active.fieldId)
      : null;

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <BuilderToolbar
        config={COLLECTION_BUILDER_CONFIG}
        name={settings.singularName || slug}
        icon={settings.icon}
        source={collection.source as "code" | "ui" | undefined}
        locked={isLocked}
        unsavedCount={unsavedCount}
        onOpenSettings={() => setActive({ kind: "settings" })}
        onOpenHooks={() => setActive({ kind: "hooks" })}
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
            // Reorder is driven by handleRowDragEnd above. This callback
            // exists for parents that need notification but our state
            // lives in the useFieldBuilder hook.
          }}
        />
      </DndContext>

      {/* Settings modal — opens for edit (mode="edit") only. */}
      {active.kind === "settings" && (
        <BuilderSettingsModal
          open
          mode="edit"
          config={COLLECTION_BUILDER_CONFIG}
          initialValues={settings}
          onCancel={() => setActive({ kind: "none" })}
          onSubmit={next => {
            setSettings(next);
            setActive({ kind: "none" });
          }}
        />
      )}

      {/* Field picker — opens off the toolbar's "+ Add field" or in-list +. */}
      {active.kind === "picker" && (
        <FieldPickerModal
          open
          excludedTypes={COLLECTION_BUILDER_CONFIG.picker.excludedTypes ?? []}
          onCancel={() => setActive({ kind: "none" })}
          // Why: PR C flow change. Don't append a placeholder field;
          // build a draft and open the sheet in create mode. The field
          // is only committed on Apply -- Cancel discards cleanly.
          onSelect={type =>
            setActive({
              kind: "create",
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

      {/* Field editor sheet -- create mode for a brand-new field that
          hasn't been committed yet. Apply appends to builder.fields. */}
      {active.kind === "create" && (
        <FieldEditorSheet
          open
          mode="create"
          field={active.draft}
          siblingNames={builder.fields.map(f => f.name)}
          readOnly={isLocked}
          onCancel={() => setActive({ kind: "none" })}
          onApply={next => {
            builder.setFields([...builder.fields, next]);
            setActive({ kind: "none" });
          }}
          // Why: Delete is hidden in create mode (sheet checks mode), so
          // this handler shouldn't be reachable. Provide a no-op so the
          // type contract is satisfied.
          onDelete={() => setActive({ kind: "none" })}
        />
      )}

      {/* Field editor sheet -- opens when a field card is clicked. */}
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

      {/* Hooks editor sheet — wraps the existing HooksEditor. */}
      {active.kind === "hooks" && (
        <HooksEditorSheet
          open
          hooks={hooks}
          fieldNames={fieldNames}
          onClose={() => setActive({ kind: "none" })}
          onChange={setHooks}
        />
      )}

      {/* Safe-change confirmation (additive). */}
      {previewData && previewData.classification === "safe" && (
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

      {/* Cancel / back navigation surfaced via the unused isSaving state */}
      {(isSaving || isApplyingSchema) && (
        <div aria-live="polite" className="sr-only">
          Saving collection changes…
        </div>
      )}
    </div>
  );
}
