/**
 * What a collection list's query controls read once and share: the props the
 * query is stored in, the fields a list may offer, the problems each part
 * shows, the relations a list can read, and the site's custom sources.
 *
 * @module list-query-reading
 */
import {
  COLLECTION_LIST_TYPE,
  LIST_ENTRY_SLOT,
  listQueryIssues,
  locateNode,
  outerListOf,
  readListQuery,
  type BindingFieldShape,
  type BlockDocument,
  type BlockNode,
  type ListFieldKind,
  type ListFieldSource,
  type ListQuery,
  type ListRelation,
} from "@nextlyhq/blocks-engine";
import * as React from "react";

import type { EditableProp } from "../inspector";

import {
  useLoopCollections,
  type LoopCollections,
} from "./collection-loop-controls";
import type {
  ContentServices,
  LoopCollection,
  LoopListField,
} from "./content-controls";
import { customSourceLookup, type CustomSource } from "./named-query-model";

/** The props a list's query is stored in, in the order the group draws them. */
export const LIST_QUERY_PROPS = [
  "collection",
  "relation",
  "filters",
  "sort",
  "limit",
  "offset",
  "namedQuery",
  "paginate",
] as const;

/** What the group is drawn with: the Content tab's group context. */
export interface ListQueryFieldProps {
  readonly props: readonly EditableProp[];
  readonly writable: (name: string) => boolean;
  readonly services: ContentServices | undefined;
  readonly onCommitMany: (
    changes: Readonly<Record<string, unknown>>
  ) => BlockDocument | null | void;
  /** The document the list is in, for the list around it and its judgement. */
  readonly document: BlockDocument;
  readonly nodeId: string;
  /** Whether the canvas draws this list's empty state. */
  readonly showsEmpty: boolean;
  /**
   * The count of the latest ask, from the list's canvas note, to fix its
   * sort: each new count takes the author to its first sort row.
   */
  readonly sortFieldAsked?: number | undefined;
  /** Draw its empty state, or its entries; absent where nothing can. */
  readonly onShowEmpty?: ((empty: boolean) => void) | undefined;
  /**
   * Tag the list on the canvas while a new source waits for an input, with
   * what it still shows ("Still showing Events"); `undefined` clears it.
   */
  readonly onStillShowing?: ((words: string | undefined) => void) | undefined;
}

/**
 * A collection's fields in the engine's terms, for judging a list against:
 * the public's fields as the host read them for the save's own judgement,
 * so what is said here is what a save would refuse. A host that names none
 * is judged by what it offers, which a save may judge more widely.
 */
export function fieldSourceOf(
  collections: readonly LoopCollection[]
): ListFieldSource {
  const bySlug = new Map(collections.map(each => [each.slug, each]));
  return {
    fieldsOf: slug => {
      const found = bySlug.get(slug);
      if (found === undefined) return undefined;
      const readable: BindingFieldShape[] = [
        ...(found.readable ?? offeredShapes(found)),
      ];
      return {
        declared: new Set([
          ...(found.declared ?? []),
          ...readable.map(shape => shape.name),
        ]),
        readable,
        // The name the Source menu shows, for the engine's words.
        label: found.label,
      };
    },
  };
}

/**
 * A field type of each list kind, the one the engine's `listFieldKind` reads
 * back as that kind: a kind's own name is not always a field type (a choice
 * is a `select`, a yes/no a `checkbox`), and a type the engine does not know
 * has no kind, so its filters and sorts would be refused.
 */
const FIELD_TYPE_OF_KIND: Readonly<Record<ListFieldKind, string>> = {
  text: "text",
  number: "number",
  date: "date",
  boolean: "checkbox",
  choice: "select",
  entry: "relationship",
};

/** The shapes of what a collection offers, for a host naming no others. */
function offeredShapes(found: LoopCollection): BindingFieldShape[] {
  return [
    { name: "id", type: "text" },
    ...found.fields.map(field => ({
      name: field.name,
      type: FIELD_TYPE_OF_KIND[field.kind],
      ...(field.relationTo === undefined
        ? {}
        : { relationTo: field.relationTo }),
    })),
    ...(found.relations ?? []).map(relation => ({
      name: relation.field,
      type: "relationship",
      hasMany: true,
      relationTo: relation.collection,
    })),
  ];
}

/** The problems the engine finds with one list, as a save would. */
export type Issues = ReturnType<typeof listQueryIssues>;

/** The issues about one prop of the list, by the path's last step. */
export function issuesAt(issues: Issues, props: readonly string[]): string[] {
  return issues
    .filter(issue => props.some(prop => issue.path.endsWith(`/props/${prop}`)))
    .map(issue => issue.message);
}

/**
 * The engine's judgement of one part of a list on its own: the list with
 * only that part, inside the same surroundings, so a row's own problem is
 * said beside that row.
 */
