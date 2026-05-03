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
  type BuilderSettingsValues,
  type EnabledHook,
} from "@admin/components/features/schema-builder";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { toast } from "@admin/components/ui";
import { useSingleSchema, useUpdateSingle } from "@admin/hooks/queries";
import { useFieldBuilder } from "@admin/hooks/useFieldBuilder";
import {
  convertHooksToStoredFormat,
  convertToBuilderField,
  convertToFieldDefinition,
  DEFAULT_SYSTEM_FIELDS,
} from "@admin/lib/builder";
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
  | { kind: "edit"; fieldId: string }
  | { kind: "hooks" };

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
  const [hooks, setHooks] = useState<EnabledHook[]>([]);
  const [active, setActive] = useState<ActiveOverlay>({ kind: "none" });
  const [isInitialized, setIsInitialized] = useState(false);
  const [originalFieldsSnapshot, setOriginalFieldsSnapshot] = useState<
    string | null
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

    setOriginalFieldsSnapshot(
      JSON.stringify(allFields.filter(f => !f.isSystem).map(f => f.id))
    );

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
  const fieldNames = useMemo(
    () => builder.fields.filter(f => f.name?.trim()).map(f => f.name),
    [builder.fields]
  );

  const unsavedCount = useMemo(() => {
    if (!originalFieldsSnapshot) return 0;
    const currentSnapshot = JSON.stringify(
      builder.fields.filter(f => !f.isSystem).map(f => f.id)
    );
    return currentSnapshot !== originalFieldsSnapshot ? 1 : 0;
  }, [builder.fields, originalFieldsSnapshot]);

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
    const storedHooks = convertHooksToStoredFormat(hooks);

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
          ...(storedHooks.length > 0 ? { hooks: storedHooks } : {}),
        },
      },
      {
        onSuccess: () => {
          toast.success("Single updated");
          setOriginalFieldsSnapshot(
            JSON.stringify(
              builder.fields.filter(f => !f.isSystem).map(f => f.id)
            )
          );
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
  }, [builder, hooks, settings, slug, updateSingle]);

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
        icon={settings.icon}
        source={single.source as "code" | "ui" | undefined}
        locked={isLocked}
        unsavedCount={unsavedCount}
        onOpenSettings={() => setActive({ kind: "settings" })}
        onOpenHooks={() => setActive({ kind: "hooks" })}
        onSave={() => handleSave()}
      />

      <DndContext
        sensors={builder.sensors}
        onDragStart={builder.handleDragStart}
        onDragEnd={(event: DragEndEvent) => builder.handleDragEnd(event)}
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

      {active.kind === "hooks" && (
        <HooksEditorSheet
          open
          hooks={hooks}
          fieldNames={fieldNames}
          onClose={() => setActive({ kind: "none" })}
          onChange={setHooks}
        />
      )}

      {isSaving && (
        <div aria-live="polite" className="sr-only">
          Saving Single changes…
        </div>
      )}
    </div>
  );
}
