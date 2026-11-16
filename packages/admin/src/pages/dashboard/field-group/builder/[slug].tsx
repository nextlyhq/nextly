"use client";

/**
 * Field Group Builder, edit page.
 *
 * Draws the shared builder frame (BuilderPageLayout) and owns what a field
 * group does differently:
 * - Uses fieldGroupApi.previewSchemaChanges / applySchemaChanges.
 * - Settings modal uses Category instead of adminGroup; no Status/Order/Plural.
 * - A diverged or failed migration record blocks saving, so the page offers the
 *   repair inline rather than only on the listing.
 *
 * Locked code-first field groups render in readOnly mode.
 */

import { zodResolver } from "@hookform/resolvers/zod";
import { Alert, AlertDescription, AlertTitle, Button } from "@nextlyhq/ui";
import type React from "react";
import { useCallback, useMemo, useState } from "react";
import { z } from "zod";

import { ReconcileFieldGroupDialog } from "@admin/components/features/field-groups/ReconcileFieldGroupDialog";
import {
  BuilderErrorScreen,
  BuilderLoadingScreen,
  BuilderNotFoundScreen,
  BuilderPageLayout,
  BuilderSchemaChangeDialogs,
  type ActiveOverlay,
  type BuilderSettingsValues,
} from "@admin/components/features/schema-builder";
import {
  FieldGroupUsedBy,
  fieldGroupPlaceCount,
} from "@admin/components/features/schema-builder/FieldGroupUsedBy";
import { checkAddressAgain } from "@admin/components/features/schema-builder/new-entity/useAddressCheck";
import { AlertTriangle, RefreshCw } from "@admin/components/icons";
import { toast } from "@admin/components/ui";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import {
  useCreateFieldGroup,
  useFieldGroup,
  useUpdateFieldGroup,
} from "@admin/hooks/queries/useFieldGroups";
import { useBuilderEntityState } from "@admin/hooks/useBuilderEntityState";
import { useBuilderFieldActions } from "@admin/hooks/useBuilderFieldActions";
import { useBuilderSettingsChange } from "@admin/hooks/useBuilderSettingsChange";
import { useDocumentTitle } from "@admin/hooks/useDocumentTitle";
import { useFieldBuilder } from "@admin/hooks/useFieldBuilder";
import {
  useDiscardLetsGoOwned,
  useFieldGroupsFirst,
} from "@admin/hooks/useFieldGroupsFirst";
import { useFieldGroupUsedBy } from "@admin/hooks/useFieldGroupUsedBy";
import { useSchemaChangeConfirmation } from "@admin/hooks/useSchemaChangeConfirmation";
import {
  displayLabel,
  mirrorSchemaFile,
  useSchemaSave,
} from "@admin/hooks/useSchemaSave";
import { useUnsavedDiscard } from "@admin/hooks/useUnsavedDiscard";
import { createPreview } from "@admin/lib/builder/create-preview";
import { fieldGroupCreatePayload } from "@admin/lib/builder/create-request";
import { fieldGroupEntityFromSettings } from "@admin/lib/builder/settings-to-manifest";
import {
  removeUnsavedEntity,
  type UnsavedEntity,
  useUnsavedEntity,
} from "@admin/lib/builder/unsaved-entities";
import { fieldGroupApi } from "@admin/services/fieldGroupApi";
import { schemaFileApi } from "@admin/services/schemaFileApi";
import type { FieldDefinition } from "@admin/types/collection";
import type { ApiFieldGroup } from "@admin/types/entities";

import { FIELD_GROUP_BUILDER_CONFIG } from "./builder-config";

const componentFormSchema = z.object({
  singularName: z
    .string()
    .min(1, "Name is required")
    .max(255, "Name is too long"),
});

type FormData = z.infer<typeof componentFormSchema>;

/** The name a field group displays under, falling back to its slug. */
function fieldGroupName(fieldGroup: ApiFieldGroup): string {
  return fieldGroup.label || fieldGroup.slug || "";
}

/**
 * The settings a loaded field group opens the builder with. A field group is a
 * reusable building block rather than a record, so it carries none of the
 * per-record policy the other kinds do — no status, no versions, no webhooks —
 * and offers Category in their place.
 */
function fieldGroupSettings(fieldGroup: ApiFieldGroup): BuilderSettingsValues {
  const adminBlock = (fieldGroup.admin ?? {}) as Record<string, unknown>;
  return {
    singularName: fieldGroupName(fieldGroup),
    slug: fieldGroup.slug,
    description: fieldGroup.description || "",
    icon: (adminBlock.icon as string | undefined) || "Puzzle",
    category: (adminBlock.category as string | undefined) || "",
    i18n: (fieldGroup as { localized?: boolean }).localized === true,
  };
}

