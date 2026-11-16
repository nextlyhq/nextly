"use client";

/**
 * Single Builder — Create Page
 *
 * Mirrors the Collection create flow: opens the new-entity dialog directly,
 * and Create makes the Single a pending change, waiting in this tab's unsaved
 * entities with the starting field the dialog's answer names, then opens its
 * editor on [slug].tsx, whose first save creates it. Same modal-host pattern
 * preserves backwards-compat with every "New single" link in the admin.
 */

import { useEffect, useState } from "react";

import type { BuilderSettingsValues } from "@admin/components/features/schema-builder";
import { NewEntityDialog } from "@admin/components/features/schema-builder/new-entity/NewEntityDialog";
import { PageContainer } from "@admin/components/layout/page-container";
import { toast } from "@admin/components/ui";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import { toKebabName } from "@admin/lib/builder";
import { startingFields } from "@admin/lib/builder/starting-field";
import { addUnsavedEntity } from "@admin/lib/builder/unsaved-entities";
import { navigateTo } from "@admin/lib/navigation";

import { SINGLE_BUILDER_CONFIG } from "./builder-config";

export default function SingleBuilderPage(): React.ReactElement | null {
  const [open, setOpen] = useState(true);

  // Why: a closed modal on a page that does nothing else is a dead end —
  // route back to the listing as soon as the user dismisses.
  useEffect(() => {
    if (!open) {
      navigateTo(ROUTES.BUILDER_SINGLES);
    }
  }, [open]);

  const handleSubmit = (values: BuilderSettingsValues) => {
    const singular = values.singularName.trim();
    // Why: registry slug is kebab-case (web URL convention + matches the
    // entry-form slug validator). Table name is derived downstream by
    // generateTableName, which converts hyphens to underscores.
    const slug = values.slug?.trim() || toKebabName(singular);
    const added = addUnsavedEntity({
      kind: "single",
      address: slug,
      settings: { ...values, singularName: singular, slug },
      // The field the dialog's answer starts the Single with (the Page
      // Builder's blocks field, say), or none for standard fields; the save
      // sends it to the server and to ui-schema.json alike.
      fields: startingFields(values.startingFieldType ?? null),
    });
    // The dialog's check counts an unsaved entity's address as used, so this
    // is reached only if another unsaved Single took it meanwhile.
    if (!added) {
      toast.error(
        "A Single not saved yet already uses this address. Choose another."
      );
      return;
    }
    navigateTo(buildRoute(ROUTES.BUILDER_SINGLES_EDIT, { slug }));
  };

  return (
    <PageContainer>
      <NewEntityDialog
        open={open}
        config={SINGLE_BUILDER_CONFIG}
        onCancel={() => setOpen(false)}
        onCreate={handleSubmit}
      />
    </PageContainer>
  );
}
