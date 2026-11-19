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
  addUnsavedEntities,
  unsavedFieldGroupFrom,
  type UnsavedEntity,
} from "@admin/lib/builder/unsaved-entities";
import { navigateTo } from "@admin/lib/navigation";
import type { FieldDefinition } from "@admin/types/collection";

import { FIELD_GROUP_BUILDER_CONFIG } from "./builder-config";

export default function FieldGroupBuilderPage(): React.ReactElement | null {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (!open) {
      navigateTo(ROUTES.BUILDER_FIELD_GROUPS);
    }
  }, [open]);

  const handleSubmit = (
    values: BuilderSettingsValues,
    templateFields: FieldDefinition[],
    needed: Omit<UnsavedEntity, "token">[]
  ) => {
    // Made here, it has no owner: its own editor's first save creates it. It
    // starts with its template's fields, or none; the rest are added in its
    // editor.
    const entity = {
      ...unsavedFieldGroupFrom(values),
      fields: templateFields,
    };
    const slug = entity.address;
    // Held with the entities the template needs and makes too, all or none,
    // so it is never held without them.
    const added = addUnsavedEntities([...needed, entity]);
    // The dialog's checks count an unsaved entity's address as used, so this
    // is reached only if another unsaved field group took it meanwhile.
    if (!added) {
      toast.error(
        needed.length === 0
          ? "A field group not saved yet already uses this address. Choose another."
          : "An entity not saved yet already uses this address or one the template needs. Choose another."
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
