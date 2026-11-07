/**
 * A blocks field's write, judged for the fields its collection lists name,
 * and the fields its blocks' visibility conditions check.
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
  CONDITION_FIELD_CODES,
  conditionIssues,
  isErrorIssue,
  isPlainRecord,
  LIST_FIELD_CODES,
  listQueryIssues,
  walkNodes,
  type BindingFieldShape,
  type BlockDocument,
  type BlockNode,
  type IssueCode,
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
 *
 * A component is no page, though it is stored as an entry of the component
 * store: it is drawn on the pages placing it, whose entries its lists relate
 * to and its visibility conditions read, and each such page is judged as its
 * own entry (`composedListQueryIssues`, `composedConditionIssues`). So the
 * entry is left unknown: such a list is judged by its shape, and such a
 * condition by its operator, as a component placing the one being saved is.
 * A list's item inside the definition is still known, and still judged.
 */
export function listSettingOf(
  write: PluginFieldWrite,
  document: unknown
): ListSetting {
  const locale = write.locale === undefined ? {} : { locale: write.locale };
  if (isPlainRecord(document) && document.kind === "component") return locale;
  return {
    ...locale,
    entryCollection: write.kind === "collection" ? write.slug : null,
  };
}

/**
 * The collections a judgement over `nodes` asks about, and nothing read.
 * Walked as far as the judgement walks (`maxNodes`), so a forest past the
 * bound reads no schema for lists the judgement never reaches.
 */
function collectionsAsked(
  nodes: readonly unknown[],
  entryCollection: string | null | undefined,
  maxNodes: number | undefined
): Set<string> {
  const asked = new Set<string>();
  const judgement = {
    fields: {
      fieldsOf: (collection: string) => {
        asked.add(collection);
        return undefined;
      },
    },
    ...(entryCollection === undefined ? {} : { entryCollection }),
    ...(maxNodes === undefined ? {} : { maxNodes }),
  };
  // Both judgements read the schema through one source, so the fields read
  // are those any list or any condition on the page names.
  listQueryIssues(nodes, judgement);
  conditionIssues(nodes, judgement);
  return asked;
}

/** Each asked collection's fields, read once, as the engine's sync source. */
async function sourceFor(
  forests: readonly (readonly unknown[])[],
  setting: ListSetting,
  read: ListFieldsReader,
  known: Map<string, ListFields | undefined>,
  maxNodes: number | undefined
): Promise<ListFieldSource> {
  for (const nodes of forests) {
    const asked = collectionsAsked(nodes, setting.entryCollection, maxNodes);
    for (const collection of asked) {
      if (!known.has(collection)) {
        known.set(collection, await read(collection, setting.locale));
      }
    }
  }
  return { fieldsOf: collection => known.get(collection) };
}

/** A stored form's nodes, when it has a forest to walk. */
export function nodesOf(document: unknown): readonly unknown[] | undefined {
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
  /**
   * The forms the forest is stored as, read only once a problem is found.
   * Unreadable, they may already hold every problem found, so none is
   * refused: a write is never blamed for a problem nothing shows it made.
   */
  readonly storedForms?: () => Promise<StoredForms>;
  readonly maxNodes?: number;
  /**
   * Told how many problems were kept unjudged because the stored forms could
   * not be read, for a caller whose server log says so.
   */
  readonly onUnjudged?: (kept: number) => void;
}

/** One finding of a forest judgement, as the engine names it. */
interface ForestIssue {
  readonly path: string;
  readonly nodeId: string;
  readonly code: IssueCode;
  readonly message: string;
  readonly severity: "error" | "warning";
}

/** What a forest is judged with: the schema, the page's entry, stored forms. */
interface ForestJudgement {
  readonly fields?: ListFieldSource;
  readonly entryCollection?: string | null;
  readonly stored?: readonly BlockDocument[];
  readonly maxNodes?: number;
}

/**
 * The errors about `nodes` that `counts` keeps, as `judge` finds them in
 * `setting`: the lists' judgement or the conditions'. A problem a stored form
 * already held on the same block is kept rather than refused, so the stored
 * forms are read only once a problem is found; where they cannot be read,
 * every problem is kept, as the other checks against the stored page keep
 * theirs.
 */
async function errorsIn<Issue extends ForestIssue>(
  nodes: readonly unknown[],
  setting: ListSetting,
  site: ListJudging,
  judgeForest: (
    forest: readonly unknown[],
    judgement: ForestJudgement
  ) => readonly Issue[],
  counts: (issue: Issue) => boolean
): Promise<Issue[]> {
  const known = new Map<string, ListFields | undefined>();
  const fieldsOf = site.fieldsOf;
  const judge = async (stored: readonly BlockDocument[]) =>
    judgeForest(nodes, {
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
              known,
              site.maxNodes
            ),
          }),
      ...(setting.entryCollection === undefined
        ? {}
        : { entryCollection: setting.entryCollection }),
      ...(stored.length === 0 ? {} : { stored }),
      ...(site.maxNodes === undefined ? {} : { maxNodes: site.maxNodes }),
    }).filter(issue => isErrorIssue(issue) && counts(issue));
  const found = await judge([]);
  if (found.length === 0 || site.storedForms === undefined) return found;
  const snapshot = await site.storedForms();
  // A stored page this cannot read (a language whose store is not ready), or
  // one composed only in part, may already hold every problem found, so none
  // is refused: nothing can tell a new one from one the page held. A caller
  // whose server log says so is told how many were kept.
  if (!snapshot.readable) {
    site.onUnjudged?.(found.length);
    return [];
  }
  // Nothing stored (a create) holds no problem, so every one is the write's.
  return snapshot.forms.length > 0 ? judge(snapshot.forms) : found;
}

