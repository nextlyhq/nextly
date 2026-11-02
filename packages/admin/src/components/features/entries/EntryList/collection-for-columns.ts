/**
 * The table's view of a collection: its fields, labels, default columns and
 * the flags its bulk actions and translation-state column read.
 *
 * @module components/features/entries/EntryList/collection-for-columns
 */
import type { CollectionForColumns } from "./EntryTableColumns";

/**
 * Creates a CollectionForColumns object from collection data.
 * Uses slug as fallback for labels. `showsTranslationState` is whether the
 * user may read every language's translation state, which the table's
 * Languages column and language filter both read.
 */
export function toCollectionForColumns(
  collection:
    | {
        name: string;
        label?: string;
        schemaDefinition?: { fields: Array<{ name?: string; type?: string }> };
        fields?: Array<{ name?: string; type?: string }>;
        admin?: { defaultColumns?: string[]; useAsTitle?: string };
        /**
         * Built-in Draft / Published lifecycle flag (collection-level).
         * Read from the dynamic-collections row or the code-first config.
         * Forwarded to `CollectionForColumns.status` so the table's
         * bulk-action bar can decide whether to render Publish /
         * Unpublish buttons.
         */
        status?: boolean;
        /** i18n: collection has multilingual content — drives the translation-status column. */
        localized?: boolean;
        /** Removed from code: the table offers nothing that writes. */
        removedFromCode?: boolean;
      }
    | undefined,
  slug: string,
  showsTranslationState: boolean
): CollectionForColumns {
  // Default collection structure when data is loading
  if (!collection) {
    return {
      slug,
      fields: [],
      admin: {},
    };
  }

  // Get fields from either new or old API format
  // schemaDefinition.fields is the legacy format from the API
  const rawFields =
    collection.schemaDefinition?.fields || collection.fields || [];
  const fields = rawFields as CollectionForColumns["fields"];

  // Determine default columns: use admin config or auto-generate from first few fields
  // Filter to only data fields (those with name property, excluding layout fields)
  const layoutTypes = ["group", "relationship", "repeater", "component"];
  const dataFields = rawFields.filter(
    (f): f is { name: string; type: string } =>
      typeof f.name === "string" &&
      f.name.length > 0 &&
      typeof f.type === "string" &&
      !layoutTypes.includes(f.type)
  );

  const defaultColumns =
    collection.admin?.defaultColumns || dataFields.slice(0, 4).map(f => f.name);

  const labels = getCollectionLabels(collection, slug);

  return {
    slug,
    label: labels.plural,
    fields,
    // Forward the Draft / Published flag so the bulk-action bar can
    // surface Publish / Unpublish only for collections that opted in.
    status: collection.status === true,
    // Forward the localization flag so the table can render a
    // per-row translation-completeness column and its language filter, for a
    // user who may read every language's state: without it a row's state is
    // absent, every language would read as missing, and a filter by it is
    // refused.
    localized: collection.localized === true && showsTranslationState,
    // Forwarded so the bulk actions, and the row selection and row Delete that
    // follow them, are withheld from a collection removed from code.
    ...(collection.removedFromCode === true ? { removedFromCode: true } : {}),
    admin: {
      useAsTitle: collection.admin?.useAsTitle,
      defaultColumns: [
        "title",
        ...defaultColumns.filter(
          c => c !== "title" && c !== "slug" && c !== "updatedAt"
        ),
        "slug",
        "updatedAt",
      ],
    },
  };
}

/**
 * Gets display labels for the collection.
 */
export function getCollectionLabels(
  collection: { label?: string; name?: string } | undefined,
  slug: string
): { singular: string; plural: string } {
  const displayName = collection?.label || collection?.name || slug;

  // Simple pluralization: add 's' if doesn't already end with 's'
  const plural = displayName.endsWith("s") ? displayName : `${displayName}s`;

  return {
    singular: displayName,
    plural,
  };
}
