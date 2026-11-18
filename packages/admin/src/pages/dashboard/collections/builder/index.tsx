"use client";

/**
 * Collection Builder — Create Page
 *
 * The create flow is the new-entity dialog. Create makes the collection a
 * pending change: it waits in this tab's unsaved entities with the starting
 * field the dialog's answer names, and its editor opens on the [slug] page,
 * where the first save creates it on the server. Nothing is written before
 * then, so leaving the editor or discarding its changes leaves nothing behind.
 *
 * Page-level wrap chosen over rendering the modal from the listing page
 * because the existing route /admin/collections/builder is bookmarkable
 * and used by every "New collection" link in the admin. Treating the
 * page as a pure modal-host keeps backwards compat with those links.
 */

import { useEffect, useState } from "react";

import type { BuilderSettingsValues } from "@admin/components/features/schema-builder/BuilderSettingsModal";
import { NewEntityDialog } from "@admin/components/features/schema-builder/new-entity/NewEntityDialog";
import { PageContainer } from "@admin/components/layout/page-container";
import { toast } from "@admin/components/ui";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import { toSnakeName } from "@admin/lib/builder";
import { startingFields } from "@admin/lib/builder/starting-field";
import { addUnsavedEntity } from "@admin/lib/builder/unsaved-entities";
import { navigateTo } from "@admin/lib/navigation";
import type { FieldDefinition } from "@admin/types/collection";

import { COLLECTION_BUILDER_CONFIG } from "./builder-config";

export default function CollectionBuilderPage(): React.ReactElement | null {
  const [open, setOpen] = useState(true);

  // Why: a closed modal on a page that does nothing else is a dead end —
  // navigate back to the listing as soon as the user dismisses.
  useEffect(() => {
    if (!open) {
      navigateTo(ROUTES.BUILDER_COLLECTIONS);
    }
  }, [open]);

  const handleSubmit = (
    values: BuilderSettingsValues,
    templateFields: FieldDefinition[]
  ) => {
    const singular = values.singularName.trim();
    const plural = values.pluralName?.trim() || `${singular}s`;
    const slug = values.slug?.trim() || toSnakeName(singular);
    const added = addUnsavedEntity({
      kind: "collection",
      address: slug,
      settings: { ...values, singularName: singular, pluralName: plural, slug },
      // The field the dialog's answer starts the collection with; the save
      // sends it to the server and to ui-schema.json alike.
      fields: [
        ...startingFields(values.startingFieldType ?? null),
        // The template's fields after the starting one, as picked.
        ...templateFields,
      ],
    });
    // The dialog's check counts an unsaved entity's address as used, so this
    // is reached only if another unsaved collection took it meanwhile.
    if (!added) {
      toast.error(
        "A collection not saved yet already uses this address. Choose another."
      );
      return;
    }
    navigateTo(buildRoute(ROUTES.BUILDER_COLLECTIONS_EDIT, { slug }));
  };

  return (
    <PageContainer>
      <NewEntityDialog
        open={open}
        config={COLLECTION_BUILDER_CONFIG}
        onCancel={() => setOpen(false)}
        onCreate={handleSubmit}
      />
    </PageContainer>
  );
}
