import { useCan } from "@admin/hooks/useCan";

import type { CollectionForColumns } from "./EntryTableColumns";

/** Which bulk actions the entry list offers on a collection. */
export interface EntryBulkActions {
  delete: boolean;
  publish: boolean;
  unpublish: boolean;
  /**
   * Whether any of them is offered, and so whether rows can be selected at
   * all: a selection with nothing to do with it is a control that leads
   * nowhere.
   */
  any: boolean;
}

/**
 * The bulk actions the current user may use on `collection`, each as the
 * server answers its permission. Publish and unpublish exist only on a
 * collection with the built-in Draft / Published lifecycle (`status: true`),
 * so a permission for them on any other collection offers nothing.
 *
 * One answer for the table's checkboxes, its row Delete, the bulk bar and the
 * list's keyboard shortcuts, so none of them offers what another withholds.
 * The slug is empty without a collection, which no permission matches, so the
 * hooks stay unconditional and the answer is "nothing".
 */
export function useEntryBulkActions(
  collection:
    | Pick<CollectionForColumns, "slug" | "status" | "removedFromCode">
    | undefined
): EntryBulkActions {
  const slug = collection?.slug ?? "";
  const hasStatus = collection?.status === true;
  // A collection removed from code refuses every write to its entries, so no
  // permission offers one here.
  const writable = collection?.removedFromCode !== true;
  const canDelete = useCan(`delete-${slug}`);
  const canPublish = useCan(`publish-${slug}`);
  const canUnpublish = useCan(`unpublish-${slug}`);

  const offered = {
    delete: writable && slug !== "" && canDelete,
    publish: writable && hasStatus && canPublish,
    unpublish: writable && hasStatus && canUnpublish,
  };
  return {
    ...offered,
    any: offered.delete || offered.publish || offered.unpublish,
  };
}
