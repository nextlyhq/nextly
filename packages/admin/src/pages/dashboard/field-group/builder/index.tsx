"use client";

/**
 * Field Group Builder, create page.
 *
 * Mirrors the Collection / Single create flow: opens BuilderSettingsModal
 * directly, on Continue creates the field group (no fields yet) and
 * navigates to [slug].tsx for field editing.
 *
 * Field groups diverge from Collection/Single: no plural, no useAsTitle,
 * no order, no status, no timestamps, no hooks. Category replaces
 * adminGroup.
 */

import { useEffect, useState } from "react";

import {
  BuilderSettingsModal,
  type BuilderSettingsValues,
} from "@admin/components/features/schema-builder";
import { PageContainer } from "@admin/components/layout/page-container";
import { toast } from "@admin/components/ui";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import { useCreateFieldGroup } from "@admin/hooks/queries/useFieldGroups";
import { toSnakeName } from "@admin/lib/builder";
import { fieldGroupToManifestEntity } from "@admin/lib/builder/to-manifest-entity-field-group";
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

    createFieldGroup(
      {
        slug,
        label: singular,
        description: values.description?.trim() || undefined,
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
                fieldGroupToManifestEntity({
                  slug,
                  settings: {
                    singularName: singular,
                    // Carried for the same reason the edit path carries it: the
                    // upsert writes this column unconditionally, so a manifest
                    // omitting it clears a deployed description rather than
                    // leaving it alone.
                    description: values.description,
                    // i18n: mirror the Internationalization flag into ui-schema.json.
                    localized: values.i18n === true,
                  },
                  fields: [],
                })
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
          const error = err as { message?: string };
          toast.error(
            error?.message || "Could not create field group. Please try again."
          );
        },
      }
    );
  };

  return (
    <PageContainer>
      <BuilderSettingsModal
        open={open}
        mode="create"
        config={FIELD_GROUP_BUILDER_CONFIG}
        initialValues={null}
        onCancel={() => setOpen(false)}
        onSubmit={handleSubmit}
      />
    </PageContainer>
  );
}
