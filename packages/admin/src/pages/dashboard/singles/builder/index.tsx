/**
 * Single Builder — Create Page
 *
 * Thin wrapper around BuilderPageTemplate + useFieldBuilder.
 * Mode-specific: single form schema, settings, hooks, and create mutation.
 */

import { zodResolver } from "@hookform/resolvers/zod";
import type React from "react";
import { useState, useCallback, useMemo } from "react";
import { z } from "zod";

import {
  BuilderPageTemplate,
  HooksEditor,
  type EnabledHook,
} from "@admin/components/features/schema-builder";
import * as Icons from "@admin/components/icons";
import { toast } from "@admin/components/ui";
import { ROUTES } from "@admin/constants/routes";
import { useCreateSingle } from "@admin/hooks/queries";
import { useFieldBuilder } from "@admin/hooks/useFieldBuilder";
import {
  toSnakeName,
  convertToFieldDefinition,
  convertHooksToStoredFormat,
  DEFAULT_SYSTEM_FIELDS,
} from "@admin/lib/builder";
import { navigateTo } from "@admin/lib/navigation";
import type { ApiSingle } from "@admin/types/entities";

import { SingleSettings, type SingleSettingsData } from "./components";

const singleFormSchema = z.object({
  singularName: z
    .string()
    .min(1, "Name is required")
    .max(255, "Name is too long"),
});

type FormData = z.infer<typeof singleFormSchema>;

export default function SingleBuilderPage(): React.ReactElement {
  const builder = useFieldBuilder<FormData>({
    resolver: zodResolver(singleFormSchema),
    defaultValues: { singularName: "" },
    initialFields: DEFAULT_SYSTEM_FIELDS,
  });

  const [settings, setSettings] = useState<SingleSettingsData>({});
  const [hooks, setHooks] = useState<EnabledHook[]>([]);
  const [isHooksExpanded, setIsHooksExpanded] = useState(false);

  const fieldNames = useMemo(
    () => builder.fields.filter(f => f.name?.trim()).map(f => f.name),
    [builder.fields]
  );

  const { mutate: createSingle, isPending: isSaving } = useCreateSingle();

  const handleSave = useCallback(async () => {
    const isValid = await builder.form.trigger();
    if (!isValid) {
      const errors = builder.form.formState.errors;
      if (errors.singularName) {
        builder.setSidebarTab("settings");
        toast.error(
          "Single name is required. Please fill it in the Settings tab."
        );
      } else {
        toast.error("Please fix the form errors before saving");
      }
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
    const storedHooks = convertHooksToStoredFormat(hooks);

    createSingle(
      {
        slug: toSnakeName(formData.singularName),
        label: formData.singularName,
        description: settings.description,
        fields: fieldDefinitions as unknown as ApiSingle["fields"],
        hooks: storedHooks.length > 0 ? storedHooks : undefined,
        admin: settings.admin,
      } as Partial<ApiSingle>,
      {
        onSuccess: () => {
          toast.success("Single created successfully");
          navigateTo(ROUTES.SINGLES);
        },
        onError: err => {
          const error = err as { message?: string };
          toast.error(
            error?.message ||
              "An unexpected error occurred while creating the Single."
          );
        },
      }
    );
  }, [builder, hooks, settings, createSingle]);

  return (
    <BuilderPageTemplate
      builder={builder}
      breadcrumbItems={[
        {
          href: ROUTES.DASHBOARD,
          label: "Dashboard",
          icon: <Icons.Home className="w-4 h-4" />,
        },
        { href: ROUTES.SINGLES, label: "Singles" },
      ]}
      breadcrumbCurrentLabel="Create Single"
      headerTitle="Create Single"
      headerDescription="Design a new single global content type."
      onSave={() => { void handleSave(); }}
      onCancel={() => navigateTo(ROUTES.SINGLES)}
      isSaving={isSaving}
      saveLabel="Create"
      entityType="single"
      settingsSlot={
        <>
          <SingleSettings
            settings={settings}
            onSettingsChange={setSettings}
            variant="none"
          />
          <HooksEditor
            hooks={hooks}
            onHooksChange={setHooks}
            fieldNames={fieldNames}
            isExpanded={isHooksExpanded}
            onExpandedChange={setIsHooksExpanded}
          />
        </>
      }
    />
  );
}