/** The errors about the lists in `nodes` that `counts` keeps. */
function listErrorsIn(
  nodes: readonly unknown[],
  setting: ListSetting,
  site: ListJudging,
  counts: (issue: ListIssue) => boolean
): Promise<ListIssue[]> {
  return errorsIn(nodes, setting, site, listQueryIssues, counts);
}

/** A write's errors as the field reports them, each naming where it is. */
export function asFieldIssues(
  found: readonly ForestIssue[],
  args: PluginFieldValidateArgs,
  label: string
): PluginFieldIssue[] {
  return found.map(issue => ({
    path: args.path,
    code: issue.code,
    message: `${label}${issue.path}: ${issue.message}`,
  }));
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
    listSettingOf(args.write, value),
    site,
    issue => LIST_FIELD_CODES.has(issue.code)
  );
  return asFieldIssues(found, args, label);
}

/**
 * The issues a write is refused with for the fields its blocks' visibility
 * conditions check, judged as its lists are: a field the entry or the list
 * item does not have, one visitors can't see, an operator or value the
 * field's kind does not take, and a condition on the entry of a page that
 * has none. Each would hide its block on the published page, so the save
 * says so instead. A problem the page already held is kept, as for lists.
 */
export async function newConditionIssues(
  value: unknown,
  args: PluginFieldValidateArgs,
  label: string,
  site: ListJudging
): Promise<PluginFieldIssue[]> {
  const nodes = nodesOf(value);
  if (nodes === undefined || args.write === undefined) return [];
  // The operators were judged by the engine's own validation of this write;
  // only what the schema or the host decides is left.
  const found = await errorsIn(
    nodes,
    listSettingOf(args.write, value),
    site,
    conditionIssues,
    issue => CONDITION_FIELD_CODES.has(issue.code)
  );
  return asFieldIssues(found, args, label);
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
export function composedListQueryIssues(
  composed: unknown,
  host: BlockDocument,
  setting: ListSetting,
  site: ListJudging
): Promise<ComposedListIssue[]> {
  return composedIssues(composed, host, setting, site, {
    judge: listQueryIssues,
    // A placed list's every issue counts, its shape included.
    placed: node => node.type === COLLECTION_LIST_TYPE,
    counts: () => true,
    holds: "a collection list it cannot show",
  });
}

/**
 * The issues of the visibility conditions a page's placed components hold,
 * as the page composes them. A definition's condition reads the entry of the
 * page it is placed on, or the item of a list it lands in, which only the
 * composition knows; so a condition the definition's own save judged by its
 * operator alone is judged here against the fields it will read. Every issue
 * counts, as for a placed list. A problem the stored page already composed
 * to is kept, as for the page's own conditions.
 */
export function composedConditionIssues(
  composed: unknown,
  host: BlockDocument,
  setting: ListSetting,
  site: ListJudging
): Promise<ComposedListIssue[]> {
  return composedIssues(composed, host, setting, site, {
    judge: conditionIssues,
    placed: () => true,
    // Every issue counts, the operator's included: a definition stored before
    // operators were judged keeps its problem as a warning on its own save,
    // and a page newly placing it would serve a block that never shows.
    counts: () => true,
    holds: "a block whose visibility conditions can't be checked there",
  });
}

/** What one composed judgement reads, and how its findings are said. */
interface ComposedJudge<Issue extends ForestIssue> {
  readonly judge: (
    forest: readonly unknown[],
    judgement: ForestJudgement
  ) => readonly Issue[];
  /** Which nodes a definition put here are this judgement's. */
  readonly placed: (node: BlockNode) => boolean;
  readonly counts: (issue: Issue) => boolean;
  /** What the component holds, for the finding's words. */
  readonly holds: string;
}

/**
 * The issues `judge` finds in the nodes a page's placed components put on it,
 * as the page composes them, each named by the component the page places it
 * through. The page's own nodes are judged by its own checks.
 */
async function composedIssues<Issue extends ForestIssue>(
  composed: unknown,
  host: BlockDocument,
  setting: ListSetting,
  site: ListJudging,
  by: ComposedJudge<Issue>
): Promise<ComposedListIssue[]> {
  const nodes = nodesOf(composed);
  if (nodes === undefined) return [];
  // Each composed node a definition put here, by the host's own placement.
  const placedNodes = new Map<string, string>();
  walkNodes(
    nodes as BlockNode[],
    node => {
      const through = (node as ResolvedBlockNode).instanceOf;
      if (typeof through === "string" && by.placed(node)) {
        placedNodes.set(node.id, through);
      }
    },
    site.maxNodes === undefined ? {} : { maxNodes: site.maxNodes }
  );
  if (placedNodes.size === 0) return [];
  const found = await errorsIn(
    nodes,
    setting,
    site,
    by.judge,
    issue => placedNodes.has(issue.nodeId) && by.counts(issue)
  );
  if (found.length === 0) return [];
  const componentOf = new Map<string, string>();
  for (const placement of componentPlacementsIn(host, site.maxNodes)
    .placements) {
    const id = isPlainRecord(placement.node) ? placement.node.id : undefined;
    if (typeof id === "string") componentOf.set(id, placement.target);
  }
  return found.map(issue => {
    const placement = placedNodes.get(issue.nodeId) ?? "";
    const component = componentOf.get(placement);
    return {
      code: issue.code,
      message: `${component === undefined ? "A component" : `Component "${component}"`}, as this page places it, holds ${by.holds}. ${issue.message}`,
      placement,
      ...(component === undefined ? {} : { component }),
    };
  });
}