export function partIssues(
  node: BlockNode,
  part: Readonly<Record<string, unknown>>,
  fields: ListFieldSource | undefined
): Issues {
  const props = node.props;
  return listQueryIssues(
    [
      {
        ...node,
        props: { collection: props.collection, ...part },
        slots: {},
      },
    ],
    fields === undefined ? {} : { fields }
  ).filter(issue => issue.severity === "error");
}

/** A relation as the menu offers it, of the page's entry or the outer item. */
export interface RelatedSource {
  readonly of: ListRelation["of"];
  readonly field: string;
  readonly collection: string;
  /** "This post's categories", "Each category's featured posts". */
  readonly words: string;
  /** What the relation holds, in words: "categories". */
  readonly what: string;
}

/** The words for a relation source, by whose relation it is. */
function relatedWords(
  of: ListRelation["of"],
  owner: LoopCollection | undefined,
  relationLabel: string
): string {
  const one = (owner?.singular ?? owner?.label ?? "entry").toLowerCase();
  const what = relationLabel.toLowerCase();
  return of === "entry" ? `This ${one}'s ${what}` : `Each ${one}'s ${what}`;
}

/** The related sources a list may show where it sits, with their headings. */
export interface Related {
  readonly entry: readonly RelatedSource[];
  readonly item: readonly RelatedSource[];
  /** "Related to this post", over the entry's relations. */
  readonly entryHeading: string;
  /** "Related to each category", over the outer item's relations. */
  readonly itemHeading: string;
  /**
   * Whether the nearest list around this one holds it in its empty state,
   * which is drawn only when that list has no entries, so with none to
   * relate to.
   */
  readonly inEmptyState?: boolean;
}

/** Whether the nearest list around `id` holds it anywhere but per entry. */
function inListEmptyState(nodes: BlockNode[], id: string): boolean {
  let at = locateNode(nodes, id);
  // Bounded by the document's depth: each step moves one parent out.
  while (at?.parent !== undefined) {
    const parent = at.parent;
    if (parent.type === COLLECTION_LIST_TYPE) {
      return at.slot !== LIST_ENTRY_SLOT;
    }
    at = locateNode(nodes, parent.id);
  }
  return false;
}

/** The related sources a list may show where it sits. */
function relatedSources(
  collections: readonly LoopCollection[],
  entryCollection: string | null | undefined,
  outer: ListQuery | undefined
): Related {
  const ownerOf = (slug: string | null | undefined) =>
    collections.find(each => each.slug === slug);
  const one = (owner: LoopCollection | undefined) =>
    (owner?.singular ?? owner?.label ?? "entry").toLowerCase();
  const sources = (
    of: ListRelation["of"],
    owner: LoopCollection | undefined
  ): RelatedSource[] =>
    (owner?.relations ?? []).map(relation => ({
      of,
      field: relation.field,
      collection: relation.collection,
      words: relatedWords(of, owner, relation.label),
      what: relation.label.toLowerCase(),
    }));
  const entryOwner = ownerOf(entryCollection);
  // Related entries go one level deep: a list inside a list that already
  // shows related entries is offered none of its own.
  const itemOwner =
    outer === undefined || outer.relation !== undefined
      ? undefined
      : ownerOf(outer.collection);
  return {
    entry: sources("entry", entryOwner),
    item: sources("item", itemOwner),
    entryHeading: `Related to this ${one(entryOwner)}`,
    itemHeading: `Related to each ${one(itemOwner)}`,
  };
}

/** A list's query as the group reads it: stored, offered and judged. */
export interface ListQueryReading {
  readonly values: Readonly<Record<string, unknown>>;
  readonly query: ListQuery;
  readonly listed: LoopCollections | undefined;
  /** The site's custom sources, none while they are read or where none can be. */
  readonly customs: readonly CustomSource[];
  /** The same, or `undefined` until they are read, so "not set up" waits. */
  readonly customsRead: readonly CustomSource[] | undefined;
  /**
   * Whether the site's collections could be listed: where they could not,
   * the Source menu offers its custom sources alone.
   */
  readonly collectionsOffered: boolean;
  readonly collections: readonly LoopCollection[];
  readonly fieldSource: ListFieldSource | undefined;
  readonly issues: Issues;
  readonly related: Related;
  readonly fields: readonly LoopListField[];
}

/**
 * The list's query, read by the engine from its props; the host's
 * collections; and the engine's judgement of the list where it sits, the
 * collection its document is an entry of and the list around it included.
 */
