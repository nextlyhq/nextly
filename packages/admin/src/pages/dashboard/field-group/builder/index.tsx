"use client";

/**
 * Field Group Builder, create page.
 *
 * Mirrors the Collection / Single create flow: opens the new-entity dialog
 * directly, and Create makes the field group a pending change, waiting in
 * this tab's unsaved entities with no fields yet, then opens its editor on
 * [slug].tsx, whose first save creates it.
 *
 * Field groups diverge from Collection/Single: no plural, no useAsTitle,
 * no order, no status, no timestamps, no hooks. Category replaces
 * adminGroup.
 */

import { useEffect, useState } from "react";

import type { BuilderSettingsValues } from "@admin/components/features/schema-builder/BuilderSettingsModal";
import { NewEntityDialog } from "@admin/components/features/schema-builder/new-entity/NewEntityDialog";
import { PageContainer } from "@admin/components/layout/page-container";
import { toast } from "@admin/components/ui";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import {
  addUnsavedEntity,
  unsavedFieldGroupFrom,
} from "@admin/lib/builder/unsaved-entities";
import { navigateTo } from "@admin/lib/navigation";

import { FIELD_GROUP_BUILDER_CONFIG } from "./builder-config";

export default function FieldGroupBuilderPage(): React.ReactElement | null {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (!open) {
      navigateTo(ROUTES.BUILDER_FIELD_GROUPS);
    }
  }, [open]);

  const handleSubmit = (values: BuilderSettingsValues) => {
    // Made here, it has no owner: its own editor's first save creates it.
    const entity = unsavedFieldGroupFrom(values);
    const slug = entity.address;
    const added = addUnsavedEntity(entity);
    // The dialog's check counts an unsaved entity's address as used, so this
    // is reached only if another unsaved field group took it meanwhile.
    if (!added) {
      toast.error(
        "A field group not saved yet already uses this address. Choose another."
      );
      return;
    }
    navigateTo(buildRoute(ROUTES.BUILDER_FIELD_GROUPS_EDIT, { slug }));
  };

  return (
    <PageContainer>
      <NewEntityDialog
        open={open}
        config={FIELD_GROUP_BUILDER_CONFIG}
        onCancel={() => setOpen(false)}
        onCreate={handleSubmit}
      />
    </PageContainer>
  );
}
