"use client";

/**
 * Component Builder — Create Page
 *
 * Mirrors the Collection / Single create flow: opens BuilderSettingsModal
 * directly, on Continue creates the Component (no fields yet) and
 * navigates to [slug].tsx for field editing.
 *
 * Components diverge from Collection/Single: no plural, no useAsTitle,
 * no order, no status, no timestamps, no hooks. Category replaces
 * adminGroup.
 */

import { useEffect, useState } from "react";

import {
  BuilderSettingsModal,
  type BuilderSettingsValues,
} from "@admin/components/features/schema-builder";
import { toast } from "@admin/components/ui";
import { ROUTES } from "@admin/constants/routes";
import { useCreateComponent } from "@admin/hooks/queries/useComponents";
import { toSnakeName } from "@admin/lib/builder";
import { navigateTo } from "@admin/lib/navigation";

import { COMPONENT_BUILDER_CONFIG } from "./builder-config";

export default function ComponentBuilderPage(): React.ReactElement | null {
  const [open, setOpen] = useState(true);
  const { mutate: createComponent, isPending } = useCreateComponent();

  useEffect(() => {
    if (!open && !isPending) {
      navigateTo(ROUTES.COMPONENTS);
    }
  }, [open, isPending]);

  const handleSubmit = (values: BuilderSettingsValues) => {
    const singular = values.singularName.trim();
    const slug = values.slug?.trim() || toSnakeName(singular);

    createComponent(
      {
        slug,
        label: singular,
        description: values.description?.trim() || undefined,
        admin: {
          category: values.category?.trim() || undefined,
          icon: values.icon,
        },
        // Empty user-fields list — server auto-injects system columns.
        fields: [],
      },
      {
        onSuccess: () => {
          toast.success("Component created");
          navigateTo(`${ROUTES.COMPONENTS_BUILDER}/${slug}`);
        },
        onError: err => {
          const error = err as { message?: string };
          toast.error(
            error?.message || "Could not create component. Please try again."
          );
        },
      }
    );
  };

  return (
    <BuilderSettingsModal
      open={open}
      mode="create"
      config={COMPONENT_BUILDER_CONFIG}
      initialValues={null}
      onCancel={() => setOpen(false)}
      onSubmit={handleSubmit}
    />
  );
}
