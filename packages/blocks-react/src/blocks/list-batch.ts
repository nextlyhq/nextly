/**
 * What a collection list reads ahead for the entries it draws, so its cost
 * does not grow with its length.
 *
 * A list draws its template once per entry, and the blocks in it read as
 * they are drawn: an image its media record, a link its entry's path, a
 * binding through a relation its related entry. Drawn one by one, a list of
 * fifty posts with a link to each makes some two hundred reads. Read ahead,
 * it makes a handful: each relation its items' bindings follow in one read,
 * its links in one batch, whatever the list's length. The per-entry reads
 * then find their answers already read.
 *
 * The template is read for what it will ask, never guessed: an item binding
 * to `author.name` follows `author`; a link to an entry, by an item field or
 * as set, reads that entry's path. Anything else a block reads is read as it
 * is drawn, as before, and still counted: an image costs one read per
 * distinct media id per render, so a template image is read once.
 *
 * @module blocks/list-batch
 */
import {
  COLLECTION_LIST_TYPE,
  DEFAULT_BINDING_SOURCE,
  LIST_ENTRY_SLOT,
  isBindPath,
  isPlainRecord,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import type { PageContext } from "../context";
import { conditionAllows } from "../visibility";

/** Where a prop's value comes from: as set, or a list item's field path. */
type ValueSource =
  | { readonly value: string }
  | { readonly path: readonly string[] };

/** What a list's template asks of each entry it draws. */
export interface ItemReadDemand {
  /** Each to-one relation an item binding follows, with the fields read there. */
  readonly follows: ReadonlyMap<string, ReadonlySet<string>>;
  /** Where each link's entry comes from. */
  readonly links: readonly {
    readonly collection: ValueSource;
    readonly id: ValueSource;
  }[];
}

/** The props a linking block names its entry by (`LINK_PROPS`). */
const LINK_COLLECTION_PROP = "entryCollection";
const LINK_ID_PROP = "entryId";

/** A binding's path, when it is a well-formed one to the list item. */
function itemPath(binding: unknown): readonly string[] | undefined {
  if (!isPlainRecord(binding)) return undefined;
  const source = Object.hasOwn(binding, "source")
    ? binding.source
    : DEFAULT_BINDING_SOURCE;
  const path = Object.hasOwn(binding, "$bind") ? binding.$bind : undefined;
  if (source !== "item" || !isBindPath(path)) return undefined;
  const segments = path.split(".");
  // One hop at most, as every binding path; a deeper one falls back where it
  // is resolved, so nothing is read for it.
  return segments.length <= 2 && !segments.includes("__proto__")
    ? segments
    : undefined;
}

/** Where a node's prop comes from, when it comes from anywhere. */
function valueSource(node: BlockNode, prop: string): ValueSource | undefined {
  const bindings = isPlainRecord(node.bindings) ? node.bindings : undefined;
  const bound =
    bindings !== undefined && Object.hasOwn(bindings, prop)
      ? bindings[prop]
      : undefined;
  const path = itemPath(bound);
  if (path !== undefined) return { path };
  // A binding to the page's own sources was filled before the page drew, so
  // the prop holds what it reads.
  const value: unknown = isPlainRecord(node.props)
    ? node.props[prop]
    : undefined;
  return typeof value === "string" && value.trim() !== ""
    ? { value: value.trim() }
    : undefined;
}

/**
 * What a list's template asks of one entry: walked through every slot, but
 * not into a list inside it, whose entries are its own, nor into a block
 * `drawn` says the entry does not draw.
 */
export function itemReadDemand(
  template: readonly BlockNode[],
  drawn: (node: BlockNode) => boolean = () => true
): ItemReadDemand {
  const follows = new Map<string, Set<string>>();
  const links: { collection: ValueSource; id: ValueSource }[] = [];
  const stack: BlockNode[] = [...template];
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    // A list inside the template draws entries of its own, and a block the
    // entry's conditions leave out draws nothing to read for.
    if (
      !isPlainRecord(node) ||
      node.type === COLLECTION_LIST_TYPE ||
      !drawn(node)
    ) {
      continue;
    }
    addFollows(node, follows);
    const link = linkOf(node);
    if (link !== undefined) links.push(link);
    stack.push(...childrenOf(node));
  }
  return { follows, links };
}

