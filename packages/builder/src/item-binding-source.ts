/**
 * Where a list item's binding reads: the entries of the collection its list
 * shows, as the host lists that collection's fields for a list, or, for a
 * list fed by a named query, that query's rows: a collection's entries, or
 * the fields the query declares for rows of its own.
 *
 * The list's item is the source nearest a block inside a list: the binding
 * field picker lists its fields first, the inspector names an item binding's
 * field, and judges its Format. All three read the list's items here: a
 * collection's by the fields visitors may read (`LoopCollection.readable`), a
 * named query's own rows by the fields it declares, as a save judges a list's
 * bindings, so a field offered, and a format, is one the save keeps.
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
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import type {
  BindingFieldChoice,
  ListSample,
  ListSampleValue,
} from "./binding-services";
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
  /** One of the list's entries, as the name says it: "post". */
  readonly one: string;
  /** Its fields, once the host has listed the collection; none before. */
  readonly fields: readonly ItemField[];
  /**
   * The list whose entries the item is, as the document stores it; absent
   * for an item binding left outside every list.
   */
  readonly list?: BlockNode;
  /** Whether the host is still listing the list's collections. */
  readonly loading: boolean;
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

/** The most lists one block may sit inside, as a document's depth bounds it. */
const MOST_LISTS = 64;

/**
 * Every list whose entries `id` is drawn in, innermost first: the list
 * {@link outerListOf} finds, then the one around it, and so on out.
 *
 * @param nodes - the document's nodes
 * @param id - the block
 * @returns the lists, nearest first; none outside every list's entries
 */
function enclosingLists(nodes: BlockNode[], id: string): readonly BlockNode[] {
  const lists: BlockNode[] = [];
  // Bounded: each step moves one list out, and no document is this deep.
  for (
    let list = outerListOf(nodes, id);
    list !== undefined && lists.length < MOST_LISTS;
    list = outerListOf(nodes, list.id)
  ) {
    lists.push(list);
  }
  return lists;
}

/** One list's item, named, from the collections and queries read. */
function itemOf(
  list: BlockNode,
  collections: ReturnType<typeof useLoopCollections>,
  customs: readonly CustomSource[] | undefined
): ItemSource {
  const query = readListQuery(list.props).query;
  const { found, fields } = listItems(
    query,
    collections?.kind === "ready" ? collections.collections : [],
    customs
  );
  const one = (found?.singular ?? found?.label ?? "entry").toLowerCase();
  return {
    name: `Each ${one} in the list`,
    one,
    fields,
    list,
    loading: collections?.kind === "loading",
  };
}

/**
 * The item of every list block `nodeId` sits in, nearest first: none outside
 * every list's entries. Asks the host for the collections, and for its named
 * queries, only while `wanted`, and only for a block in a list.
 *
 * @param document - the document the block is in
 * @param nodeId - the block
 * @param services - the host's reads
 * @param wanted - whether the items are asked for at all
 * @returns each list's item source, named, with its fields once read
 */
export function useListItems(
  document: BlockDocument,
  nodeId: string,
  services: ContentServices | undefined,
  wanted: boolean
): readonly ItemSource[] {
  // Found in the document first, so a block outside every list asks the
  // host for nothing.
  const lists = wanted ? enclosingLists(document.nodes, nodeId) : [];
  const listed = useLoopCollections(
    lists.length === 0 ? undefined : services?.listLoopCollections
  );
  // The site's named queries only for a list fed by one: a collection's list
  // has no need of them, and their read is retried while it fails.
  const named = lists.some(
    list => readListQuery(list.props).query.namedQuery !== undefined
  );
  const customs = useCustomSources(
    named ? services?.listCustomSources : undefined
  );
  return lists.map(list => itemOf(list, listed, customs));
}

/**
 * The item of the list block `nodeId` sits in, nearest first, or `undefined`
 * outside every list's entries: the first of {@link useListItems}.
 */
export function useListItem(
  document: BlockDocument,
  nodeId: string,
  services: ContentServices | undefined,
  wanted: boolean
): ItemSource | undefined {
  return useListItems(document, nodeId, services, wanted)[0];
}

/**
 * The source of an item binding on block `nodeId`, or `undefined` for a
 * binding to another source: the item of the list it names (`list`), else
 * of the nearest list, asked for only for an item binding.
 */
export function useItemSource(
  binding: Binding,
  document: BlockDocument,
  nodeId: string,
  services: ContentServices | undefined
): ItemSource | undefined {
  const item = binding.source === "item";
  const items = useListItems(document, nodeId, services, item);
  if (!item) return undefined;
  const named = "list" in binding ? binding.list : undefined;
  const found =
    named === undefined
      ? items[0]
      : items.find(each => each.list?.id === named);
  if (found !== undefined) return found;
  // An item binding outside every list, or naming a list it is not inside,
  // still names its source, with no fields to name its field from: the save
  // refuses it there.
  return {
    name: "Each entry in the list",
    one: "entry",
    fields: [],
    loading: false,
  };
}

/**
 * A sampled value as a field choice says it: its start as text, a picture's
 * thumbnail, or that the field holds nothing.
 */
function sampled(
  value: ListSampleValue | undefined,
  field: ItemField,
  picture: string | undefined
): Pick<BindingFieldChoice, "preview" | "thumbnail" | "empty"> {
  if (picture !== undefined) return { thumbnail: picture };
  if (value === undefined) return {};
  // A media item stored by its id: its picture, once read, never the id.
  if (typeof value === "string") {
    return field.type === "upload" ? {} : { preview: value };
  }
  return "thumbnail" in value
    ? { thumbnail: value.thumbnail }
    : { empty: true as const };
}

/**
 * A list item's fields as the picker lists them: each one visitors may read
 * (only those are listed for an item), with its value in the sampled entry
 * (the one the author clicked, else the first) where the host read one, one
 * step into a group or a relation.
 */
export function itemChoices(
  fields: readonly ItemField[],
  sample: ListSample | undefined,
  parent?: string,
  /** The pictures the sample names by id, read, by the field's path. */
  pictures?: ReadonlyMap<string, string>
): readonly BindingFieldChoice[] {
  return fields.map(field => {
    const { fields: inside, ...own } = field;
    const path = parent === undefined ? field.name : `${parent}.${field.name}`;
    return {
      ...own,
      public: true,
      ...sampled(sample?.[path], field, pictures?.get(path)),
      // One step in, as the host lists a source's fields.
      ...(inside === undefined || parent !== undefined
        ? {}
        : { fields: itemChoices(inside, sample, path, pictures) }),
    };
  });
}
