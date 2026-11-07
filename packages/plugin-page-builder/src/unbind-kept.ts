/**
 * What an unbind keeps in a prop's place, decided on the server, for the
 * inspector and the page actions API alike: one decision, so an author and
 * an API client are kept to the same value and told the same reason.
 *
 * The value kept is what a visitor sees now, read as the published page reads
 * it: published entries and the fields the public may read, through the
 * page's own binding pipeline. A value a visitor can't see is never copied
 * in: the binding's fallback is kept, or the prop's own value, and the answer
 * says why. An image a visitor saw by its address goes to the block's
 * declared address prop, since the media prop holds a library id only; a
 * block declaring none refuses the unbind rather than drop what visitors see.
 *
 * @module unbind-kept
 */
import {
  addressPropOf,
  COLLECTION_LIST_TYPE,
  DEFAULT_BINDING_SOURCE,
  DOCUMENT_FORMAT_VERSION,
  findNode,
  isPlainRecord,
  LIST_ENTRY_SLOT,
  readListQuery,
  resolveNodeBindings,
  visitorUnreadableBindings,
  walkNodes,
  type BindingRun,
  type BindingScope,
  type BlockDocument,
  type BlockNode,
  type BoundValue,
  type PropSchema,
} from "@nextlyhq/blocks-engine";
import type { KeptProps, UnbindKeep } from "@nextlyhq/builder/ops";
import { getCachedNextly } from "@nextlyhq/plugin-sdk";

import type { UnbindAnswer } from "./composition-actions-contract";

/** What a visitor sees of one bound prop, as the published page fills it. */
export interface VisitorView {
  /** The block's props as the visitor's pass fills them. */
  readonly filled: Readonly<Record<string, unknown>>;
  /** How the prop was filled; absent when the pass left it as stored. */
  readonly bound: BoundValue | undefined;
  /** Set when the binding reads a field the public may not read. */
  readonly unreadable?: { readonly fallback?: { readonly value: unknown } };
}

/** The unbind's plan: the props kept, and the answer, or why it is refused. */
export type UnbindPlan =
  | { readonly kept: KeptProps; readonly answer: UnbindAnswer }
  | { readonly refusal: string };

/** The block's props as its definition declares them, for the address pairing. */
type DeclaredProps = Readonly<Partial<Record<string, PropSchema>>> | undefined;

/**
 * The plan for unbinding `prop`, from what a visitor sees of it. Pure: the
 * reading is {@link visitorViewOf}'s.
 */
export function unbindPlan(
  prop: string,
  path: string,
  view: VisitorView,
  declared: DeclaredProps
): UnbindPlan {
  if (view.unreadable !== undefined) {
    const fallback = view.unreadable.fallback;
    return fallback === undefined
      ? {
          kept: { set: {} },
          answer: {
            kept: "own",
            reason: `Visitors can't read “${path}”, so its value wasn't copied in. The block keeps its own value.`,
          },
        }
      : {
          kept: { set: { [prop]: fallback.value } },
          answer: {
            kept: "fallback",
            value: fallback.value,
            reason: `Visitors can't read “${path}”, so its value wasn't copied in. The fallback is kept.`,
          },
        };
  }
  const bound = view.bound;
  const value = view.filled[prop];
  if (bound === undefined) {
    return {
      kept: { set: {} },
      answer: {
        kept: "own",
        reason:
          "The binding fills nothing for visitors now, so the block keeps its own value.",
      },
    };
  }
  if (bound.kind === "image") return imagePlan(prop, value, bound, declared);
  const kept = bound.kind === "fallback" ? "fallback" : "visitor";
  return {
    kept: { set: { [prop]: value } },
    answer: {
      kept,
      value,
      reason:
        kept === "fallback"
          ? "Visitors see the fallback here, so it's kept."
          : "The prop keeps what visitors saw.",
    },
  };
}

