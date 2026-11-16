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
import { useCallback, useMemo, useState } from "react";
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
import { checkAddressAgain } from "@admin/components/features/schema-builder/new-entity/useAddressCheck";
import { toast } from "@admin/components/ui";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import {
  useCreateSingle,
  useSingleSchema,
  useUpdateSingle,
} from "@admin/hooks/queries";
import { useBuilderEntityState } from "@admin/hooks/useBuilderEntityState";
import { useBuilderFieldActions } from "@admin/hooks/useBuilderFieldActions";
import { useBuilderSettingsChange } from "@admin/hooks/useBuilderSettingsChange";
import { useDocumentTitle } from "@admin/hooks/useDocumentTitle";
import { useFieldBuilder } from "@admin/hooks/useFieldBuilder";
import { useSchemaChangeConfirmation } from "@admin/hooks/useSchemaChangeConfirmation";
import {
  displayLabel,
  mirrorSchemaFile,
  useSchemaSave,
} from "@admin/hooks/useSchemaSave";
import { createPreview } from "@admin/lib/builder/create-preview";
import { singleCreatePayload } from "@admin/lib/builder/create-request";
import { singleEntityFromSettings } from "@admin/lib/builder/settings-to-manifest";
import { hasPageBuilderField } from "@admin/lib/builder/starting-field";
import {
  removeUnsavedEntity,
  type UnsavedEntity,
  useUnsavedEntity,
} from "@admin/lib/builder/unsaved-entities";
import { navigateTo } from "@admin/lib/navigation";
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

/**
 * A Single created in the dialog and not saved yet, in the shape the page loads
 * a saved one in. Nothing of it is stored, so it has no table or timestamps.
 */
function unsavedSingle(entity: UnsavedEntity): ApiSingle {
  return {
    // The token, not the address: it is kept when the address moves, so
    // the editor knows the entity as the same one under its new address.
    id: `unsaved:single:${entity.token}`,
    slug: entity.address,
    label: entity.settings.singularName,
    tableName: "",
    fields: entity.fields,
    createdAt: "",
    updatedAt: "",
  };
}

interface SingleBuilderEditPageProps {
  params?: { slug?: string };
}

