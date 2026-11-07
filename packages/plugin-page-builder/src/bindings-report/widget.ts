/**
 * The "Bindings to fix" dashboard card's declaration: for the people who edit
 * pages, hidden while the reader may see no broken binding.
 *
 * Its `load` counts the broken bindings of the documents the reader may read,
 * one read as the reader per collection, so a card that would list nothing is
 * never drawn. The rows the card draws are read by the card itself, through
 * the report's route, which names each document as the reader knows it.
 *
 * @module bindings-report/widget
 */
import { defineWidget, type AnyWidget } from "@nextlyhq/plugin-sdk";

import { BINDINGS_TO_FIX_CARD_COMPONENT } from "../builder-view";

import type { BindingReportStore } from "./store";

/** The permission the card, the page and the route ask for. */
export const EDIT_PAGES_PERMISSION = "update-pages";

/** The card's declaration, reading the report's store when it loads. */
export function bindingsToFixWidget(
  store: () => BindingReportStore | null
): AnyWidget {
  return defineWidget({
    id: "page-builder/bindings-to-fix",
    title: "Bindings to fix",
    description:
      "Bindings whose field or block changed after they were saved, each showing its fallback until it is fixed.",
    category: "Content",
    size: { default: { w: 6, h: 4 }, min: { w: 6, h: 4 } },
    access: EDIT_PAGES_PERMISSION,
    hidesWhenEmpty: true,
    load: async ({ services, signal }) => {
      const kept = store();
      if (kept === null) return { bindings: 0 };
      const stored = await kept.list();
      let bindings = 0;
      // Each collection's documents, as the reader may read them.
      const byCollection = new Map<string, Map<string, number>>();
      for (const entry of stored) {
        if (entry.kind === "single" || entry.documentId === undefined) {
          bindings += entry.rows.length;
          continue;
        }
        const ids = byCollection.get(entry.slug) ?? new Map<string, number>();
        ids.set(entry.documentId, entry.rows.length);
        byCollection.set(entry.slug, ids);
      }
      for (const [collection, ids] of byCollection) {
        try {
          const read = await services.find(collection, {
            where: { id: { in: [...ids.keys()] } },
            select: ["id"],
            limit: ids.size,
            status: "all",
            signal,
          });
          for (const row of read.items) {
            bindings += ids.get(String(row.id)) ?? 0;
          }
        } catch {
          // A collection the reader may not read adds nothing.
        }
      }
      return { bindings };
    },
    view: { component: BINDINGS_TO_FIX_CARD_COMPONENT },
    isEmpty: data => data.bindings === 0,
  });
}
