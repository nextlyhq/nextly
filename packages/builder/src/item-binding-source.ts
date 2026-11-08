/**
 * Where a list item's binding reads: the entries of the collection its list
 * shows, as the host lists that collection's fields for a list, or, for a
 * list fed by a named query, that query's rows: a collection's entries, or
 * the fields the query declares for rows of its own.
 *
 * The binding field picker lists the page's entry, its Singles and the site,
 * never a list's item, which is a different entry on every row; yet the
 * inspector still names an item binding's field and judges its Format. Both
 * read the list's items here: a collection's by the fields visitors may read
 * (`LoopCollection.readable`), a named query's own rows by the fields it
 * declares, as a save judges a list's bindings, so a format offered is one
 * the save keeps.
 *
 * @module item-binding-source
 */
import {
  namedQueryRowFields,
  outerListOf,
  readListQuery,
  type Binding,
  type BindingFieldShape,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";

import { useLoopCollections } from "./collection-loop-controls";
import type { ContentServices, LoopCollection } from "./content-controls";
import { useCustomSources } from "./list-query-controls";
import { customSourceLookup, type CustomSource } from "./named-query-model";

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

/** What a list's items are, as an item binding reads them. */
interface ListItems {
  /** The collection its items are entries of, where they are one's. */
  readonly found: LoopCollection | undefined;
  /** Their fields, once known; none before. */
  readonly fields: readonly ItemField[];
}

/**
 * The items of the list whose query is `query`: its collection's entries, or
 * a named query's rows by the engine's one rule for them
 * (`namedQueryRowFields`), the declared fields of rows of its own or the
 * fields of the collection they are entries of. A named query not (yet) read
 * has no fields, so no Format is offered for it until it is.
 */
function listItems(
  query: ReturnType<typeof readListQuery>["query"] | undefined,
  collections: readonly LoopCollection[],
  customs: readonly CustomSource[] | undefined
): ListItems {
  const bySlug = (slug: string | undefined) =>
    collections.find(each => each.slug === slug);
  const name = query?.namedQuery?.name;
  if (name === undefined) {
    const found = bySlug(query?.collection);
    return { found, fields: found === undefined ? [] : itemFields(found) };
  }
  if (customs === undefined) return { found: undefined, fields: [] };
  const lookup = customSourceLookup(customs);
  const rows = lookup.declarationOf(name)?.rows;
  const fields = namedQueryRowFields(lookup, name, slug => {
    const found = bySlug(slug);
    return found === undefined ? undefined : itemFields(found);
  });
  return {
    found:
      rows !== undefined && "collection" in rows
        ? bySlug(rows.collection)
        : undefined,
    fields: fields ?? [],
  };
}

/**
 * The source of an item binding on block `nodeId`, or `undefined` for a
 * binding to another source. Asks the host for the collections, and for its
 * named queries, only for an item binding.
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
  const customs = useCustomSources(
    item ? services?.listCustomSources : undefined
  );
  if (!item) return undefined;
  const outer = outerListOf(document.nodes, nodeId);
  const { found, fields } = listItems(
    outer === undefined ? undefined : readListQuery(outer.props).query,
    listed?.kind === "ready" ? listed.collections : [],
    customs
  );
  const one = (found?.singular ?? found?.label ?? "entry").toLowerCase();
  return { name: `Each ${one} in the list`, fields };
}
