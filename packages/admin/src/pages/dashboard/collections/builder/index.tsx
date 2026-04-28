/**
 * Collection Builder — Create Page
 *
 * Thin wrapper around BuilderPageTemplate + useFieldBuilder.
 * Mode-specific: collection form schema, settings, hooks, and create mutation.
 */

import { zodResolver } from "@hookform/resolvers/zod";
import type React from "react";
import { useState, useCallback, useMemo } from "react";
import { z } from "zod";

import {
  BuilderPageTemplate,
  CollectionSettings,
  HooksEditor,
  type CollectionSettingsData,
  type EnabledHook,
} from "@admin/components/features/schema-builder";
import * as Icons from "@admin/components/icons";
import { toast } from "@admin/components/ui";
import { ROUTES } from "@admin/constants/routes";
import { useCreateCollection } from "@admin/hooks/queries";
import { useFieldBuilder } from "@admin/hooks/useFieldBuilder";
import {
  toSnakeName,
  convertToFieldDefinition,
  convertHooksToStoredFormat,
  DEFAULT_SYSTEM_FIELDS,
} from "@admin/lib/builder";
import { navigateTo } from "@admin/lib/navigation";
import type { FieldDefinition } from "@admin/types/collection";

const collectionFormSchema = z.object({
  singularName: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(255, "Name is too long"),
  pluralName: z.string().trim().max(255, "Plural name is too long").optional(),
});

type FormData = z.infer<typeof collectionFormSchema>;

export default function CollectionBuilderPage(): React.ReactElement {
  const builder = useFieldBuilder<FormData>({
    resolver: zodResolver(collectionFormSchema),
    defaultValues: { singularName: "", pluralName: "" },
    initialFields: DEFAULT_SYSTEM_FIELDS,
  });

  const [collectionSettings, setCollectionSettings] =
    useState<CollectionSettingsData>({
      description: "",
      timestamps: true,
      admin: { icon: "Folder" },
      hooks: [],
    });

  const [hooks, setHooks] = useState<EnabledHook[]>([]);
  const [isHooksExpanded, setIsHooksExpanded] = useState(false);

  const fieldNames = useMemo(
    () => builder.fields.filter(f => f.name?.trim()).map(f => f.name),
    [builder.fields]
  );

  const { mutate: createCollection, isPending: isSaving } =
    useCreateCollection();

  const handleSave = useCallback(async () => {
    const isValid = await builder.form.trigger();
    if (!isValid) {
      const errors = builder.form.formState.errors;
      if (errors.singularName) {
        builder.setSidebarTab("settings");
        toast.error(
          "Collection name is required. Please fill it in the Settings tab."
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
    const singularName = formData.singularName.trim();
    const pluralName = formData.pluralName?.trim() || undefined;
    const fieldDefinitions: FieldDefinition[] = userFields.map(
      convertToFieldDefinition
    );
    const storedHooks = convertHooksToStoredFormat(hooks);
    const derivedSlug = toSnakeName(singularName);

    createCollection(
      {
        name: derivedSlug,
        labels: {
          singular: singularName,
          plural: pluralName,
        },
        description: collectionSettings.description,
        icon: collectionSettings.admin?.icon,
        group: collectionSettings.admin?.group,
        useAsTitle: collectionSettings.admin?.useAsTitle,
        hidden: collectionSettings.admin?.hidden,
        order: collectionSettings.admin?.order,
        sidebarGroup: collectionSettings.admin?.sidebarGroup,
        fields: fieldDefinitions,
        hooks: storedHooks.length > 0 ? storedHooks : undefined,
      },
      {
        onSuccess: () => {
          toast.success("Collection created successfully");
          navigateTo(ROUTES.COLLECTIONS);
        },
        onError: err => {
          const error = err as { message?: string };
          toast.error(
            error?.message ||
              "An unexpected error occurred while creating the collection."
          );
        },
      }
    );
  }, [builder, hooks, collectionSettings, createCollection]);

  return (
    <BuilderPageTemplate
      builder={builder}
      breadcrumbItems={[
        {
          href: ROUTES.DASHBOARD,
          label: "Dashboard",
          icon: <Icons.Home className="w-4 h-4" />,
        },
        { href: ROUTES.COLLECTIONS, label: "Collections" },
      ]}
      breadcrumbCurrentLabel="Create Collection"
      headerTitle="Create Collection"
      headerDescription="Design a new collection with custom fields and settings."
      onSave={() => { void handleSave(); }}
      onCancel={() => navigateTo(ROUTES.COLLECTIONS)}
      isSaving={isSaving}
      saveLabel="Create"
      entityType="collection"
      settingsSlot={
        <>
          <CollectionSettings
            settings={collectionSettings}
            onSettingsChange={setCollectionSettings}
            fields={builder.fields}
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
