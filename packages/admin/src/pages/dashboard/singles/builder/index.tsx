"use client";

/**
 * Single Builder — Create Page
 *
 * Mirrors the Collection create flow: opens BuilderSettingsModal directly,
 * on Continue creates the Single with its system fields only and navigates
 * to [slug].tsx for field editing. Same modal-host pattern preserves
 * backwards-compat with every "New single" link in the admin.
 */

import { useEffect, useState } from "react";

import {
  BuilderSettingsModal,
  type BuilderSettingsValues,
} from "@admin/components/features/schema-builder";
import { toast } from "@admin/components/ui";
import { PageContainer } from "@admin/components/layout/page-container";
import { ROUTES } from "@admin/constants/routes";
import { useCreateSingle } from "@admin/hooks/queries";
import { toSnakeName } from "@admin/lib/builder";
import { navigateTo } from "@admin/lib/navigation";

import { SINGLE_BUILDER_CONFIG } from "./builder-config";

export default function SingleBuilderPage(): React.ReactElement | null {
  const [open, setOpen] = useState(true);
  const { mutate: createSingle, isPending } = useCreateSingle();

  // Why: a closed modal on a page that does nothing else is a dead end —
  // route back to the listing as soon as the user dismisses.
  useEffect(() => {
    if (!open && !isPending) {
      navigateTo(ROUTES.SINGLES);
    }
  }, [open, isPending]);

  const handleSubmit = (values: BuilderSettingsValues) => {
    const singular = values.singularName.trim();
    const slug = values.slug?.trim() || toSnakeName(singular);

    createSingle(
      {
        slug,
        label: singular,
        description: values.description?.trim() || undefined,
        admin: {
          icon: values.icon,
          group: values.adminGroup?.trim() || undefined,
          // Order is part of the Single admin block; ApiSingle's admin
          // type accepts arbitrary settings forwarded through.
          ...(values.order !== undefined ? { order: values.order } : {}),
        },
        // Status passes through; backend handles the column synthesis on
        // first enable. Not yet on ApiSingle's typed shape on the create
        // payload — cast through the Partial<ApiSingle>.
        ...(values.status === true ? { status: true } : {}),
        // Empty user-fields list — system columns are auto-injected by
        // the server; user adds custom fields on the next page.
        fields: [],
      },
      {
        onSuccess: () => {
          toast.success("Single created");
          navigateTo(`${ROUTES.SINGLES_BUILDER}/${slug}`);
        },
        onError: err => {
          const error = err as { message?: string };
          toast.error(
            error?.message || "Could not create Single. Please try again."
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
        config={SINGLE_BUILDER_CONFIG}
        initialValues={null}
        onCancel={() => setOpen(false)}
        onSubmit={handleSubmit}
      />
    </PageContainer>
  );
}