export function useListQueryReading(
  props: readonly EditableProp[],
  services: ContentServices | undefined,
  document: BlockDocument,
  nodeId: string
): ListQueryReading {
  const values = React.useMemo(
    () => Object.fromEntries(props.map(prop => [prop.name, prop.value])),
    [props]
  );
  const { query } = readListQuery(values);
  const listed = useLoopCollections(services?.listLoopCollections);
  const customs = useCustomSources(services?.listCustomSources);
  const collections = listed?.kind === "ready" ? listed.collections : [];
  const fieldSource = React.useMemo(
    () =>
      listed?.kind === "ready" ? fieldSourceOf(listed.collections) : undefined,
    [listed]
  );
  const entryCollection = services?.entryCollection;
  // A custom source is judged against the site's queries once they are
  // read: before that, by its shape alone, so a query not yet listed is
  // never called unknown.
  const namedQueries = React.useMemo(
    () => (customs === undefined ? undefined : customSourceLookup(customs)),
    [customs]
  );
  const issues = React.useMemo(
    () =>
      listQueryIssues(document.nodes, {
        ...(fieldSource === undefined ? {} : { fields: fieldSource }),
        ...(entryCollection === undefined ? {} : { entryCollection }),
        ...(namedQueries === undefined ? {} : { namedQueries }),
        // So a component's or a Layout region's list is told at once that it
        // can't be split into pages, as its save would be.
        documentKind: document.kind,
      }).filter(issue => issue.nodeId === nodeId && issue.severity === "error"),
    [document, nodeId, fieldSource, entryCollection, namedQueries]
  );
  // The list whose entry is this one's item, as the save judges it: never
  // one whose empty state this list sits in.
  const outerNode = outerListOf(document.nodes, nodeId);
  const outer =
    outerNode === undefined ? undefined : readListQuery(outerNode.props).query;
  return {
    values,
    query,
    listed,
    customs: customs ?? [],
    collectionsOffered: listed?.kind === "ready",
    // A host lending no custom sources has none: a stored one is not set up.
    customsRead: services?.listCustomSources === undefined ? [] : customs,
    collections,
    fieldSource,
    issues,
    related: {
      ...relatedSources(collections, entryCollection, outer),
      inEmptyState: inListEmptyState(document.nodes, nodeId),
    },
    fields:
      collections.find(each => each.slug === query.collection)?.fields ?? [],
  };
}

/** The words a related source is shown in, for the line under Filters. */
export function relatedShownOf(
  query: ListQuery,
  related: Related
): string | undefined {
  const relation = query.relation;
  if (relation === undefined) return undefined;
  return [...related.entry, ...related.item].find(
    each => each.of === relation.of && each.field === relation.field
  )?.words;
}

/** How long the inspector waits before asking again for custom sources. */
const SOURCES_RETRY_MS = 2000;
/** The longest it waits between asks. */
const SOURCES_RETRY_MOST_MS = 60_000;

/** The host's custom sources, read once for every list asking while it runs. */
type ListCustomSources = NonNullable<ContentServices["listCustomSources"]>;

/**
 * The read in flight, per host function, shared only while it runs, for the
 * reason the collections' read is (`collection-loop-controls`): an answer
 * is one signed-in author's.
 */
const customsInFlight = new WeakMap<
  ListCustomSources,
  Promise<readonly CustomSource[]>
>();

/** The host's custom sources, one read shared by every list asking at once. */
function readCustomSources(
  list: ListCustomSources
): Promise<readonly CustomSource[]> {
  const held = customsInFlight.get(list);
  if (held !== undefined) return held;
  const answer = list();
  customsInFlight.set(list, answer);
  const settle = () => {
    if (customsInFlight.get(list) === answer) customsInFlight.delete(list);
  };
  answer.then(settle, settle);
  return answer;
}

/**
 * The site's custom sources, or `undefined` while they are read, where the
 * host lends no way to list them, or where the read failed: the Source menu
 * then offers collections and related entries, as it did before there were
 * custom sources.
 */
export function useCustomSources(
  list: ListCustomSources | undefined
): readonly CustomSource[] | undefined {
  const [found, setFound] = React.useState<{
    readonly list: ListCustomSources;
    readonly sources: readonly CustomSource[];
  }>();
  // Each failed read is asked again, after a wait that doubles to a cap, so
  // one failed request never leaves the menu without its custom sources.
  const [failures, setFailures] = React.useState(0);
  React.useEffect(() => {
    if (list === undefined) return;
    let live = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    readCustomSources(list).then(
      sources => {
        if (live) setFound({ list, sources });
      },
      () => {
        if (!live) return;
        retry = setTimeout(
          () => setFailures(count => count + 1),
          Math.min(SOURCES_RETRY_MS * 2 ** failures, SOURCES_RETRY_MOST_MS)
        );
      }
    );
    return () => {
      live = false;
      if (retry !== undefined) clearTimeout(retry);
    };
  }, [list, failures]);
  return list !== undefined && found?.list === list ? found.sources : undefined;
}
