"use client";

/**
 * Collection Builder — Edit Page
 *
 * Loads a collection, maps it onto the shared builder state, and owns the save
 * pipeline: preview the schema change, branch on its classification, apply, and
 * mirror the result into the committable ui-schema.json.
 *
 * Everything the three builder kinds draw identically — the toolbar, the field
 * list and its drag context, the overlays, the schema-change confirmation —
 * comes from BuilderPageLayout. What is here is what a collection does
 * differently: its settings shape, its API, and its copy.
 *
 * Code-first preservation: locked collections render the page in readOnly
 * mode (formerly redirected to the listing). Devs can now visually
 * inspect the schema; every editing affordance is disabled.
 */

import { zodResolver } from "@hookform/resolvers/zod";
import type React from "react";
import { useCallback, useState } from "react";
import { z } from "zod";

import {
  BuilderErrorScreen,
  BuilderLoadingScreen,
  BuilderNotFoundScreen,
  BuilderPageLayout,
  BuilderSchemaChangeDialogs,
  SchemaBuilderSlots,
  type ActiveOverlay,
  type BuilderSettingsValues,
  type EnabledHook,
} from "@admin/components/features/schema-builder";
import { toast } from "@admin/components/ui";
import { useCollection, useUpdateCollection } from "@admin/hooks/queries";
import { useBuilderEntityState } from "@admin/hooks/useBuilderEntityState";
import { useBuilderFieldActions } from "@admin/hooks/useBuilderFieldActions";
import { useFieldBuilder } from "@admin/hooks/useFieldBuilder";
import { useSchemaChangeConfirmation } from "@admin/hooks/useSchemaChangeConfirmation";
import {
  displayLabel,
  mirrorSchemaFile,
  useSchemaSave,
} from "@admin/hooks/useSchemaSave";
import { convertHooksToStoredFormat } from "@admin/lib/builder";
import { settingsAreDirty } from "@admin/lib/builder/settings-dirty";
import { collectionEntityFromSettings } from "@admin/lib/builder/settings-to-manifest";
import { COLLECTION_BUILDER_CONFIG } from "@admin/pages/dashboard/collections/builder/builder-config";
import { schemaApi } from "@admin/services/schemaApi";
import { schemaFileApi } from "@admin/services/schemaFileApi";
// Two import statements are intentional. With isolatedModules + esbuild,
// merging these into a single `import { type FieldDefinition,
// getCollectionFields }` block has historically been collapsed by
// prettier into both being type-only, which strips getCollectionFields
// at runtime (it's a function, not a type). See main's ce29d67.
import type { Collection, FieldDefinition } from "@admin/types/collection";
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
 * The names a collection displays under. Both fall back through `label`, which
 * is what rows written before the labels block carry, and the singular falls
 * back once more to the machine name so a row can never render nameless.
 */
function collectionLabels(collection: Collection): {
  singular: string;
  plural: string;
} {
  return {
    singular:
      collection.labels?.singular || collection.label || collection.name || "",
    plural: collection.labels?.plural || collection.label || "",
  };
}

/**
 * The settings a loaded collection opens the builder with.
 *
 * Several switches read "on unless explicitly turned off": the registry stores
 * a resolved config, so an absent opt-out and a null config both mean the
 * default is in force, and only an explicit `false` turns the switch off.
 */
function collectionSettings(
  collection: Collection,
  slug: string | undefined
): BuilderSettingsValues {
  const { singular, plural } = collectionLabels(collection);
  return {
    singularName: singular,
    pluralName: plural,
    slug: slug ?? "",
    description: collection.description || "",
    icon: collection.admin?.icon || "Database",
    // The Draft/Published flag; false for collections written before the
    // column existed. `admin.group` / `admin.order` are deliberately absent:
    // the server still honours them from code-first config, and round-tripping
    // them through this modal would let a settings save wipe them.
    status: collection.status === true,
    i18n: (collection as { localized?: boolean }).localized === true,
    versions:
      (collection as { versions?: { enabled?: boolean } | null }).versions
        ?.enabled === true,
    // Retention always carries the effective count (`false` = unlimited), so
    // a config left at the framework default reads back as its concrete number.
    versionsMaxPerDoc: (
      collection as {
        versions?: { maxPerDoc?: number | false } | null;
      }
    ).versions?.maxPerDoc,
    revalidate: collection.revalidate?.disable !== true,
    webhooks: collection.webhooks?.record !== false,
  };
}

