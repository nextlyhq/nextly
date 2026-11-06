/**
 * A blocks field's write, judged for the fields its collection lists name.
 *
 * The engine judges a list's query by its shape on every write. Whether a
 * filter or a sort names a field its collection has, and one visitors may
 * read, needs the schema and the public's access, which only the server
 * knows; this asks them and hands the answer to the engine's own judgement
 * (`listQueryIssues`), so the editor, the API, an import and an agent are
 * all refused alike, naming the field.
 *
 * A problem the stored page already held is kept rather than refused, as a
 * class reference the site has since removed is: a list saved before a field
 * was removed or hidden must not make its page unsavable for a change nobody
 * made to it. The published page lists it in id order and tells its author.
 *
 * @module fields/list-query-judgement
 */
import {
  COLLECTION_LIST_TYPE,
  componentPlacementsIn,
  isErrorIssue,
  isPlainRecord,
  LIST_FIELD_CODES,
  listQueryIssues,
  walkNodes,
  type BindingFieldShape,
  type BlockDocument,
  type BlockNode,
  type ListFields,
  type ListFieldSource,
  type ResolvedBlockNode,
} from "@nextlyhq/blocks-engine";
import {
  addressableFields,
  type PluginFieldIssue,
  type PluginFieldValidateArgs,
  type PluginFieldWrite,
} from "@nextlyhq/plugin-sdk";

import { pluralLabelOf } from "../collection-labels";

import type { StoredForms } from "./added-undefined-ids";

/**
 * The fields of one collection, read when asked, in the language a write is
 * judged in (`locale`), or every configured language when none is named: a
 * field's public read rule may depend on the language, and the published
 * list is read in the page's.
 */
export type ListFieldsReader = (
  collection: string,
  locale?: string
) => Promise<ListFields | undefined>;

/** The timestamps a collection keeps unless it turns them off, as dates. */
const TIMESTAMPS: readonly BindingFieldShape[] = [
  { name: "createdAt", type: "date" },
  { name: "updatedAt", type: "date" },
];

/**
 * A collection's fields as a list is judged by: every name its record
 * declares, with the id and the timestamps it keeps, and the fields the
 * public may read, as a published page's bindings are judged.
 *
 * `readable` is `bindingFieldShapes`, the one answer to which fields an
 * anonymous visitor may read: the access gate, each field's read rule and
 * the hidden-field rule. `undefined` for a collection with no record.
 */
export function listFieldsFrom(reads: {
  readonly record: (collection: string) => Promise<unknown>;
  readonly readable: (
    collection: string,
    locale?: string
  ) => Promise<readonly BindingFieldShape[] | undefined>;
}): ListFieldsReader {
  return async (collection, locale) => {
    const found = await reads.record(collection).catch(() => undefined);
    if (typeof found !== "object" || found === null) return undefined;
    const record = found as { timestamps?: unknown; fields?: unknown };
    const stamps = record.timestamps === false ? [] : TIMESTAMPS;
    const declared = new Set<string>([
      "id",
      ...stamps.map(stamp => stamp.name),
    ]);
    for (const field of addressableFields(record.fields)) {
      if (typeof field.name === "string") declared.add(field.name);
    }
    const shapes = await (locale === undefined
      ? reads.readable(collection)
      : reads.readable(collection, locale));
    // The name the editor's Source menu shows, so a finding names the
    // collection as the author reads it.
    const { pluralLabel } = pluralLabelOf(found as Record<string, unknown>);
    return {
      ...(pluralLabel === undefined ? {} : { label: pluralLabel }),
      declared,
      // A collection the public may read none of has no readable field, so
      // every field a list names on it is refused as one visitors can't see.
      readable:
        shapes === undefined
          ? []
          : [{ name: "id", type: "text" }, ...stamps, ...shapes],
    };
  };
}

/**
 * Where a forest's lists are judged: the language their fields are read in
 * (every configured one when absent) and the collection of the entry the
 * page shows, as {@link ListQueryJudgement.entryCollection} takes it.
 */
export interface ListSetting {
  readonly locale?: string;
  readonly entryCollection?: string | null;
}

/**
 * A write's setting: its language, and the collection its page is an entry
 * of, for a list of the entry's related entries; `null` for a Single's, whose
 * page has no entry to read a relation of, so such a list is refused rather
 * than judged by its shape.
 */
export function listSettingOf(write: PluginFieldWrite): ListSetting {
  return {
    ...(write.locale === undefined ? {} : { locale: write.locale }),
    entryCollection: write.kind === "collection" ? write.slug : null,
  };
}

/** The collections a judgement over `nodes` asks about, and nothing read. */
function collectionsAsked(
  nodes: readonly unknown[],
  entryCollection: string | null | undefined
): Set<string> {
  const asked = new Set<string>();
  listQueryIssues(nodes, {
    fields: {
      fieldsOf: collection => {
        asked.add(collection);
        return undefined;
      },
    },
    ...(entryCollection === undefined ? {} : { entryCollection }),
  });
  return asked;
}

/** Each asked collection's fields, read once, as the engine's sync source. */
async function sourceFor(
  forests: readonly (readonly unknown[])[],
  setting: ListSetting,
  read: ListFieldsReader,
  known: Map<string, ListFields | undefined>
): Promise<ListFieldSource> {
  for (const nodes of forests) {
    for (const collection of collectionsAsked(nodes, setting.entryCollection)) {
      if (!known.has(collection)) {
        known.set(collection, await read(collection, setting.locale));
      }
    }
  }
  return { fieldsOf: collection => known.get(collection) };
}

/** A stored form's nodes, when it has a forest to walk. */
function nodesOf(document: unknown): readonly unknown[] | undefined {
  return isPlainRecord(document) && Array.isArray(document.nodes)
    ? document.nodes
    : undefined;
}

