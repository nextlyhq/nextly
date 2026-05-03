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

import { BuilderPageTemplate } from "@admin/components/features/schema-builder";
import * as Icons from "@admin/components/icons";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { toast } from "@admin/components/ui";
import { ROUTES } from "@admin/constants/routes";
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

    const userFields = builder.fields.filter(f => !f.isSystem);
    const validation = builder.validateFields(userFields);
    if (!validation.valid) {
      toast.error(validation.errorMessage);
      return;
    }

    const formData = builder.form.getValues();
    const fieldDefinitions = userFields.map(convertToFieldDefinition);

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
        onSuccess: () => {
          toast.success("Component updated successfully");
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
  }, [builder, slug, updateComponent, componentSettings]);

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
        <div className="p-6  border-b border-primary/5">
          <Skeleton className="h-8 w-48 mb-2" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="flex-1 flex">
          <div className="flex-1 p-4">
            <Skeleton className="h-12 w-full mb-2" />
            <Skeleton className="h-12 w-full mb-2" />
            <Skeleton className="h-12 w-full" />
          </div>
          <div className="w-[400px]  border-l border-primary/5 p-4">
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
      isSaving={isSaving}
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
  );
}
