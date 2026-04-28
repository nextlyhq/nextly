/**
 * Collection Builder — Edit Page
 *
 * Thin wrapper around BuilderPageTemplate + useFieldBuilder.
 * Loads existing collection data and initializes the builder.
 * Mode-specific: collection form schema, settings, hooks, and update mutation.
 */

import { zodResolver } from "@hookform/resolvers/zod";
import { Skeleton } from "@revnixhq/ui";
import type React from "react";
import { useState, useCallback, useEffect, useMemo } from "react";
import { z } from "zod";

import {
  BuilderPageTemplate,
  CollectionSettings,
  HooksEditor,
  SafeChangeConfirmDialog,
  SchemaChangeDialog,
  type CollectionSettingsData,
  type EnabledHook,
} from "@admin/components/features/schema-builder";
import * as Icons from "@admin/components/icons";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { toast } from "@admin/components/ui";
import { ROUTES } from "@admin/constants/routes";
import { useRestart } from "@admin/context/RestartContext";
import { useCollection, useUpdateCollection } from "@admin/hooks/queries";
import { useFieldBuilder } from "@admin/hooks/useFieldBuilder";
import {
  convertToFieldDefinition,
  convertToBuilderField,
  convertHooksToStoredFormat,
  DEFAULT_SYSTEM_FIELDS,
} from "@admin/lib/builder";
import { navigateTo } from "@admin/lib/navigation";
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

