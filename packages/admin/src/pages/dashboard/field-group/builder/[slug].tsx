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
import { useCallback, useState } from "react";
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
import { AlertTriangle, RefreshCw } from "@admin/components/icons";
import { toast } from "@admin/components/ui";
import {
  useFieldGroup,
  useUpdateFieldGroup,
} from "@admin/hooks/queries/useFieldGroups";
import { useBuilderEntityState } from "@admin/hooks/useBuilderEntityState";
import { useBuilderFieldActions } from "@admin/hooks/useBuilderFieldActions";
import { useFieldBuilder } from "@admin/hooks/useFieldBuilder";
import { useSchemaChangeConfirmation } from "@admin/hooks/useSchemaChangeConfirmation";
import {
  displayLabel,
  mirrorSchemaFile,
  useSchemaSave,
} from "@admin/hooks/useSchemaSave";
import { fieldGroupToManifestEntity } from "@admin/lib/builder/to-manifest-entity-field-group";
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
 * Field groups compare only the settings they actually render, rather than
 * using the shared comparator: the values it also reads — status, versions,
 * retention, revalidate, webhooks — have no control on this kind's modal, so
 * they are absent on both sides and could never differ.
 */
function fieldGroupSettingsAreDirty(
  original: BuilderSettingsValues | null,
  current: BuilderSettingsValues | null
): boolean {
  if (!original || !current) return false;
  return (
    original.singularName !== current.singularName ||
    original.description !== current.description ||
    original.icon !== current.icon ||
    original.category !== current.category ||
    original.i18n !== current.i18n
  );
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
  const { data: fieldGroup, isLoading, error } = useFieldGroup(slug);

  const builder = useFieldBuilder<FormData>({
    resolver: zodResolver(componentFormSchema),
    defaultValues: { singularName: "" },
  });
  const { handleDuplicateField, handleRowDragEnd, getValidatedFields } =
    useBuilderFieldActions(builder);

  const [active, setActive] = useState<ActiveOverlay>({ kind: "none" });
  const [reconcileOpen, setReconcileOpen] = useState(false);

  const confirmation = useSchemaChangeConfirmation();

  const { mutate: updateFieldGroup, isPending: isSaving } =
    useUpdateFieldGroup();

  const {
    settings,
    setSettings,
    isInitialized,
    unsavedCount,
    pinFields,
    pinSettings,
  } = useBuilderEntityState({
    entity: fieldGroup,
    builder,
    toFields: loaded => loaded.fields ?? [],
    toSettings: fieldGroupSettings,
    isDirty: fieldGroupSettingsAreDirty,
    onLoad: loaded =>
      builder.form.reset({ singularName: fieldGroupName(loaded) }),
    identity: loaded => loaded.slug,
  });

  const isLocked = fieldGroup?.locked === true;
  // Resolved once: the save hook refuses outright without a slug, so the
  // fallback below is only ever satisfying the type.
  const entitySlug = slug ?? "";
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

  // The schema landed. Unlike the other kinds there is no separate settings
  // write here: a field group's save always carries its fields, so the settings
  // went with them and both baselines move together.
  const onSchemaApplied = useCallback(
    async (fieldDefinitions: FieldDefinition[]) => {
      if (!slug) return;
      pinFields();
      if (settings) pinSettings(settings);

      await mirrorSchemaFile(
        () =>
          schemaFileApi.writeFieldGroup(
            fieldGroupToManifestEntity({
              slug,
              settings: {
                singularName: settings?.singularName,
                // 🔴 The description travels too. The migration's upsert writes
                // that column unconditionally so that clearing one propagates,
                // so a manifest omitting it does not leave the stored value
                // alone — it replaces it with NULL, erasing on this save a
                // description an earlier migration had deployed.
                description: settings?.description,
                // Mirror the Internationalization flag into ui-schema.json.
                localized: settings?.i18n === true,
              },
              fields: fieldDefinitions,
            })
          ),
        "Field group applied to the database"
      );
    },
    [slug, settings, pinFields, pinSettings]
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

  const { handleSave, confirmApply } = useSchemaSave({
    slug,
    missingSlugMessage: "Field group slug is missing",
    label: displayLabel(settings, entitySlug),
    confirmation,
    getValidatedFields,
    // Unlike the other kinds the preview takes no i18n flag: a field group owns
    // no rows of its own, so the toggle cannot change what it reports.
    preview: fields => fieldGroupApi.previewSchemaChanges(entitySlug, fields),
    apply: (fields, version, resolutions, renames) =>
      fieldGroupApi.applySchemaChanges(
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
        title="Field Group Not Found"
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
      name={settings.singularName || slug}
      locked={isLocked}
      configPath={fieldGroup?.configPath}
      unsavedCount={unsavedCount}
      onSave={handleSave}
      settings={settings}
      onSettingsChange={setSettings}
      active={active}
      onActiveChange={setActive}
      onDuplicateField={handleDuplicateField}
      onRowDragEnd={handleRowDragEnd}
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
        needsRepair ? (
          <Alert variant="destructive" className="mb-4">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <AlertTitle>
                Saving is blocked until this definition is repaired
              </AlertTitle>
              <AlertDescription className="mt-1">
                This field group&apos;s tables changed and the record describing
                them did not, so schema edits are refused. Repairing rewrites
                the record to describe the tables — it moves no data and creates
                no columns.
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
        ) : null
      }
      isSaving={isSaving || confirmation.isApplying}
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
        entityName={slug}
        onConfirm={confirmApply}
      />
    </BuilderPageLayout>
  );
}
