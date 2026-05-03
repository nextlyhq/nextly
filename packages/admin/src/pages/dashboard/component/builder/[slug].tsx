"use client";

/**
 * Component Builder — Edit Page
 *
 * Thin wrapper around BuilderPageTemplate + useFieldBuilder.
 * Loads existing component data and initializes the builder.
 * Components do not have hooks (unlike collections/singles).
 */

import { zodResolver } from "@hookform/resolvers/zod";
import { Skeleton } from "@revnixhq/ui";
import type React from "react";
import { useState, useCallback, useEffect } from "react";
import { z } from "zod";

import {
  BuilderPageTemplate,
  SafeChangeConfirmDialog,
  SchemaChangeDialog,
} from "@admin/components/features/schema-builder";
import * as Icons from "@admin/components/icons";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { toast } from "@admin/components/ui";
import { ROUTES } from "@admin/constants/routes";
import { useRestart } from "@admin/context/RestartContext";
import {
  useComponent,
  useUpdateComponent,
} from "@admin/hooks/queries/useComponents";
import { useFieldBuilder } from "@admin/hooks/useFieldBuilder";
import {
  convertToFieldDefinition,
  convertToBuilderField,
} from "@admin/lib/builder";
import { navigateTo } from "@admin/lib/navigation";
import { componentApi } from "@admin/services/componentApi";
import type {
  FieldResolution,
  SchemaPreviewResponse,
  SchemaRenameResolution,
} from "@admin/services/schemaApi";
import type { FieldDefinition } from "@admin/types/collection";
import type { SchemaField } from "@admin/types/entities";

import { ComponentSettings, type ComponentSettingsData } from "./components";

const componentFormSchema = z.object({
  singularName: z
    .string()
    .min(1, "Name is required")
    .max(255, "Name is too long"),
});

type FormData = z.infer<typeof componentFormSchema>;

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

  const [componentSettings, setComponentSettings] =
    useState<ComponentSettingsData>({
      description: "",
      admin: { icon: "Puzzle" },
    });

  const [isInitialized, setIsInitialized] = useState(false);
  const { mutate: updateComponent, isPending: isSaving } = useUpdateComponent();

  const [previewData, setPreviewData] = useState<SchemaPreviewResponse | null>(
    null
  );
  const [showSchemaDialog, setShowSchemaDialog] = useState(false);
  const [showSafeDialog, setShowSafeDialog] = useState(false);
  const [isApplyingSchema, setIsApplyingSchema] = useState(false);
  const { startRestart, stopRestart } = useRestart();

  // Initialize form with component data
  useEffect(() => {
    if (component && !isInitialized) {
      if (component.locked) {
        navigateTo(ROUTES.COMPONENTS);
        return;
      }

      builder.form.reset({
        singularName: component.label || component.slug || "",
      });

      const componentFields = component.fields || [];
      const builderFields = componentFields.map(
        (field: SchemaField, index: number) =>
          convertToBuilderField(field as unknown as FieldDefinition, index)
      );
      builder.setFields(builderFields);

      setComponentSettings({
        description: component.description || "",
        admin: {
          category: component.admin?.category || "",
          icon: component.admin?.icon || "Puzzle",
          hidden: component.admin?.hidden || false,
          imageURL: component.admin?.imageURL || "",
        },
      });

      setIsInitialized(true);
    }
  }, [component, builder, isInitialized]);

  const getValidatedFields = useCallback((): FieldDefinition[] | null => {
    const userFields = builder.fields.filter(f => !f.isSystem);
    const validation = builder.validateFields(userFields);
    if (!validation.valid) {
      toast.error(validation.errorMessage);
      return null;
    }
    return userFields.map(convertToFieldDefinition);
  }, [builder]);

  const saveComponentSettings = useCallback(
    (fieldDefinitions: FieldDefinition[]) => {
      if (!slug) return;
      const formData = builder.form.getValues();
      updateComponent(
        {
          componentSlug: slug,
          updates: {
            label: formData.singularName,
            description: componentSettings.description,
            fields: fieldDefinitions as unknown as Record<string, unknown>[],
            admin: componentSettings.admin
              ? {
                  category: componentSettings.admin.category,
                  icon: componentSettings.admin.icon,
                  hidden: componentSettings.admin.hidden,
                  imageURL: componentSettings.admin.imageURL,
                }
              : undefined,
          },
        },
        {
          onSuccess: () => toast.success("Component updated successfully"),
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
    [builder, slug, updateComponent, componentSettings]
  );

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
          const componentLabel =
            builder.form.getValues("singularName")?.trim() || slug;
          stopRestart(true, `${componentLabel} schema updated`);
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
      toast.error("Component slug is missing");
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
      const preview = await componentApi.previewSchemaChanges(
        slug,
        fieldDefinitions
      );

      if (!preview.hasChanges) {
        saveComponentSettings(fieldDefinitions);
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
  }, [builder, slug, getValidatedFields, saveComponentSettings]);

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
          { href: ROUTES.COMPONENTS, label: "Components" },
        ]}
        breadcrumbCurrentLabel="Edit Component"
        headerIcon={<Icons.Puzzle className="h-5 w-5" />}
        headerTitle={builder.form.watch("singularName") || "Edit Component"}
        headerDescription="Define the internal structure of this component"
        onSave={() => {
          void handleSave();
        }}
        onCancel={() => navigateTo(ROUTES.COMPONENTS)}
        isSaving={isSaving || isApplyingSchema}
        saveLabel="Update"
        entityType="component"
        settingsSlot={
          <ComponentSettings
            settings={componentSettings}
            onSettingsChange={setComponentSettings}
            isExpanded={true}
            isAdvancedOpen={true}
            variant="none"
          />
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
    </>
  );
}