/** Each relation a node's item bindings follow, with the field read there. */
function addFollows(node: BlockNode, follows: Map<string, Set<string>>): void {
  if (!isPlainRecord(node.bindings)) return;
  for (const binding of Object.values(node.bindings)) {
    const [field, inner] = itemPath(binding) ?? [];
    if (field === undefined || inner === undefined) continue;
    follows.set(field, (follows.get(field) ?? new Set()).add(inner));
  }
}

/** Where a node's link to an entry comes from, when it links to one. */
function linkOf(
  node: BlockNode
): { collection: ValueSource; id: ValueSource } | undefined {
  const collection = valueSource(node, LINK_COLLECTION_PROP);
  const id = valueSource(node, LINK_ID_PROP);
  return collection === undefined || id === undefined
    ? undefined
    : { collection, id };
}

/** A node's children, in every slot it stores. */
function childrenOf(node: BlockNode): BlockNode[] {
  return Object.values(node.slots ?? {}).flatMap(children =>
    Array.isArray(children) ? children : []
  );
}

/** A value as a source gives it for one item: text, or nothing. */
function valueFor(
  source: ValueSource,
  item: Readonly<Record<string, unknown>>
): string | undefined {
  if ("value" in source) return source.value;
  let value: unknown = item;
  for (const segment of source.path) {
    value =
      isPlainRecord(value) && Object.hasOwn(value, segment)
        ? value[segment]
        : undefined;
  }
  if (typeof value === "number") return String(value);
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * A list's read with what its template asks read ahead (see
 * {@link readListAhead}): the same outcome when nothing was read, or the
 * entries with their relations read in place of their ids.
 */
export async function withReadAhead<
  O extends { readonly items: readonly Record<string, unknown>[] },
>(
  outcome: O,
  list: BlockNode,
  ctx: PageContext,
  entries: {
    readonly collection: string | undefined;
    readonly contextOf: (item: Record<string, unknown>) => PageContext;
  }
): Promise<O> {
  const items = await readListAhead(
    outcome.items,
    list.slots?.[LIST_ENTRY_SLOT] ?? [],
    ctx,
    { nodeId: list.id, ...entries }
  );
  return items === outcome.items ? outcome : { ...outcome, items };
}

/**
 * The list's entries with what their template asks read ahead: each relation
 * the items' bindings follow read in place of its id, and the links the
 * template draws settled for the per-entry reads to answer from.
 *
 * Each entry asks only for what it draws: its template walked with the
 * render's own gate (`conditionAllows`, against the context the entry is
 * drawn with, `contextOf`), so a block an entry's conditions leave out spends
 * nothing. The route's set of blocks its entry's conditions kept is not
 * handed to a list, so a block inside one that an entry condition kept is
 * judged against the item here; if that leaves it out, it reads as it is
 * drawn, one entry at a time, still counted, and draws the same.
 *
 * Every read is claimed for the list (`nodeId`), so a page past its
 * allowance names the list as the block that went unread. A host without
 * batch reads gets the entries back as they were.
 */