type IconMap = Record<string, React.ComponentType<{ className?: string }>>;
const iconMap = Icons as unknown as IconMap;

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

  const [collectionSettings, setCollectionSettings] =
    useState<CollectionSettingsData>({
      description: "",
      timestamps: true,
      admin: { icon: "Database" },
      hooks: [],
    });

  const [hooks, setHooks] = useState<EnabledHook[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);

  // Schema change confirmation dialog state
  const [previewData, setPreviewData] = useState<SchemaPreviewResponse | null>(
    null
  );
  const [showSchemaDialog, setShowSchemaDialog] = useState(false);
  // Task 11: safe changes now show a lightweight confirmation instead of
  // applying silently. Keeps the "all changes require explicit confirm"
  // user model consistent between code-first and UI-first flows.
  const [showSafeDialog, setShowSafeDialog] = useState(false);
  const [isApplyingSchema, setIsApplyingSchema] = useState(false);
  const { startRestart, stopRestart } = useRestart();

  const fieldNames = useMemo(
    () => builder.fields.filter(f => f.name?.trim()).map(f => f.name),
    [builder.fields]
  );

  const { mutate: updateCollection, isPending: isSaving } =
    useUpdateCollection();

  // Initialize form with collection data
  useEffect(() => {
    if (collection && !isInitialized) {
      if (collection.locked) {
        navigateTo(ROUTES.COLLECTIONS);
        return;
      }

      builder.form.reset({
        singularName:
          collection.labels?.singular ||
          collection.label ||
          collection.name ||
          "",
        pluralName: collection.labels?.plural || collection.label || "",
      });

      const schemaFields = getCollectionFields(collection);
      const userSchemaFields = schemaFields.filter(
        (f: FieldDefinition) => f.name !== "title" && f.name !== "slug"
      );
      const builderFields = userSchemaFields.map(
        (field: FieldDefinition, index: number) =>
          convertToBuilderField(field, index)
      );
      builder.setFields([...DEFAULT_SYSTEM_FIELDS, ...builderFields]);

      setCollectionSettings({
        description: collection.description || "",
        timestamps: true,
        admin: {
          icon: collection.admin?.icon || "Database",
          group: collection.admin?.group || "",
          useAsTitle: collection.admin?.useAsTitle,
          hidden: collection.admin?.hidden,
          order: (collection.admin as Record<string, unknown>)?.order as
            | number
            | undefined,
          sidebarGroup: (collection.admin as Record<string, unknown>)
            ?.sidebarGroup as string | undefined,
        },
        hooks: [],
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
    }
  }, [collection, builder, isInitialized]);

  // Build validated field definitions from the builder state.
  // Shared by both the preview and settings-only save paths.
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

  // Apply schema changes after confirmation (or directly for safe changes).
  // F4 Option E PR 5: renameResolutions are the per-candidate "rename" /
  // "drop_and_add" picks the dialog collected. Empty array = no renames
  // detected (or pure-additive change).
  const applySchemaChanges = useCallback(
    async (
      fieldDefinitions: FieldDefinition[],
      schemaVersion: number,
      resolutions: Record<string, FieldResolution>,
      renameResolutions: SchemaRenameResolution[]
    ) => {
      if (!slug) return;
      setIsApplyingSchema(true);
      // Suppress the "schema updated externally" toast from the fetcher
      // since this change is initiated by us, not an external source
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
          stopRestart(true, "Schema changes applied successfully");
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
    [slug, startRestart, stopRestart]
  );

  // Save non-schema settings (labels, icon, group, etc.) via existing mutation
  const saveCollectionSettings = useCallback(
    (fieldDefinitions: FieldDefinition[]) => {
      if (!slug) return;
      const formData = builder.form.getValues();
      const singularName = formData.singularName.trim();
      const pluralName = formData.pluralName?.trim() || undefined;
      const storedHooks = convertHooksToStoredFormat(hooks);
      updateCollection(
        {
          collectionName: slug,
          updates: {
            labels: {
              singular: singularName,
              plural: pluralName,
            },
            icon: collectionSettings.admin?.icon,
            group: collectionSettings.admin?.group,
            useAsTitle: collectionSettings.admin?.useAsTitle,
            hidden: collectionSettings.admin?.hidden,
            order: collectionSettings.admin?.order,
            sidebarGroup: collectionSettings.admin?.sidebarGroup,
            fields: fieldDefinitions,
            hooks: storedHooks.length > 0 ? storedHooks : undefined,
          },
        },
        {
          onSuccess: () => toast.success("Collection updated successfully"),
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
    [builder, slug, updateCollection, collectionSettings, hooks]
  );

  // Main save handler: preview schema changes first, then confirm or auto-apply
  const handleSave = useCallback(async () => {
    if (!slug) {
      toast.error("Collection slug is missing");
      return;
    }

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

    const fieldDefinitions = getValidatedFields();
    if (!fieldDefinitions) return;

    // Preview schema changes before applying
    try {
      const preview = await schemaApi.preview(slug, fieldDefinitions);

      if (!preview.hasChanges) {
        // No schema changes -- just update labels/settings via existing mutation
        saveCollectionSettings(fieldDefinitions);
        return;
      }

      if (preview.classification === "safe") {
        // Task 11: safe changes now prompt via SafeChangeConfirmDialog rather
        // than applying silently. Always-confirm model means no surprise
        // restarts and matches the code-first flow where the user also
        // confirms before the wrapper applies.
        setPreviewData(preview);
        setShowSafeDialog(true);
        return;
      }

      // Destructive or interactive changes -- show confirmation dialog
      setPreviewData(preview);
      setShowSchemaDialog(true);
    } catch (err) {
      const errorObj = err as { message?: string };
      toast.error(errorObj?.message || "Failed to preview schema changes");
    }
  }, [builder, slug, getValidatedFields, saveCollectionSettings]);

  // Resolve the header icon from settings
  const headerIconName = collectionSettings.admin?.icon || "Database";
  const HeaderIcon = iconMap[headerIconName] || Icons.Database;

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
            icon: <Icons.Home className="w-4 h-4" />,
          },
          { href: ROUTES.COLLECTIONS, label: "Collections" },
        ]}
        breadcrumbCurrentLabel="Edit Collection"
        headerIcon={<HeaderIcon className="h-5 w-5" />}
        headerTitle={builder.form.watch("singularName") || "Edit Collection"}
        headerDescription="Manage your collection schema and settings."
        onSave={() => {
          void handleSave();
        }}
        onCancel={() => navigateTo(ROUTES.COLLECTIONS)}
        isSaving={isSaving || isApplyingSchema}
        saveLabel="Update"
        entityType="collection"
        settingsSlot={
          <>
            <CollectionSettings
              settings={collectionSettings}
              onSettingsChange={setCollectionSettings}
              fields={builder.fields}
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

      {/* Task 11: safe-change lightweight dialog */}
      {previewData && previewData.classification === "safe" && (
        <SafeChangeConfirmDialog
          open={showSafeDialog}
          onOpenChange={setShowSafeDialog}
          collectionName={slug}
          changes={previewData.changes}
          onConfirm={() => {
            const fieldDefs = getValidatedFields();
            if (fieldDefs) {
              // Safe-only path: no interactive resolutions, no rename
              // candidates expected (the safe dialog only renders for
              // pure-additive changes).
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

      {/* Schema change confirmation dialog -- shown for destructive/interactive changes */}
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
    </>
  );
}
