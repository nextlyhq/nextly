"use client";

/**
 * Single Builder — Edit Page
 *
 * Thin wrapper around BuilderPageTemplate + useFieldBuilder.
 * Loads existing single schema data and initializes the builder.
 * Mode-specific: single form schema, settings, hooks, and update mutation.
 */

import { zodResolver } from "@hookform/resolvers/zod";
import { Skeleton } from "@revnixhq/ui";
import type React from "react";
import { useState, useCallback, useEffect, useMemo } from "react";
import { z } from "zod";

import {
  BuilderPageTemplate,
  HooksEditor,
  SafeChangeConfirmDialog,
  SchemaChangeDialog,
  type EnabledHook,
} from "@admin/components/features/schema-builder";
import * as Icons from "@admin/components/icons";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { toast } from "@admin/components/ui";
import { ROUTES } from "@admin/constants/routes";
import { useRestart } from "@admin/context/RestartContext";
import { useSingleSchema, useUpdateSingle } from "@admin/hooks/queries";
import { useFieldBuilder } from "@admin/hooks/useFieldBuilder";
import {
  convertToFieldDefinition,
  convertToBuilderField,
} from "@admin/lib/builder";
import { navigateTo } from "@admin/lib/navigation";
import type {
  FieldResolution,
  SchemaPreviewResponse,
  SchemaRenameResolution,
} from "@admin/services/schemaApi";
import { singleApi } from "@admin/services/singleApi";
import type { FieldDefinition } from "@admin/types/collection";
import type { ApiSingle } from "@admin/types/entities";

import { SingleSettings, type SingleSettingsData } from "./components";

const singleFormSchema = z.object({
  singularName: z
    .string()
    .min(1, "Name is required")
    .max(255, "Name is too long"),
});

type FormData = z.infer<typeof singleFormSchema>;

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

  const [settings, setSettings] = useState<SingleSettingsData>({});
  const [hooks, setHooks] = useState<EnabledHook[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);

  const [previewData, setPreviewData] = useState<SchemaPreviewResponse | null>(
    null
  );
  const [showSchemaDialog, setShowSchemaDialog] = useState(false);
  const [showSafeDialog, setShowSafeDialog] = useState(false);
  const [isApplyingSchema, setIsApplyingSchema] = useState(false);
  const { startRestart, stopRestart } = useRestart();

  const fieldNames = useMemo(
    () => builder.fields.filter(f => f.name?.trim()).map(f => f.name),
    [builder.fields]
  );

  const { mutate: updateSingle, isPending: isSaving } = useUpdateSingle();

  // Initialize form with single data
  useEffect(() => {
    if (single && !isInitialized) {
      if (single.locked) {
        navigateTo(ROUTES.SINGLES);
        return;
      }

      builder.form.reset({
        singularName: single.label || single.slug || "",
      });

      const schemaFields = single.fields || [];
      const builderFields = schemaFields.map((field, index: number) =>
        convertToBuilderField(field as unknown as FieldDefinition, index)
      );
      builder.setFields(builderFields);

      setSettings({
        description: single.description || "",
        admin: single.admin || {},
      });

      setIsInitialized(true);
    }
  }, [single, builder, isInitialized]);

  const getValidatedFields = useCallback((): FieldDefinition[] | null => {
    const userFields = builder.fields.filter(f => !f.isSystem);
    const validation = builder.validateFields(userFields);
    if (!validation.valid) {
      toast.error(validation.errorMessage);
      return null;
    }
    return userFields.map(convertToFieldDefinition);
  }, [builder]);

  const saveSingleSettings = useCallback(
    (fieldDefinitions: FieldDefinition[]) => {
      if (!slug) return;
      const formData = builder.form.getValues();
      updateSingle(
        {
          slug,
          updates: {
            label: formData.singularName,
            description: settings.description,
            fields: fieldDefinitions as unknown as ApiSingle["fields"],
            admin: settings.admin,
          },
        },
        {
          onSuccess: () => {
            toast.success("Single updated successfully");
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
    [builder, slug, updateSingle, settings]
  );

  const applySingleSchemaChanges = useCallback(
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
          const singleLabel =
            builder.form.getValues("singularName")?.trim() || slug;
          stopRestart(true, `${singleLabel} schema updated`);
          setShowSchemaDialog(false);
          setPreviewData(null);
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
    [slug, startRestart, stopRestart, builder.form]
  );

  const handleSave = useCallback(async () => {
    if (!slug) {
      toast.error("Single slug is missing");
      return;
    }

    const isValid = await builder.form.trigger();
    if (!isValid) {
      toast.error("Please fix the form errors before saving");
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
        saveSingleSettings(fieldDefinitions);
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
  }, [builder, slug, getValidatedFields, saveSingleSettings]);

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

  if (isLoading) {
    return (
      <div className="h-screen flex flex-col bg-background">
        <div className="p-6 border-b border-border">
          <Skeleton className="h-8 w-48 mb-2" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="flex-1 flex">
          <div className="flex-1 p-4">
            <Skeleton className="h-12 w-full mb-2" />
            <Skeleton className="h-12 w-full mb-2" />
            <Skeleton className="h-12 w-full" />
          </div>
          <div className="w-[400px] border-l border-border p-4">
            <Skeleton className="h-8 w-full mb-4" />
            <Skeleton className="h-48 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <PageErrorFallback />
      </div>
    );
  }

  return (
    <>
      <BuilderPageTemplate
        builder={builder}
        breadcrumbItems={[
          {
            href: ROUTES.DASHBOARD,
            label: "Dashboard",
            isDashboard: true,
          },
          { href: ROUTES.SINGLES, label: "Singles" },
        ]}
        breadcrumbCurrentLabel="Edit Single"
        headerIcon={<Icons.FileText className="h-5 w-5" />}
        headerTitle={builder.form.watch("singularName") || "Edit Single"}
        headerDescription="Define the structure of this global content"
        onSave={() => {
          void handleSave();
        }}
        onCancel={() => navigateTo(ROUTES.SINGLES)}
        isSaving={isSaving || isApplyingSchema}
        saveLabel="Update"
        entityType="single"
        settingsSlot={
          <>
            <SingleSettings
              settings={settings}
              onSettingsChange={setSettings}
              isExpanded={true}
              isAdvancedOpen={true}
              variant="none"
            />
            <HooksEditor
              hooks={hooks}
              onHooksChange={setHooks}
              fieldNames={fieldNames}
              isExpanded={true}
            />
          </>
        }
      />

      {previewData && previewData.classification === "safe" && (
        <SafeChangeConfirmDialog
          open={showSafeDialog}
          onOpenChange={setShowSafeDialog}
          collectionName={slug}
          changes={previewData.changes}
          onConfirm={() => {
            const fieldDefs = getValidatedFields();
            if (fieldDefs) {
              void applySingleSchemaChanges(
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
              void applySingleSchemaChanges(
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
    </>
  );
}
