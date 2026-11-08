/**
 * Where a list item's binding reads: the entries of the collection its list
 * shows, as the host lists that collection's fields for a list.
 *
 * The binding field picker lists the page's entry, its Singles and the site,
 * never a list's item, which is a different entry on every row; yet the
 * inspector still names an item binding's field and judges its Format. Both
 * read the list's collection here, by the fields visitors may read
 * (`LoopCollection.readable`), as a save judges a list's bindings, so a
 * format offered is one the save keeps.
 *
 * @module item-binding-source
 */
import {
  outerListOf,
  readListQuery,
  type Binding,
  type BindingFieldShape,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";

import { useLoopCollections } from "./collection-loop-controls";
import type { ContentServices, LoopCollection } from "./content-controls";

/** One field an item binding can read, with what the admin calls it. */
export type ItemField = BindingFieldShape & { readonly label?: string };

/** A list item's source as the chip names it, and the fields it has. */
export interface ItemSource {
  /** "Each post in the list". */
  readonly name: string;
  /** Its fields, once the host has listed the collection; none before. */
  readonly fields: readonly ItemField[];
}

/**
 * A collection's fields as an item binding is judged against them: those
 * visitors may read, with a date picked as a day said so, as the list's own
 * fields say it.
 */
function itemFields(found: LoopCollection): readonly ItemField[] {
  return (found.readable ?? []).map(field => {
    const listed = found.fields.find(each => each.name === field.name);
    return listed?.dateOnly === true ? { ...field, dateOnly: true } : field;
  });
}

/**
 * The source of an item binding on block `nodeId`, or `undefined` for a
 * binding to another source. Asks the host for the collections only for an
 * item binding.
 */
export function useItemSource(
  binding: Binding,
  document: BlockDocument,
  nodeId: string,
  services: ContentServices | undefined
): ItemSource | undefined {
  const item = binding.source === "item";
  const listed = useLoopCollections(
    item ? services?.listLoopCollections : undefined
  );
  if (!item) return undefined;
  const outer = outerListOf(document.nodes, nodeId);
  const collection =
    outer === undefined
      ? undefined
      : readListQuery(outer.props).query.collection;
  const found =
    listed?.kind === "ready"
      ? listed.collections.find(each => each.slug === collection)
      : undefined;
  const one = (found?.singular ?? found?.label ?? "entry").toLowerCase();
  return {
    name: `Each ${one} in the list`,
    fields: found === undefined ? [] : itemFields(found),
  };
}
