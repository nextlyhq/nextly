"use client";

/**
 * Component Builder — Create Page
 *
 * Thin wrapper around BuilderPageTemplate + useFieldBuilder.
 * Mode-specific: component form schema, settings, and create mutation.
 * Components do not have hooks (unlike collections/singles).
 */

import { zodResolver } from "@hookform/resolvers/zod";
import type React from "react";
import { useState, useCallback } from "react";
import { z } from "zod";

import { BuilderPageTemplate } from "@admin/components/features/schema-builder";
import * as Icons from "@admin/components/icons";
import { toast } from "@admin/components/ui";
import { ROUTES } from "@admin/constants/routes";
import { useCreateComponent } from "@admin/hooks/queries/useComponents";
import { useFieldBuilder } from "@admin/hooks/useFieldBuilder";
import {
  toSnakeName,
  convertToFieldDefinition,
  DEFAULT_SYSTEM_FIELDS,
} from "@admin/lib/builder";
import { navigateTo } from "@admin/lib/navigation";

import { ComponentSettings, type ComponentSettingsData } from "./components";

const componentFormSchema = z.object({
  singularName: z
    .string()
    .min(1, "Name is required")
    .max(255, "Name is too long"),
});

type FormData = z.infer<typeof componentFormSchema>;

export default function ComponentBuilderPage(): React.ReactElement {
  const builder = useFieldBuilder<FormData>({
    resolver: zodResolver(componentFormSchema),
    defaultValues: { singularName: "" },
    initialFields: DEFAULT_SYSTEM_FIELDS,
  });

  const [componentSettings, setComponentSettings] =
    useState<ComponentSettingsData>({
      description: "",
      admin: { icon: "Puzzle" },
    });

  const { mutate: createComponent, isPending: isSaving } = useCreateComponent();

  const handleSave = useCallback(async () => {
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

    createComponent(
      {
        slug: toSnakeName(formData.singularName),
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
      {
        onSuccess: () => {
          toast.success("Component created successfully");
          navigateTo(ROUTES.COMPONENTS);
        },
        onError: err => {
          const error = err as { message?: string };
          toast.error(
            error?.message ||
              "An unexpected error occurred while creating the component."
          );
        },
      }
    );
  }, [builder, componentSettings, createComponent]);

  return (
    <BuilderPageTemplate
      builder={builder}
      breadcrumbItems={[
        {
          href: ROUTES.DASHBOARD,
          label: "Dashboard",
          icon: <Icons.Home className="w-4 h-4" />,
        },
        { href: ROUTES.COMPONENTS, label: "Components" },
      ]}
      breadcrumbCurrentLabel="Create Component"
      headerTitle="Create Component"
      headerDescription="Design a reusable component with custom fields."
      onSave={() => { void handleSave(); }}
      onCancel={() => navigateTo(ROUTES.COMPONENTS)}
      isSaving={isSaving}
      saveLabel="Save Component"
      entityType="component"
      settingsSlot={
        <ComponentSettings
          settings={componentSettings}
          onSettingsChange={setComponentSettings}
          variant="none"
          isExpanded={true}
        />
      }
    />
  );
}