/**
 * A stored hook becomes an editor row. The id is the editor's own handle for
 * the row — the server identifies a hook by `hookId`, so this one only has to
 * be unique within the list.
 */
function toEnabledHook(hook: Omit<EnabledHook, "id">): EnabledHook {
  return {
    id: `hook_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
    hookId: hook.hookId,
    enabled: hook.enabled,
    config: hook.config,
  };
}

interface CollectionBuilderEditPageProps {
  params?: { slug?: string };
}

// Over the thresholds, and further over before the shared units were
// extracted: cyclomatic 38 / cognitive 50 / CRAP 350 across 831 lines, against
// 14 / 19 / 56 now. A rewrite re-attributes the finding it inherited.
// fallow-ignore-next-line complexity
export default function CollectionBuilderEditPage({
  params,
}: CollectionBuilderEditPageProps): React.ReactElement {
  const slug = params?.slug;
  const { data: collection, isLoading, error } = useCollection(slug);

  const builder = useFieldBuilder<FormData>({
    resolver: zodResolver(collectionFormSchema),
    defaultValues: { singularName: "", pluralName: "" },
  });
  const { handleDuplicateField, handleRowDragEnd, getValidatedFields } =
    useBuilderFieldActions(builder);

  const [hooks, setHooks] = useState<EnabledHook[]>([]);
  const [active, setActive] = useState<ActiveOverlay>({ kind: "none" });
  const confirmation = useSchemaChangeConfirmation();

  const { mutate: updateCollection, isPending: isSaving } =
    useUpdateCollection();

  const {
    settings,
    setSettings,
    isInitialized,
    unsavedCount,
    pinFields,
    pinSettings,
  } = useBuilderEntityState({
    entity: collection,
    builder,
    toFields: getCollectionFields,
    toSettings: loaded => collectionSettings(loaded, slug),
    isDirty: settingsAreDirty,
    onLoad: loaded => {
      const { singular, plural } = collectionLabels(loaded);
      builder.form.reset({ singularName: singular, pluralName: plural });
      if (Array.isArray(loaded.hooks))
        setHooks(loaded.hooks.map(toEnabledHook));
    },
    // `id` rather than `slug`, which is optional on a collection; the two are
    // equally stable and only one is guaranteed present.
    identity: loaded => loaded.id,
  });

  const isLocked = collection?.locked === true;
  // Resolved once: the save hook refuses outright without a slug, so the
  // fallback below is only ever satisfying the type.
  const entitySlug = slug ?? "";
  const localized = settings?.i18n === true;

  // The schema landed. The apply carries fields only, so a save that also
  // changed the settings would otherwise clear the dirty badge while the
  // registry still held the old values — they are persisted here, WITHOUT
  // `fields`, so no second migration is generated for a schema already applied.
  const onSchemaApplied = useCallback(
    async (fieldDefinitions: FieldDefinition[]) => {
      if (!slug) return;
      pinFields();
      if (!settings) return;

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
            status: settings.status === true,
            localized: settings.i18n === true,
            versions: settings.versions === true,
            // Retention forwarded with the switch; the server resolves it.
            versionsMaxPerDoc: settings.versionsMaxPerDoc,
            // Cache revalidation and webhook recording: on unless explicitly
            // turned off; the server normalizes each boolean into what it stores.
            revalidate: settings.revalidate !== false,
            webhooks: settings.webhooks !== false,
          },
        },
        {
          // The baseline moves only once the write lands. Clearing it first
          // would show a clean form over a registry that still holds the old
          // settings, with no way to retry.
          onSuccess: () => pinSettings(settings),
          onError: err => {
            const m = (err as { message?: string })?.message;
            toast.error(
              `Schema applied, but the settings could not be saved${m ? `: ${m}` : ""}.`
            );
          },
        }
      );

      await mirrorSchemaFile(
        () =>
          schemaFileApi.writeCollection(
            collectionEntityFromSettings(slug, settings, fieldDefinitions)
          ),
        "Schema applied to the database"
      );
    },
    [slug, settings, updateCollection, pinFields, pinSettings]
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
            // Advanced tab. We deliberately don't write group/order from
            // here so existing values set via code-first config aren't
            // wiped by a settings save.
            status: settings.status === true,
            // i18n: the collection-level Internationalization toggle. Toggling on
            // (migration-gated) provisions the companion `_locales` table.
            localized: settings.i18n === true,
            // Version history: the server normalizes this into the resolved
            // config the registry column holds.
            versions: settings.versions === true,
            // Retention forwarded with the switch; resolved into the config.
            versionsMaxPerDoc: settings.versionsMaxPerDoc,
            // Cache revalidation: on unless explicitly turned off.
            revalidate: settings.revalidate !== false,
            // Webhook recording: on unless explicitly turned off.
            webhooks: settings.webhooks !== false,
            // Why: useAsTitle + timestamps were removed from the modal in
            // PR B (system title is always the display; timestamps always
            // emitted). Backend defaults take over -- code-first config can
            // still override.
            fields: fieldDefinitions,
            hooks: storedHooks.length > 0 ? storedHooks : undefined,
          },
        },
        {
          onSuccess: () => {
            toast.success("Collection updated");
            // Reset the settings dirty baseline so the Save button
            // disables again immediately after a successful save.
            pinSettings(settings);
            pinFields();
            // Mirror the settings change (notably Draft/Published) into the
            // committable ui-schema.json. Not awaited: the mutation callback
            // stays synchronous, and the mirror is best-effort anyway.
            void mirrorSchemaFile(
              () =>
                schemaFileApi.writeCollection(
                  collectionEntityFromSettings(slug, settings, fieldDefinitions)
                ),
              "Collection updated"
            );
          },
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
    [slug, settings, hooks, updateCollection, pinFields, pinSettings]
  );

  // i18n: preview and apply carry the same toggle, so the resolutions the user
  // is asked for match the DDL that actually runs.
  const { handleSave, confirmApply } = useSchemaSave({
    slug,
    missingSlugMessage: "Collection slug is missing",
    label: displayLabel(settings, entitySlug),
    confirmation,
    getValidatedFields,
    preview: fields => schemaApi.preview(entitySlug, fields, localized),
    apply: (fields, version, resolutions, renames) =>
      schemaApi.apply(
        entitySlug,
        fields,
        version,
        resolutions,
        renames,
        localized
      ),
    onNoChanges: saveSettingsOnly,
    onApplied: onSchemaApplied,
  });

  // ----------------------------------------------------------------
  // Loading / error guards
  // ----------------------------------------------------------------

  if (!slug) {
    return (
      <BuilderNotFoundScreen
        title="Collection Not Found"
        description="No collection slug was provided."
      />
    );
  }

  if (isLoading || !isInitialized) {
    return <BuilderLoadingScreen />;
  }

  if (error || !collection || !settings) {
    return <BuilderErrorScreen />;
  }

  // ----------------------------------------------------------------
  // Render
  // ----------------------------------------------------------------

  return (
    <BuilderPageLayout
      config={COLLECTION_BUILDER_CONFIG}
      builder={builder}
      name={settings.singularName || slug}
      locked={isLocked}
      configPath={collection?.configPath}
      unsavedCount={unsavedCount}
      onSave={handleSave}
      settings={settings}
      onSettingsChange={setSettings}
      active={active}
      onActiveChange={setActive}
      onDuplicateField={handleDuplicateField}
      onRowDragEnd={handleRowDragEnd}
      beforeFieldList={
        <SchemaBuilderSlots
          fields={builder.fields}
          setFields={builder.setFields}
          disabled={isLocked}
          context="collection"
        />
      }
      isSaving={isSaving || confirmation.isApplying}
      savingLabel="Saving collection changes…"
    >
      <BuilderSchemaChangeDialogs
        confirmation={confirmation}
        entityName={slug}
        onConfirm={confirmApply}
      />
    </BuilderPageLayout>
  );
}
