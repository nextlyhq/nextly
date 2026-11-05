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
  isErrorIssue,
  isPlainRecord,
  LIST_FIELD_CODES,
  listQueryIssues,
  type BindingFieldShape,
  type BlockDocument,
  type ListFields,
  type ListFieldSource,
} from "@nextlyhq/blocks-engine";
import {
  addressableFields,
  type PluginFieldIssue,
  type PluginFieldValidateArgs,
} from "@nextlyhq/plugin-sdk";

import { pluralLabelOf } from "../collection-labels";

import type { StoredForms } from "./added-undefined-ids";

/** The fields of one collection, read when asked. */
export type ListFieldsReader = (
  collection: string
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
    collection: string
  ) => Promise<readonly BindingFieldShape[] | undefined>;
}): ListFieldsReader {
  return async collection => {
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
    const shapes = await reads.readable(collection);
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

/** The collections a judgement over `nodes` asks about, and nothing read. */
function collectionsAsked(
  nodes: readonly unknown[],
  entryCollection: string | undefined
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
  entryCollection: string | undefined,
  read: ListFieldsReader,
  known: Map<string, ListFields | undefined>
): Promise<ListFieldSource> {
  for (const nodes of forests) {
    for (const collection of collectionsAsked(nodes, entryCollection)) {
      if (!known.has(collection)) known.set(collection, await read(collection));
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
  site: {
    readonly fieldsOf: ListFieldsReader;
    /** The page's stored forms, shared by every check of one write. */
    readonly storedForms?: () => Promise<StoredForms>;
    readonly maxNodes?: number;
  }
): Promise<PluginFieldIssue[]> {
  const nodes = nodesOf(value);
  if (nodes === undefined) return [];
  // A list related to the page's entry looks its relation up in the
  // collection the page is an entry of.
  const entryCollection =
    args.write?.kind === "collection" ? args.write.slug : undefined;
  const known = new Map<string, ListFields | undefined>();
  const judge = async (stored: readonly BlockDocument[]) =>
    listQueryIssues(nodes, {
      fields: await sourceFor(
        [
          nodes,
          ...stored.flatMap(form => {
            const forest = nodesOf(form);
            return forest === undefined ? [] : [forest];
          }),
        ],
        entryCollection,
        site.fieldsOf,
        known
      ),
      ...(entryCollection === undefined ? {} : { entryCollection }),
      ...(stored.length === 0 ? {} : { stored }),
      ...(site.maxNodes === undefined ? {} : { maxNodes: site.maxNodes }),
      // Only what the schema decides: the engine's own validation already
      // reported the shape of each list on this write.
    }).filter(issue => LIST_FIELD_CODES.has(issue.code) && isErrorIssue(issue));
  let found = await judge([]);
  if (found.length > 0 && site.storedForms !== undefined) {
    const snapshot = await site.storedForms();
    if (snapshot.readable && snapshot.forms.length > 0) {
      found = await judge(snapshot.forms);
    }
  }
  return found.map(issue => ({
    path: args.path,
    code: issue.code,
    message: `${label}${issue.path}: ${issue.message}`,
  }));
}
