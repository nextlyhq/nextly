"use client";

/**
 * Collection Builder — Create Page
 *
 * The create flow is now a focused settings modal: user fills the modal,
 * clicks Continue, the collection is created with its system fields only,
 * and the user lands on the [slug].tsx edit page to add custom fields.
 *
 * Page-level wrap chosen over rendering the modal from the listing page
 * because the existing route /admin/collections/builder is bookmarkable
 * and used by every "New collection" link in the admin. Treating the
 * page as a pure modal-host keeps backwards compat with those links.
 */

import { useEffect, useState } from "react";

import {
  BuilderSettingsModal,
  type BuilderSettingsValues,
} from "@admin/components/features/schema-builder/BuilderSettingsModal";
import { toast } from "@admin/components/ui";
import { PageContainer } from "@admin/components/layout/page-container";
import { ROUTES } from "@admin/constants/routes";
import { useCreateCollection } from "@admin/hooks/queries";
import { toSnakeName } from "@admin/lib/builder";
import { navigateTo } from "@admin/lib/navigation";

import { COLLECTION_BUILDER_CONFIG } from "./builder-config";

export default function CollectionBuilderPage(): React.ReactElement | null {
  const [open, setOpen] = useState(true);
  const { mutate: createCollection, isPending } = useCreateCollection();

  // Why: a closed modal on a page that does nothing else is a dead end —
  // navigate back to the listing as soon as the user dismisses.
  useEffect(() => {
    if (!open && !isPending) {
      navigateTo(ROUTES.COLLECTIONS);
    }
  }, [open, isPending]);

  const handleSubmit = (values: BuilderSettingsValues) => {
    const singular = values.singularName.trim();
    const plural = values.pluralName?.trim() || `${singular}s`;
    const slug = values.slug?.trim() || toSnakeName(singular);

    createCollection(
      {
        name: slug,
        labels: { singular, plural },
        description: values.description?.trim() || undefined,
        icon: values.icon,
        group: values.adminGroup?.trim() || undefined,
        order: values.order,
        status: values.status === true,
        // Why: useAsTitle + timestamps removed in PR B. Backend defaults
        // (timestamps always on, useAsTitle = system title) take over.
        // Code-first config can still override either.
        // Empty user-fields list: the API auto-injects system columns
        // (id, title, slug, timestamps, status if enabled). The user
        // adds custom fields on the next page.
        fields: [],
      },
      {
        onSuccess: () => {
          toast.success("Collection created");
          // Navigate to the edit page where the user can add fields.
          // We use the slug we computed because the API doesn't return
          // the created entity in this response shape.
          navigateTo(`${ROUTES.COLLECTIONS_BUILDER}/${slug}`);
        },
        onError: err => {
          const error = err as { message?: string };
          toast.error(
            error?.message || "Could not create collection. Please try again."
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
        config={COLLECTION_BUILDER_CONFIG}
        initialValues={null}
        onCancel={() => setOpen(false)}
        onSubmit={handleSubmit}
      />
    </PageContainer>
  );
}