/**
 * A field group created in the dialog and not saved yet, in the shape the page
 * loads a saved one in. Nothing of it is stored, so it has no table or
 * timestamps.
 */
function unsavedFieldGroup(entity: UnsavedEntity): ApiFieldGroup {
  return {
    // The token, not the address: it is kept when the address moves, so
    // the editor knows the entity as the same one under its new address.
    id: `unsaved:field-group:${entity.token}`,
    slug: entity.address,
    label: entity.settings.singularName,
    tableName: "",
    fields: entity.fields,
    createdAt: "",
    updatedAt: "",
  };
}

interface FieldGroupBuilderEditPageProps {
  params?: { slug?: string };
}

// Over the thresholds, and further over before the shared units were
// extracted: cyclomatic 44 / cognitive 53 / CRAP 462 across 694 lines, against
// 20 / 22 / 106 now. Worst of the three because only this kind carries the
// repair alert and reconcile dialog a diverged migration record needs.
// fallow-ignore-next-line complexity
export default function FieldGroupBuilderEditPage({
  params,
}: FieldGroupBuilderEditPageProps): React.ReactElement {
  const slug = params?.slug;
  // A field group created in the dialog waits in this tab until its first
  // save; the server has nothing under its address to read.
  const unsaved = useUnsavedEntity("field-group", slug ?? "");
  const {
    data: savedFieldGroup,
    isLoading,
    error,
  } = useFieldGroup(unsaved ? undefined : slug);
  const fieldGroup = useMemo(
    () => (unsaved ? unsavedFieldGroup(unsaved) : savedFieldGroup),
    [unsaved, savedFieldGroup]
  );
  // The tab names the field group being edited once it has arrived.
  useDocumentTitle(fieldGroup ? fieldGroupName(fieldGroup) : undefined);

  const builder = useFieldBuilder<FormData>({
    resolver: zodResolver(componentFormSchema),
    defaultValues: { singularName: "" },
  });
  const { handleDuplicateField, getValidatedFields } =
    useBuilderFieldActions(builder);

  const [active, setActive] = useState<ActiveOverlay>({ kind: "none" });
  const [reconcileOpen, setReconcileOpen] = useState(false);

  const confirmation = useSchemaChangeConfirmation();

  const { mutate: updateFieldGroup, isPending: isUpdating } =
    useUpdateFieldGroup();
  const { mutateAsync: createFieldGroup, isPending: isCreating } =
    useCreateFieldGroup();
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
    entity: fieldGroup,
    builder,
    toFields: loaded => loaded.fields ?? [],
    // An unsaved field group opens with what the dialog set.
    toSettings: loaded => unsaved?.settings ?? fieldGroupSettings(loaded),
    onLoad: loaded =>
      builder.form.reset({ singularName: fieldGroupName(loaded) }),
    // A saved field group is known by its slug, which an unsaved one shares;
    // its id tells them apart, so once saved the editor loads the server's
    // afresh.
    identity: loaded => (unsaved ? loaded.id : loaded.slug),
    unsaved: unsaved !== undefined,
  });

  // A change of the settings is a step; an unsaved field group's address
  // moves it at once, outside the history.
  const { onSettingsChange, unsavedAddress } = useBuilderSettingsChange({
    kind: "field-group",
    unsaved,
    settings,
    setSettings,
    moveAddress,
    editRoute: address =>
      buildRoute(ROUTES.BUILDER_FIELD_GROUPS_EDIT, { slug: address }),
  });
  // How many places use the field group, from the same query its used-by
  // list reads; an unsaved one is used nowhere yet, and asked nothing.
  const usedBy = useFieldGroupUsedBy(unsaved ? undefined : slug);

  const isLocked = fieldGroup?.locked === true;
  // Resolved once: the save hook refuses outright without a slug, so the
  // fallback below is only ever satisfying the type.
  const entitySlug = slug ?? "";
  // The field groups not saved yet that this save creates first, and the ones this editor's
  // picker made, which its save, Discard all and leave let go or release.
  const groupsFirst = useFieldGroupsFirst("field-group", slug, builder.fields);
  const localized = settings?.i18n === true;

  /**
   * Whether this field group's record needs repairing before it will accept a save.
   *
   * `diverged` refuses schema edits outright; `failed` stands over tables that may already match.
   * The same operation clears both, so one list covers them. Server-side is where this is
   * enforced — this only decides whether the page explains it up front.
   */
  const needsRepair =
    fieldGroup?.migrationStatus === "diverged" ||
    fieldGroup?.migrationStatus === "failed";

  // The schema landed. The apply carries the fields (and `localized`) only, so
  // the other settings are persisted here, WITHOUT `fields`, as for the other
  // kinds: otherwise a name, description, icon or category changed in the same
  // save as a field would be pinned as saved while the registry kept the old
  // values.
  const onSchemaApplied = useCallback(
    async (fieldDefinitions: FieldDefinition[]) => {
      if (!slug) return;
      pinFields();

      // 🔴 No settings, no manifest write — and this is not the same as writing
      // an empty one. The dev-schema endpoint FULL-REPLACES the entity by slug,
      // so a projection built from absent settings would replace this field
      // group's labels and description in ui-schema.json with nothing. The
      // database write has already succeeded either way; skipping the mirror
      // leaves the file as it was, which is the recoverable outcome.
      //
      // The fields are pinned above regardless: they landed, and the baseline
      // has to move with them or the page reports unsaved work that is saved.
      if (!settings) return;

      updateFieldGroup(
        {
          fieldGroupSlug: slug,
          updates: {
            label: settings.singularName,
            description: settings.description,
            admin: {
              category: settings.category,
              icon: settings.icon,
            },
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
          schemaFileApi.writeFieldGroup(
            fieldGroupEntityFromSettings(slug, settings, fieldDefinitions)
          ),
        "Field group applied to the database"
      );
    },
    [slug, settings, updateFieldGroup, pinFields, pinSettings]
  );

  const saveSettingsOnly = useCallback(
    (fieldDefinitions: FieldDefinition[]) => {
      if (!slug || !settings) return;
      updateFieldGroup(
        {
          fieldGroupSlug: slug,
          updates: {
            label: settings.singularName,
            description: settings.description,
            fields: fieldDefinitions,
            admin: {
              category: settings.category,
              icon: settings.icon,
            },
            // i18n: the component-level Internationalization toggle. Toggling on provisions the
            // companion comp_<slug>_locales table; always send the boolean so OFF also reaches the
            // server. Mirrors the collection/single builder.
            localized: settings.i18n === true,
          },
        },
        {
          onSuccess: () => {
            toast.success("Field group updated");
            pinFields();
            // Re-pin settings baseline so the Save button disables again.
            pinSettings(settings);
          },
          onError: err => {
            const errorObj = err as { message?: string };
            toast.error(
              errorObj?.message ||
                "An unexpected error occurred while updating the field group."
            );
          },
        }
      );
    },
    [slug, settings, updateFieldGroup, pinFields, pinSettings]
  );

  // The first save of an unsaved field group is its create: reviewed from the
  // fields it will be created with, its address checked once more (another
  // tab may have saved one under it), then created with every field and
  // setting. A refusal at either step creates nothing and keeps it unsaved.
  const createUnsaved = useCallback(
    async (fields: FieldDefinition[]) => {
      if (!settings) return { success: false };
      const refused = await checkAddressAgain("field-group", entitySlug);
      if (refused !== null) return { success: false, message: refused };
      await createFieldGroup(
        fieldGroupCreatePayload(entitySlug, settings, fields)
      );
      return { success: true };
    },
    [settings, entitySlug, createFieldGroup]
  );

  // Created: the file mirror follows the create, and this tab lets the
  // unsaved field group go, so the editor reads the server's from now on.
  const onCreated = useCallback(
    async (fieldDefinitions: FieldDefinition[]) => {
      if (!settings) return;
      await mirrorSchemaFile(
        () =>
          schemaFileApi.writeFieldGroup(
            fieldGroupEntityFromSettings(entitySlug, settings, fieldDefinitions)
          ),
        "Field group created"
      );
      removeUnsavedEntity("field-group", entitySlug);
    },
    [settings, entitySlug]
  );

  const { handleSave, confirmApply } = useSchemaSave({
    slug,
    missingSlugMessage: "Field group slug is missing",
    label: displayLabel(settings, entitySlug),
    confirmation,
    // Judged against the fields as last saved, so a draft that changes a
    // saved field's storage level is refused before it can lose values.
    getValidatedFields: () => getValidatedFields(pending.saved),
    // The i18n flag, as for the other kinds: the preview reports what a field
    // leaving translation moves to the archive, which depends on it. An
    // unsaved field group's review is its create, built here.
    preview: fields =>
      unsaved
        ? Promise.resolve(createPreview(fields))
        : fieldGroupApi.previewSchemaChanges(entitySlug, fields, localized),
    apply: (fields, version, resolutions, renames) =>
      unsaved
        ? createUnsaved(fields)
        : fieldGroupApi.applySchemaChanges(
            entitySlug,
            fields,
            version,
            resolutions,
            renames,
            localized
          ),
    onNoChanges: saveSettingsOnly,
    onApplied: unsaved ? onCreated : onSchemaApplied,
    previewedWith: { localized },
    // Each changed setting is reviewed with the save, and a save of the
    // settings alone is reviewed too.
    settingChanges: pending.settingChanges,
    fieldGroupsFirst: groupsFirst.fieldGroupsFirst,
  });

  // Discard all on an unsaved field group discards the field group itself: it
  // leaves this tab, and the editor returns to the list.
  const pendingChanges = useDiscardLetsGoOwned(
    useUnsavedDiscard(
      pending,
      unsaved !== undefined,
      "field-group",
      entitySlug,
      ROUTES.BUILDER_FIELD_GROUPS
    ),
    groupsFirst.letGoOwned
  );

  // ---------------------------- Loading / error guards ----------------------

  if (!slug) {
    return (
      <BuilderNotFoundScreen
        title="Field group not found"
        description="No field group slug was provided."
      />
    );
  }

  if (isLoading || !isInitialized) {
    return <BuilderLoadingScreen />;
  }

  if (error || !fieldGroup || !settings) {
    return <BuilderErrorScreen />;
  }

  // ---------------------------- Render --------------------------------------

  return (
    <BuilderPageLayout
      config={FIELD_GROUP_BUILDER_CONFIG}
      builder={builder}
      entitySlug={entitySlug}
      name={settings.singularName || slug}
      locked={isLocked}
      configPath={fieldGroup?.configPath}
      unsavedCount={unsavedCount}
      pending={pendingChanges}
      onDiscard={() => {
        // Left with its changes discarded: an unsaved entity goes, and the field groups its picker
        // made stay as unsaved field groups of their own, which their own editor may open.
        if (unsaved) removeUnsavedEntity("field-group", entitySlug);
        groupsFirst.release();
      }}
      savedFieldIds={savedFieldIds}
      onSave={handleSave}
      settings={settings}
      onSettingsChange={onSettingsChange}
      unsavedAddress={unsavedAddress}
      usedByCount={usedBy.data ? fieldGroupPlaceCount(usedBy.data) : undefined}
      active={active}
      onActiveChange={setActive}
      onDuplicateField={handleDuplicateField}
      beforeFieldList={
        /* This page is where the refusal actually happens: a diverged field group loads and
           edits normally, and only the SAVE is refused. An affordance living only on the list
           would let an operator do the work, lose it to a refusal, and then navigate away to
           find the repair.

           The shared Alert rather than a hand-rolled tinted box. The box drew
           its edge with a 40%-alpha destructive border, which composites to
           1.69:1 over this surface against the 3:1 that WCAG 1.4.11 asks of a
           component boundary; the alert's destructive variant uses
           full-strength scale tokens and a solid left accent instead. It also
           supplies role="alert", which the box had no equivalent of:
           `needsRepair` is derived from fetched data, so this refusal appears
           AFTER the page settles and was previously announced to nobody.

           The old class is described here rather than written out. Both the
           contrast suite and Tailwind's scanner read this file as text, so
           quoting the utility would re-introduce it — failing the suite from a
           comment, and emitting the class into the build. */
        <>
          {needsRepair ? (
            <Alert variant="destructive" className="mb-4">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <AlertTitle>
                  Saving is blocked until this definition is repaired
                </AlertTitle>
                <AlertDescription className="mt-1">
                  This field group&apos;s tables changed and the record
                  describing them did not, so schema edits are refused.
                  Repairing rewrites the record to describe the tables — it
                  moves no data and creates no columns.
                </AlertDescription>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => setReconcileOpen(true)}
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Review the repair
                </Button>
              </div>
            </Alert>
          ) : null}
          {/* Who a change here reaches, before any change is made; nothing
              can use a field group that is not saved yet. */}
          {unsaved ? null : <FieldGroupUsedBy slug={fieldGroup.slug} />}
        </>
      }
      isSaving={isSaving || confirmation.isBusy}
      savingLabel="Saving field group changes…"
    >
      <ReconcileFieldGroupDialog
        open={reconcileOpen}
        onOpenChange={setReconcileOpen}
        fieldGroupSlug={slug}
        fieldGroupLabel={settings?.singularName || slug}
      />

      <BuilderSchemaChangeDialogs
        confirmation={confirmation}
        kind={FIELD_GROUP_BUILDER_CONFIG.kind}
        entityName={slug}
        onConfirm={confirmApply}
        creating={unsaved !== undefined}
        settingChanges={pending.settingChanges}
        fieldGroupCreates={groupsFirst.creates}
      />
    </BuilderPageLayout>
  );
}
