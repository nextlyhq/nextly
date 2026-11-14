"use client";

/**
 * Field Group Builder, create page.
 *
 * Mirrors the Collection / Single create flow: opens the new-entity dialog
 * directly, on Continue creates the field group (no fields yet) and
 * navigates to [slug].tsx for field editing.
 *
 * Field groups diverge from Collection/Single: no plural, no useAsTitle,
 * no order, no status, no timestamps, no hooks. Category replaces
 * adminGroup.
 */

import { useEffect, useState } from "react";

import type { BuilderSettingsValues } from "@admin/components/features/schema-builder";
import { NewEntityDialog } from "@admin/components/features/schema-builder/new-entity/NewEntityDialog";
import { PageContainer } from "@admin/components/layout/page-container";
import { toast } from "@admin/components/ui";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import { useCreateFieldGroup } from "@admin/hooks/queries/useFieldGroups";
import { apiErrorMessage } from "@admin/lib/api/parseApiError";
import { toSnakeName } from "@admin/lib/builder";
import { fieldGroupEntityFromSettings } from "@admin/lib/builder/settings-to-manifest";
import { navigateTo } from "@admin/lib/navigation";
import { schemaFileApi } from "@admin/services/schemaFileApi";

import { FIELD_GROUP_BUILDER_CONFIG } from "./builder-config";

export default function FieldGroupBuilderPage(): React.ReactElement | null {
  const [open, setOpen] = useState(true);
  const { mutate: createFieldGroup, isPending } = useCreateFieldGroup();

  useEffect(() => {
    if (!open && !isPending) {
      navigateTo(ROUTES.BUILDER_FIELD_GROUPS);
    }
  }, [open, isPending]);

  const handleSubmit = (values: BuilderSettingsValues) => {
    const singular = values.singularName.trim();
    const slug = values.slug?.trim() || toSnakeName(singular);
    // Already normalised, at the settings form — the one boundary both this
    // request and the manifest projection read from. Trimming again here would
    // be a second spelling of that rule, which is how the two came to disagree.
    const description = values.description;

    createFieldGroup(
      {
        slug,
        label: singular,
        description,
        admin: {
          category: values.category?.trim() || undefined,
          icon: values.icon,
        },
        // i18n: persist the Internationalization flag at create. Fields are empty here, so the
        // companion has no columns yet — it is provisioned when the first translatable field is
        // added on the builder page.
        ...(values.i18n === true ? { localized: true } : {}),
        // Empty user-fields list — server auto-injects system columns.
        fields: [],
      },
      {
        onSuccess: () => {
          // Mirror the new (field-less) field group to ui-schema.json (best-effort;
          // a file-write failure warns but never blocks navigation). Wrapped in
          // a void IIFE so the mutation callback stays synchronous.
          void (async () => {
            try {
              await schemaFileApi.writeFieldGroup(
                fieldGroupEntityFromSettings(
                  slug,
                  // The name the form collected, which is not yet on `values` at
                  // create time. The description needs no normalising here: the
                  // projection does it, which is what keeps this write and the
                  // create request above agreeing about a blank one.
                  { ...values, singularName: singular },
                  []
                )
              );
            } catch (err) {
              const m = (err as { message?: string })?.message;
              toast.warning(
                `Field group created, but ui-schema.json could not be updated${m ? `: ${m}` : ""}.`
              );
            }
            toast.success("Field group created");
            navigateTo(buildRoute(ROUTES.BUILDER_FIELD_GROUPS_EDIT, { slug }));
          })();
        },
        onError: err => {
          // A refused address names its reason per field; the envelope's own message is only
          // "Validation failed.", which says neither what was refused nor why.
          toast.error(
            apiErrorMessage(
              err,
              "Could not create field group. Please try again."
            )
          );
        },
      }
    );
  };

  return (
    <PageContainer>
      {/* One short dialog; Create still writes the entity at once. */}
      <NewEntityDialog
        open={open}
        config={FIELD_GROUP_BUILDER_CONFIG}
        onCancel={() => setOpen(false)}
        onCreate={handleSubmit}
        creating={isPending}
      />
    </PageContainer>
  );
}