// Over the thresholds, and further over before the shared units were
// extracted: cyclomatic 38 / cognitive 49 / CRAP 350 across 725 lines, against
// 14 / 18 / 56 now. A rewrite re-attributes the finding it inherited.
// fallow-ignore-next-line complexity
export default function SingleBuilderEditPage({
  params,
}: SingleBuilderEditPageProps): React.ReactElement {
  const slug = params?.slug;
  // A Single created in the dialog waits in this tab until its first save;
  // the server has nothing under its address to read.
  const unsaved = useUnsavedEntity("single", slug ?? "");
  const {
    data: savedSingle,
    isLoading,
    error,
  } = useSingleSchema(unsaved ? undefined : slug);
  const single = useMemo(
    () => (unsaved ? unsavedSingle(unsaved) : savedSingle),
    [unsaved, savedSingle]
  );
  // The tab names the Single being edited once it has arrived.
  useDocumentTitle(single ? singleName(single) : undefined);

  const builder = useFieldBuilder<FormData>({
    resolver: zodResolver(singleFormSchema),
    defaultValues: { singularName: "" },
  });
  const { handleDuplicateField, getValidatedFields } =
    useBuilderFieldActions(builder);

  const [active, setActive] = useState<ActiveOverlay>({ kind: "none" });
  const confirmation = useSchemaChangeConfirmation();

  const { mutate: updateSingle, isPending: isUpdating } = useUpdateSingle();
  const { mutateAsync: createSingle, isPending: isCreating } =
    useCreateSingle();
  const isSaving = isUpdating || isCreating;

  const {
    settings,
    setSettings,
    isInitialized,
    unsavedCount,
    pending,
    savedFieldIds,
    pinFields,
    pinSettings,
    moveAddress,
  } = useBuilderEntityState({
    entity: single,
    builder,
    toFields: loaded => loaded.fields ?? [],
    // An unsaved Single opens with what the dialog set.
    toSettings: loaded => unsaved?.settings ?? singleSettings(loaded),
    onLoad: loaded => builder.form.reset({ singularName: singleName(loaded) }),
    // A saved Single is known by its slug, which an unsaved one shares; its
    // id tells them apart, so once saved the editor loads the server's afresh.
    identity: loaded => (unsaved ? loaded.id : loaded.slug),
    unsaved: unsaved !== undefined,
  });

  // A change of the settings is a step; an unsaved single's address
  // moves it at once, outside the history.
  const { onSettingsChange, unsavedAddress } = useBuilderSettingsChange({
    kind: "single",
    unsaved,
    settings,
    setSettings,
    moveAddress,
    editRoute: address =>
      buildRoute(ROUTES.BUILDER_SINGLES_EDIT, { slug: address }),
  });

  const isLocked = single?.locked === true;
  // Resolved once: the save hook refuses outright without a slug, so the
  // fallback below is only ever satisfying the type.
  const entitySlug = slug ?? "";
  const localized = settings?.i18n === true;
  // The pending Draft/Published toggle rides with the fields, as `localized` does, so the save
  // refuses a field taking one of the lifecycle's names in the save that turns it on.
  const drafts = settings?.status === true;

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
            // The icon, as the settings-only save sends it: without it an icon
            // changed in the same save as a field never reached the server.
            // Group and order stay unwritten, so code-first values survive.
            admin: {
              icon: settings.icon,
            },
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
            fields: fieldDefinitions,
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
  // The first save of an unsaved Single is its create: reviewed from the
  // fields it will be created with, its address checked once more (another
  // tab may have saved one under it), then created with every field and
  // setting. A refusal at either step creates nothing and keeps it unsaved.
  const createUnsaved = useCallback(
    async (fields: FieldDefinition[]) => {
      if (!settings) return { success: false };
      const refused = await checkAddressAgain("single", entitySlug);
      if (refused !== null) return { success: false, message: refused };
      await createSingle(singleCreatePayload(entitySlug, settings, fields));
      return { success: true };
    },
    [settings, entitySlug, createSingle]
  );

  // Created: the file mirror follows the create, and this tab lets the
  // unsaved Single go, so the editor reads the server's from now on.
  const onCreated = useCallback(
    async (fieldDefinitions: FieldDefinition[]) => {
      if (!settings) return;
      await mirrorSchemaFile(
        () =>
          schemaFileApi.writeSingle(
            singleEntityFromSettings(entitySlug, settings, fieldDefinitions)
          ),
        "Single created"
      );
      removeUnsavedEntity("single", entitySlug);
    },
    [settings, entitySlug]
  );

  const { handleSave, confirmApply } = useSchemaSave({
    slug,
    missingSlugMessage: "Single slug is missing",
    label: displayLabel(settings, entitySlug),
    confirmation,
    // Judged against the fields as last saved, so a draft that changes a
    // saved field's storage level is refused before it can lose values.
    getValidatedFields: () => getValidatedFields(pending.saved),
    preview: fields =>
      unsaved
        ? Promise.resolve(createPreview(fields))
        : singleApi.previewSchemaChanges(entitySlug, fields, localized, drafts),
    apply: (fields, version, resolutions, renames) =>
      unsaved
        ? createUnsaved(fields)
        : singleApi.applySchemaChanges(
            entitySlug,
            fields,
            version,
            resolutions,
            renames,
            localized,
            drafts
          ),
    onNoChanges: saveSettingsOnly,
    onApplied: unsaved ? onCreated : onSchemaApplied,
    previewedWith: { localized },
    // Each changed setting is reviewed with the save, and a save of the
    // settings alone is reviewed too.
    settingChanges: pending.settingChanges,
  });

  // Discard all on an unsaved Single discards the Single itself: it leaves
  // this tab, and the editor returns to the list.
  const pendingChanges = useMemo(
    () =>
      unsaved
        ? {
            ...pending,
            discardLeaves: true,
            discardAll: () => {
              removeUnsavedEntity("single", entitySlug);
              navigateTo(ROUTES.BUILDER_SINGLES);
            },
          }
        : pending,
    [unsaved, pending, entitySlug]
  );

  // ---------------------------- Loading / error guards ----------------------

  if (!slug) {
    return (
      <BuilderNotFoundScreen
        title="Single not found"
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
      entitySlug={entitySlug}
      name={settings.singularName || slug}
      locked={isLocked}
      configPath={single?.configPath}
      unsavedCount={unsavedCount}
      pending={pendingChanges}
      pageBuilderHref={
        // Once saved, an entity laid out from blocks opens in the Page Builder
        // from a new entry (a Single, from its document).
        !unsaved && hasPageBuilderField(pending.saved)
          ? buildRoute(ROUTES.SINGLE_EDIT, { slug: entitySlug })
          : undefined
      }
      onDiscard={
        unsaved ? () => removeUnsavedEntity("single", entitySlug) : undefined
      }
      savedFieldIds={savedFieldIds}
      onSave={handleSave}
      settings={settings}
      onSettingsChange={onSettingsChange}
      unsavedAddress={unsavedAddress}
      active={active}
      onActiveChange={setActive}
      onDuplicateField={handleDuplicateField}
      beforeFieldList={
        <SchemaBuilderSlots
          fields={builder.fields}
          setFields={builder.setFields}
          disabled={isLocked}
          context="single"
        />
      }
      isSaving={isSaving || confirmation.isBusy}
      savingLabel="Saving Single changes…"
    >
      <BuilderSchemaChangeDialogs
        confirmation={confirmation}
        kind={SINGLE_BUILDER_CONFIG.kind}
        entityName={slug}
        onConfirm={confirmApply}
        creating={unsaved !== undefined}
        settingChanges={pending.settingChanges}
      />
    </BuilderPageLayout>
  );
}
