"use client";

/**
 * Single Builder — Edit Page
 *
 * Mirrors the Collection edit page architecture:
 *   BuilderToolbar at top, BuilderFieldList in the body inside DndContext,
 *   overlays (settings modal / picker / editor sheet / hooks sheet) mounted
 *   lazily based on a single ActiveOverlay union.
 *
 * Singles do not run the schema-change preview (per-kind audit § 2). Save
 * goes straight through useUpdateSingle. Locked code-first Singles render
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
  type BuilderSettingsValues,
} from "@admin/components/features/schema-builder";
import type { BuilderField } from "@admin/components/features/schema-builder/types";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { toast } from "@admin/components/ui";
import { useSingleSchema, useUpdateSingle } from "@admin/hooks/queries";
import { useFieldBuilder } from "@admin/hooks/useFieldBuilder";
import {
  convertToBuilderField,
  convertToFieldDefinition,
  DEFAULT_SYSTEM_FIELDS,
} from "@admin/lib/builder";
import { countDirtyFields } from "@admin/lib/builder/dirty-tracking";
import { packIntoRows, parseWidth } from "@admin/lib/builder/reflow";
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
  | { kind: "picker"; insertAt: number }
  // Why: NEW in PR C. Sheet renders in create mode against this draft;
  // on Apply we append, on Cancel we discard.
  | { kind: "create"; draft: BuilderField }
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

  const { mutate: updateSingle, isPending: isSaving } = useUpdateSingle();

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
      // Status from PR 1's backend addition; defaults false for legacy
      // Singles written before the column existed.
      status: (single as { status?: boolean }).status === true,
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

  const handleSave = useCallback(() => {
    if (!slug || !settings) {
      toast.error("Single slug is missing");
      return;
    }

    const userFields = builder.fields.filter(
      f => !f.isSystem && f.name !== "title" && f.name !== "slug"
    );
    const validation = builder.validateFields(userFields);
    if (!validation.valid) {
      toast.error(validation.errorMessage);
      return;
    }

    const fieldDefinitions = userFields.map(convertToFieldDefinition);

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
            ...(settings.order !== undefined ? { order: settings.order } : {}),
          },
          // Status pass-through; the typed Partial<ApiSingle> doesn't
          // include status yet, so cast at the boundary.
          ...(settings.status === true ? { status: true } : {}),
          // Why: hooks payload removed in PR D -- the Singles page
          // never hydrated `hooks` state from `single.hooks`, so this
          // spread always sent `undefined`. Hooks for Singles are still
          // configurable code-first via nextly.config.ts.
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
  }, [builder, settings, slug, updateSingle]);

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

  const editingField =
    active.kind === "edit"
      ? builder.fields.find(f => f.id === active.fieldId)
      : null;

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <BuilderToolbar
        config={SINGLE_BUILDER_CONFIG}
        name={settings.singularName || slug}
        locked={isLocked}
        unsavedCount={unsavedCount}
        onOpenSettings={() => setActive({ kind: "settings" })}
        onSave={() => handleSave()}
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
            // Reorder is driven by handleDragEnd above; useFieldBuilder
            // owns the sortable wiring.
          }}
        />
      </DndContext>

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
          excludedTypes={SINGLE_BUILDER_CONFIG.picker.excludedTypes ?? []}
          onCancel={() => setActive({ kind: "none" })}
          // Why: PR C flow change -- pick opens sheet in create mode.
          // Field commits on Apply, discards on Cancel.
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
          onDelete={() => setActive({ kind: "none" })}
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

      {/* Hooks UI removed in PR D (feedback Section 2). */}

      {isSaving && (
        <div aria-live="polite" className="sr-only">
          Saving Single changes…
        </div>
      )}
    </div>
  );
}