/** An image's plan: a library id stays; an address goes to the address prop. */
function imagePlan(
  prop: string,
  value: unknown,
  bound: Extract<BoundValue, { kind: "image" }>,
  declared: DeclaredProps
): UnbindPlan {
  const kept = bound.from === "fallback" ? "fallback" : "visitor";
  if (bound.from === "own") {
    return {
      kept: { set: {} },
      answer: {
        kept: "own",
        reason:
          "Visitors see the block's own image here, so the block keeps it.",
      },
    };
  }
  if (bound.holds === "media") {
    return {
      kept: { set: { [prop]: value } },
      answer: { kept, value, reason: "The image keeps what visitors saw." },
    };
  }
  const into = addressPropOf(declared, prop);
  if (into === undefined) {
    return {
      refusal: `Visitors see this image by its address, which “${prop}” can't hold, and the block has no address prop to keep it in.`,
    };
  }
  return {
    kept: { set: { [into]: value }, empty: [prop] },
    answer: {
      kept,
      value,
      into,
      reason:
        "Visitors saw an image address, not a library image, so it's kept in the image's address.",
    },
  };
}

/** Where an unbind reads what a visitor sees. */
export interface UnbindSource {
  /** The document the page stores the block in, its id and its language. */
  readonly collection: string;
  readonly id: string;
  readonly locale?: string;
  /** The collection a template draws its entries from, for a template. */
  readonly templateTarget?: string;
}

/** Why the visitor's value can't be read here, and what to give instead. */
export interface UnbindNeeds {
  readonly needs: string;
}

/** The keep a visitor's value is read for: all but a value given. */
type ReadKeep = Exclude<UnbindKeep, { value: unknown }>;

/** The list a node is drawn in, as its entries slot holds it; none for a page's own. */
function listOf(
  document: BlockDocument,
  nodeId: string
): BlockNode | undefined {
  let found: BlockNode | undefined;
  walkNodes(document.nodes, node => {
    if (found !== undefined || node.type !== COLLECTION_LIST_TYPE) return;
    const entries = node.slots?.[LIST_ENTRY_SLOT] ?? [];
    let inside = false;
    walkNodes(entries, child => {
      if (child.id === nodeId) inside = true;
    });
    if (inside) found = node;
  });
  return found;
}

/** The public reader, as the published page reads with it. */
async function publicReader(locale: string | undefined) {
  const [runtime, nextly] = await Promise.all([
    import("nextly/runtime"),
    getCachedNextly(),
  ]);
  return runtime.createPublicReader(
    {
      find: args => nextly.find(args),
      findSingle: args => nextly.findSingle(args),
    },
    locale === undefined ? {} : { locale }
  );
}

/** Where the node's bindings read: its entry, and its list item when it has one. */
function readsOf(
  source: UnbindSource,
  document: BlockDocument,
  node: BlockNode,
  prop: string,
  keep: ReadKeep
):
  | {
      readonly entry: { readonly collection: string; readonly id?: string };
      readonly item?: { readonly collection: string; readonly id: string };
    }
  | UnbindNeeds {
  const kind = node.bindings?.[prop]?.source ?? DEFAULT_BINDING_SOURCE;
  const entry = entryOf(source, keep, kind);
  if ("needs" in entry) return entry;
  if (kind !== "item") return { entry };
  const item = itemOf(document, node.id, keep);
  return "needs" in item ? item : { entry, item };
}

/** Whether `prop`'s binding reads a field the public may not, and its fallback. */
function unreadableOf(
  alone: BlockDocument,
  run: BindingRun,
  nodeId: string,
  prop: string
): VisitorView["unreadable"] {
  // Judged against the public's shapes, as the inspector marks it; nothing
  // judged where the shapes are not known.
  if (run.schema === undefined) return undefined;
  const marked = visitorUnreadableBindings(alone, {
    schema: run.schema,
    ...(run.entryRef === undefined ? {} : { entryRef: run.entryRef }),
    props: run.props,
  })
    .get(nodeId)
    ?.find(binding => binding.prop === prop);
  if (marked === undefined) return undefined;
  return marked.fallback === undefined ? {} : { fallback: marked.fallback };
}

/**
 * What a visitor sees of `prop` on block `nodeId`, read as the published page
 * reads it: through its own binding pipeline, with the public reader. `keep`
 * names the entry, or the list item, a value varies by; a page's own entry is
 * the page itself, and a template's has to be named.
 */
