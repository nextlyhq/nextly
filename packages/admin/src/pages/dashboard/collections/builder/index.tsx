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
import { PageContainer } from "@admin/components/layout/page-container";
import { toast } from "@admin/components/ui";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import { useCreateCollection } from "@admin/hooks/queries";
import { toSnakeName } from "@admin/lib/builder";
import { collectionToManifestEntity } from "@admin/lib/builder/to-manifest-entity";
import { navigateTo } from "@admin/lib/navigation";
import { schemaFileApi } from "@admin/services/schemaFileApi";

import { COLLECTION_BUILDER_CONFIG } from "./builder-config";

export default function CollectionBuilderPage(): React.ReactElement | null {
  const [open, setOpen] = useState(true);
  const { mutate: createCollection, isPending } = useCreateCollection();

  // Why: a closed modal on a page that does nothing else is a dead end —
  // navigate back to the listing as soon as the user dismisses.
  useEffect(() => {
    if (!open && !isPending) {
      navigateTo(ROUTES.BUILDER_COLLECTIONS);
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
        // tab. Code-first config can still set admin.group / admin.order;
        // we just don't surface them in the create modal.
        status: values.status === true,
        // i18n H4: forward the wizard's Internationalization toggle so the new
        // collection is actually created as localized (was dropped here, so the
        // collection always persisted as non-localized regardless of the toggle).
        localized: values.i18n === true,
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
          // Mirror the new (field-less) collection to ui-schema.json so the
          // committable manifest stays in sync with the dev DB. Best-effort:
          // a file-write failure warns but never blocks navigation (the DB
          // create already succeeded). Wrapped in a void IIFE so the mutation
          // callback stays synchronous (void return).
          void (async () => {
            try {
              await schemaFileApi.writeCollection(
                collectionToManifestEntity({
                  slug,
                  settings: {
                    singularName: singular,
                    pluralName: plural,
                    status: values.status === true,
                    // i18n H4: keep ui-schema.json in sync with the localized flag.
                    localized: values.i18n === true,
                  },
                  fields: [],
                })
              );
            } catch (err) {
              const m = (err as { message?: string })?.message;
              toast.warning(
                `Collection created, but ui-schema.json could not be updated${m ? `: ${m}` : ""}.`
              );
            }
            toast.success("Collection created");
            // Navigate to the edit page where the user can add fields.
            // We use the slug we computed because the API doesn't return
            // the created entity in this response shape.
            navigateTo(buildRoute(ROUTES.BUILDER_COLLECTIONS_EDIT, { slug }));
          })();
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
