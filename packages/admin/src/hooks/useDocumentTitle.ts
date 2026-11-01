"use client";

/**
 * Puts the item a screen shows into the browser tab's title, before the
 * screen's and the site's names: "Hello world · Posts · Golden Shop".
 *
 * A screen that opens one item (an entry, a webhook, a role) calls this with
 * the item's name as it currently knows it: `undefined` while the item is
 * loading, then its name, then any new name after a save. The title follows
 * each change, and drops the item when the screen unmounts. The screen's own
 * name is the route table's, so a screen without an item calls nothing.
 *
 * @module hooks/useDocumentTitle
 */
import { useContext, useId, useLayoutEffect } from "react";

import { DocumentTitleContext } from "@admin/context/providers/DocumentTitleProvider";

export function useDocumentTitle(itemName: string | null | undefined): void {
  const items = useContext(DocumentTitleContext);
  const id = useId();
  const name = itemName?.trim() || undefined;

  // Offers and renames the item. Without a cleanup of its own, so a rename
  // updates the item in place and keeps this part's place in mount order.
  useLayoutEffect(() => {
    items?.set(id, name);
  }, [items, id, name]);

  // Withdraws the item only when this part of the screen goes.
  useLayoutEffect(() => {
    if (!items) return undefined;
    return () => items.remove(id);
  }, [items, id]);
}