export async function readListAhead(
  items: readonly Record<string, unknown>[],
  template: readonly BlockNode[],
  ctx: PageContext,
  list: {
    readonly nodeId: string;
    readonly collection: string | undefined;
    readonly contextOf: (item: Record<string, unknown>) => PageContext;
  }
): Promise<readonly Record<string, unknown>[]> {
  const reads = ctx.listReads;
  if (reads === undefined || items.length === 0) return items;
  const demands = items.map(item =>
    itemReadDemand(template, node =>
      conditionAllows(node, list.contextOf(item))
    )
  );
  const claim = { nodeId: list.nodeId };
  const drawn =
    list.collection === undefined
      ? items
      : await withRelations(items, demands, {
          reads,
          collection: list.collection,
          claim,
        });
  const refs = linkRefs(drawn, demands);
  if (refs.length > 0) await reads.entryPaths(refs, claim);
  return drawn;
}

/** An item's stored relation id, when it holds one. */
function storedId(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : undefined;
}

/**
 * Each relation the entries follow, with every field read there and the
 * entries that follow it, by their place in the list.
 */
function followsOf(
  demands: readonly ItemReadDemand[]
): Map<string, { fields: Set<string>; entries: number[] }> {
  const follows = new Map<string, { fields: Set<string>; entries: number[] }>();
  demands.forEach((demand, index) => {
    for (const [field, inner] of demand.follows) {
      const wanted = follows.get(field) ?? { fields: new Set(), entries: [] };
      for (const name of inner) wanted.fields.add(name);
      wanted.entries.push(index);
      follows.set(field, wanted);
    }
  });
  return follows;
}

/**
 * The items with each followed relation read, one read per relation for all
 * the entries that follow it, in place of the id each stores. An item whose
 * related entry was not read keeps its id, and its binding shows its
 * fallback.
 */
async function withRelations(
  items: readonly Record<string, unknown>[],
  demands: readonly ItemReadDemand[],
  how: {
    readonly reads: NonNullable<PageContext["listReads"]>;
    readonly collection: string;
    readonly claim: { readonly nodeId: string };
  }
): Promise<readonly Record<string, unknown>[]> {
  let drawn = items;
  for (const [field, { fields, entries }] of followsOf(demands)) {
    const ids = entries.flatMap(index => storedId(drawn[index]?.[field]) ?? []);
    if (ids.length === 0) continue;
    const related = await how.reads.related(
      how.collection,
      field,
      ids,
      [...fields],
      how.claim
    );
    if (related === undefined) continue;
    const following = new Set(entries);
    drawn = drawn.map((item, index) => {
      const id = following.has(index) ? storedId(item[field]) : undefined;
      const row = id === undefined ? undefined : related.get(id);
      return row === undefined ? item : { ...item, [field]: row };
    });
  }
  return drawn;
}

/** Every entry the items' drawn links point at, each once. */
function linkRefs(
  items: readonly Record<string, unknown>[],
  demands: readonly ItemReadDemand[]
): { collection: string; id: string }[] {
  const refs = new Map<string, { collection: string; id: string }>();
  for (const [index, item] of items.entries()) {
    for (const link of demands[index]?.links ?? []) {
      const collection = valueFor(link.collection, item);
      const id = valueFor(link.id, item);
      if (collection === undefined || id === undefined) continue;
      refs.set(`${collection}\u0000${id}`, { collection, id });
    }
  }
  return [...refs.values()];
}

/**
 * The relation fields the items of the page's lists follow, from the lists'
 * templates: what a route reads the public's field shapes of, so an item
 * binding through a relation is judged as an entry binding through one is.
 */
export function itemFollowsIn(
  documents: readonly { readonly nodes: readonly BlockNode[] }[]
): Set<string> {
  const fields = new Set<string>();
  const stack: BlockNode[] = documents.flatMap(document => [...document.nodes]);
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if (!isPlainRecord(node)) continue;
    if (node.type === COLLECTION_LIST_TYPE) {
      const template = node.slots?.[LIST_ENTRY_SLOT] ?? [];
      for (const field of itemReadDemand(template).follows.keys()) {
        fields.add(field);
      }
    }
    for (const children of Object.values(node.slots ?? {})) {
      if (Array.isArray(children)) stack.push(...children);
    }
  }
  return fields;
}