export async function visitorViewOf(
  source: UnbindSource,
  document: BlockDocument,
  nodeId: string,
  prop: string,
  keep: ReadKeep
): Promise<VisitorView | UnbindNeeds> {
  const node = findNode(document.nodes, nodeId);
  if (node === undefined) return { needs: `There is no block “${nodeId}”.` };
  const reads = readsOf(source, document, node, prop, keep);
  if ("needs" in reads) return reads;
  const [next, react, reader] = await Promise.all([
    import("@nextlyhq/blocks-react/next"),
    import("@nextlyhq/blocks-react"),
    publicReader(source.locale),
  ]);
  const alone: BlockDocument = {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [node],
  };
  const bindings = await next.readBindingSources({
    documents: [alone],
    entrySource: "collection",
    slug: reads.entry.collection,
    ...(reads.entry.id === undefined ? {} : { entryId: reads.entry.id }),
    page: source.collection,
    ...(source.locale === undefined ? {} : { locale: source.locale }),
    ...(reads.item === undefined ? {} : { lists: [reads.item.collection] }),
    reader,
    budget: react.createQueryBudget(),
  });
  // Nothing to read for a visitor: the binding fills nothing on the page.
  if (bindings === undefined) return { filled: node.props, bound: undefined };
  const run = react.pageBindingRun(
    bindings,
    source.locale,
    react.registeredBlocks()
  );
  const scope = await scopeOf(reader, reads.item);
  if ("needs" in scope) return scope;
  const result = resolveNodeBindings(node, run, scope);
  const unreadable = unreadableOf(alone, run, nodeId, prop);
  return {
    filled: result.props,
    bound: result.bound?.[prop],
    ...(unreadable === undefined ? {} : { unreadable }),
  };
}

/** The pass the node is filled in: the page's, or its list item's, read as a visitor. */
async function scopeOf(
  reader: Parameters<typeof publicItem>[0],
  item: { readonly collection: string; readonly id: string } | undefined
): Promise<BindingScope | UnbindNeeds> {
  if (item === undefined) return { phase: "page" };
  const row = await publicItem(reader, item);
  return "needs" in row
    ? row
    : {
        phase: "item",
        item: row.item,
        itemRef: { collection: item.collection },
      };
}

/** The entry a page's bindings read: the page's own, a named one, or none needed. */
function entryOf(
  source: UnbindSource,
  keep: ReadKeep,
  kind: string
): { readonly collection: string; readonly id?: string } | UnbindNeeds {
  const named =
    typeof keep === "object" && "entry" in keep ? keep.entry : undefined;
  if (source.templateTarget !== undefined) {
    // A template's entries differ: whose value to keep has to be named.
    if (named === undefined && kind === "entry") {
      return {
        needs:
          "A template's entries each show their own value: name the entry whose value to keep, or give the value.",
      };
    }
    return {
      collection: source.templateTarget,
      ...(named === undefined ? {} : { id: named }),
    };
  }
  return { collection: source.collection, id: named ?? source.id };
}

/** The list item a list child's value is read from: named, of a collection list. */
function itemOf(
  document: BlockDocument,
  nodeId: string,
  keep: ReadKeep
): { readonly collection: string; readonly id: string } | UnbindNeeds {
  const named =
    typeof keep === "object" && "item" in keep ? keep.item : undefined;
  if (named === undefined) {
    return {
      needs:
        "Each item of the list shows its own value: name the item whose value to keep, or give the value.",
    };
  }
  const list = listOf(document, nodeId);
  const collection =
    list === undefined ? undefined : readListQuery(list.props).query.collection;
  if (collection === undefined) {
    return {
      needs: "This list's items can't be read by id: give the value to keep.",
    };
  }
  return { collection, id: named };
}

/** One published item, with the fields the public may read. */
async function publicItem(
  reader: {
    find(query: {
      collection: string;
      filters: readonly { field: string; op: "equals"; value: string }[];
      limit: number;
    }): Promise<{ items: readonly unknown[] }>;
  },
  item: { readonly collection: string; readonly id: string }
): Promise<{ readonly item: Readonly<Record<string, unknown>> } | UnbindNeeds> {
  const found = await reader.find({
    collection: item.collection,
    filters: [{ field: "id", op: "equals", value: item.id }],
    limit: 1,
  });
  const row = found.items[0];
  return isPlainRecord(row)
    ? { item: row }
    : {
        needs: `No published item “${item.id}” is there for a visitor to see: give the value to keep.`,
      };
}
