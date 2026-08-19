"use client";

/**
 * Single Builder — Edit Page
 *
 * Draws the shared builder frame (BuilderPageLayout) and owns what a Single
 * does differently: its settings shape, singleApi as the schema client, and its
 * copy. Singles run the same preview → confirm → apply pipeline as Collections.
 *
 * Locked code-first Singles render in readOnly mode (cross-cutting code-first
 * preservation requirement).
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
} from "@admin/components/features/schema-builder";
import { toast } from "@admin/components/ui";
import { useSingleSchema, useUpdateSingle } from "@admin/hooks/queries";
import { useBuilderEntityState } from "@admin/hooks/useBuilderEntityState";
import { useBuilderFieldActions } from "@admin/hooks/useBuilderFieldActions";
import { useFieldBuilder } from "@admin/hooks/useFieldBuilder";
import { useSchemaChangeConfirmation } from "@admin/hooks/useSchemaChangeConfirmation";
import {
  displayLabel,
  mirrorSchemaFile,
  useSchemaSave,
} from "@admin/hooks/useSchemaSave";
import { settingsAreDirty } from "@admin/lib/builder/settings-dirty";
import { singleEntityFromSettings } from "@admin/lib/builder/settings-to-manifest";
import { schemaFileApi } from "@admin/services/schemaFileApi";
import { singleApi } from "@admin/services/singleApi";
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

/** The name a Single displays under, falling back to its slug. */
function singleName(single: ApiSingle): string {
  return single.label || single.slug || "";
}

/**
 * The settings a loaded Single opens the builder with.
 *
 * Several switches read "on unless explicitly turned off": the registry stores
 * a resolved config, so an absent opt-out and a null config both mean the
 * default is in force, and only an explicit `false` turns the switch off.
 */
function singleSettings(single: ApiSingle): BuilderSettingsValues {
  const adminBlock = (single.admin ?? {}) as Record<string, unknown>;
  return {
    singularName: singleName(single),
    slug: single.slug,
    description: single.description || "",
    icon: (adminBlock.icon as string | undefined) || "FileText",
    // The Draft/Published flag; false for Singles written before the column
    // existed. `admin.group` / `admin.order` are deliberately absent: the
    // server still honours them from code-first config, and round-tripping
    // them through this modal would let a settings save wipe them.
    status: single.status === true,
    i18n: (single as { localized?: boolean }).localized === true,
    versions:
      (single as { versions?: { enabled?: boolean } | null }).versions
        ?.enabled === true,
    // Retention always carries the effective count (`false` = unlimited), so
    // a config left at the framework default reads back as its concrete number.
    versionsMaxPerDoc: (
      single as { versions?: { maxPerDoc?: number | false } | null }
    ).versions?.maxPerDoc,
    revalidate: single.revalidate?.disable !== true,
    webhooks: single.webhooks?.record !== false,
  };
}

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
  const { handleDuplicateField, handleRowDragEnd, getValidatedFields } =
    useBuilderFieldActions(builder);

  const [active, setActive] = useState<ActiveOverlay>({ kind: "none" });
  const confirmation = useSchemaChangeConfirmation();

  const { mutate: updateSingle, isPending: isSaving } = useUpdateSingle();

  const {
    settings,
    setSettings,
    isInitialized,
    unsavedCount,
    pinFields,
    pinSettings,
  } = useBuilderEntityState({
    entity: single,
    builder,
    toFields: loaded => (loaded.fields ?? []) as unknown as FieldDefinition[],
    toSettings: singleSettings,
    isDirty: settingsAreDirty,
    onLoad: loaded => builder.form.reset({ singularName: singleName(loaded) }),
  });

  const isLocked = single?.locked === true;
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

      updateSingle(
        {
          slug,
          updates: {
            label: settings.singularName,
            description: settings.description,
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
          schemaFileApi.writeSingle(
            singleEntityFromSettings(slug, settings, fieldDefinitions)
          ),
        "Single applied to the database"
      );
    },
    [slug, settings, updateSingle, pinFields, pinSettings]
  );

  // No-schema-change path: persist labels/settings only.
  const saveSettingsOnly = useCallback(
    (fieldDefinitions: FieldDefinition[]) => {
      if (!slug || !settings) return;
      updateSingle(
        {
          slug,
          updates: {
            label: settings.singularName,
            description: settings.description,
            fields: fieldDefinitions as unknown as ApiSingle["fields"],
            admin: {
              icon: settings.icon,
              // Advanced tab. We deliberately don't write group/order
              // from here so existing values set via code-first config
              // aren't wiped by a settings save.
            },
            // Always send the boolean so toggling the lifecycle off
            // also reaches the server. The previous truthy-only spread
            // silently dropped the OFF case so the toggle could never
            // be turned back off after enabling.
            status: settings.status === true,
            // i18n: the single-level Internationalization toggle. Toggling on provisions the
            // companion single_<slug>_locales table; always send the boolean so OFF also reaches
            // the server. Mirrors the collection builder.
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
          },
        },
        {
          onSuccess: () => {
            toast.success("Single updated");
            pinFields();
            // Re-pin settings baseline so the Save button disables again.
            pinSettings(settings);
            // Mirror the settings change (notably Draft/Published) into the
            // committable ui-schema.json. Not awaited: the mutation callback
            // stays synchronous, and the mirror is best-effort anyway.
            void mirrorSchemaFile(
              () =>
                schemaFileApi.writeSingle(
                  singleEntityFromSettings(slug, settings, fieldDefinitions)
                ),
              "Single updated"
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
    },
    [slug, settings, updateSingle, pinFields, pinSettings]
  );

  // i18n: preview and apply carry the same toggle, so the resolutions the user
  // is asked for match the DDL that actually runs.
  const { handleSave, confirmApply } = useSchemaSave({
    slug,
    missingSlugMessage: "Single slug is missing",
    label: displayLabel(settings, entitySlug),
    confirmation,
    getValidatedFields,
    preview: fields =>
      singleApi.previewSchemaChanges(entitySlug, fields, localized),
    apply: (fields, version, resolutions, renames) =>
      singleApi.applySchemaChanges(
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

  // ---------------------------- Loading / error guards ----------------------

  if (!slug) {
    return (
      <BuilderNotFoundScreen
        title="Single Not Found"
        description="No Single slug was provided."
      />
    );
  }

  if (isLoading || !isInitialized) {
    return <BuilderLoadingScreen />;
  }

  if (error || !single || !settings) {
    return <BuilderErrorScreen />;
  }

  // ---------------------------- Render --------------------------------------

  return (
    <BuilderPageLayout
      config={SINGLE_BUILDER_CONFIG}
      builder={builder}
      name={settings.singularName || slug}
      locked={isLocked}
      configPath={single?.configPath}
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
          context="single"
        />
      }
      isSaving={isSaving || confirmation.isApplying}
      savingLabel="Saving Single changes…"
    >
      <BuilderSchemaChangeDialogs
        confirmation={confirmation}
        entityName={slug}
        onConfirm={confirmApply}
      />
    </BuilderPageLayout>
  );
}