/** One list's issue, as the engine names it, before it is addressed. */
type ListIssue = ReturnType<typeof listQueryIssues>[number];

/** What a forest's lists are judged with, besides the forest. */
export interface ListJudging {
  /**
   * The schema; absent where it cannot be read, and then lists are judged by
   * their shape alone.
   */
  readonly fieldsOf?: ListFieldsReader;
  /** The forms the forest is stored as, read only once a problem is found. */
  readonly storedForms?: () => Promise<StoredForms>;
  readonly maxNodes?: number;
}

/**
 * The errors about the lists in `nodes` that `counts` keeps, judged in
 * `setting`. A problem a stored form already held on the same block is kept
 * rather than refused, so the stored forms are read only once a problem is
 * found.
 */
async function listErrorsIn(
  nodes: readonly unknown[],
  setting: ListSetting,
  site: ListJudging,
  counts: (issue: ListIssue) => boolean
): Promise<ListIssue[]> {
  const known = new Map<string, ListFields | undefined>();
  const fieldsOf = site.fieldsOf;
  const judge = async (stored: readonly BlockDocument[]) =>
    listQueryIssues(nodes, {
      ...(fieldsOf === undefined
        ? {}
        : {
            fields: await sourceFor(
              [
                nodes,
                ...stored.flatMap(form => {
                  const forest = nodesOf(form);
                  return forest === undefined ? [] : [forest];
                }),
              ],
              setting,
              fieldsOf,
              known
            ),
          }),
      ...(setting.entryCollection === undefined
        ? {}
        : { entryCollection: setting.entryCollection }),
      ...(stored.length === 0 ? {} : { stored }),
      ...(site.maxNodes === undefined ? {} : { maxNodes: site.maxNodes }),
    }).filter(issue => isErrorIssue(issue) && counts(issue));
  let found = await judge([]);
  if (found.length > 0 && site.storedForms !== undefined) {
    const snapshot = await site.storedForms();
    if (snapshot.readable && snapshot.forms.length > 0) {
      found = await judge(snapshot.forms);
    }
  }
  return found;
}

/**
 * The issues a write is refused with for the fields its lists name; empty
 * when it names only fields the public may read, or when nothing can tell a
 * new problem from one the page already held.
 *
 * Fields are read only for the collections the value's lists name, and the
 * stored forms only once a problem is found, so a page with no list, or with
 * lists of public fields, reads nothing more than their schema.
 */
export async function newListQueryIssues(
  value: unknown,
  args: PluginFieldValidateArgs,
  label: string,
  site: ListJudging
): Promise<PluginFieldIssue[]> {
  const nodes = nodesOf(value);
  if (nodes === undefined || args.write === undefined) return [];
  // Only what the schema or the host decides: the engine's own validation
  // already reported the shape of each of the page's own lists on this write.
  const found = await listErrorsIn(
    nodes,
    listSettingOf(args.write),
    site,
    issue => LIST_FIELD_CODES.has(issue.code)
  );
  return found.map(issue => ({
    path: args.path,
    code: issue.code,
    message: `${label}${issue.path}: ${issue.message}`,
  }));
}

/** One composed list's issue, with the placement that put the list there. */
export interface ComposedListIssue {
  readonly code: string;
  readonly message: string;
  /** The host's placement the list was composed through. */
  readonly placement: string;
  /** The component that placement places, when the host names one. */
  readonly component?: string;
}

/**
 * The issues of the lists a page's placed components hold, as the page
 * composes them: a placement's values and its variant can change a list's
 * source, filters, sort or bounds, and only the composition holds the list as
 * the canvas and the published page read it. So every issue the engine finds
 * in such a list counts, its shape included, which the engine's validation of
 * the stored page never sees. The page's own lists are {@link
 * newListQueryIssues}'s, so only a list a component's definition put here is
 * judged, named by the component the page places it through. A problem the
 * stored page already composed to is kept, as for the page's own lists.
 *
 * `setting` is the write's ({@link listSettingOf}), or that of a page judged
 * on its behalf, as a component save judges the pages placing it.
 */
export async function composedListQueryIssues(
  composed: unknown,
  host: BlockDocument,
  setting: ListSetting,
  site: ListJudging
): Promise<ComposedListIssue[]> {
  const nodes = nodesOf(composed);
  if (nodes === undefined) return [];
  // Each composed list a definition put here, by the host's own placement.
  const placedLists = new Map<string, string>();
  walkNodes(
    nodes as BlockNode[],
    node => {
      const through = (node as ResolvedBlockNode).instanceOf;
      if (node.type === COLLECTION_LIST_TYPE && typeof through === "string") {
        placedLists.set(node.id, through);
      }
    },
    site.maxNodes === undefined ? {} : { maxNodes: site.maxNodes }
  );
  if (placedLists.size === 0) return [];
  const found = await listErrorsIn(nodes, setting, site, issue =>
    placedLists.has(issue.nodeId)
  );
  if (found.length === 0) return [];
  const componentOf = new Map<string, string>();
  for (const placement of componentPlacementsIn(host, site.maxNodes)
    .placements) {
    const id = isPlainRecord(placement.node) ? placement.node.id : undefined;
    if (typeof id === "string") componentOf.set(id, placement.target);
  }
  return found.map(issue => {
    const placement = placedLists.get(issue.nodeId) ?? "";
    const component = componentOf.get(placement);
    return {
      code: issue.code,
      message: `${component === undefined ? "A component" : `Component "${component}"`}, as this page places it, holds a collection list it cannot show. ${issue.message}`,
      placement,
      ...(component === undefined ? {} : { component }),
    };
  });
}
