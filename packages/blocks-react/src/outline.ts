/**
 * The page outline: every heading a page draws, in page order, each with its
 * words, its level, the block drawing it and an anchor that is unique on the
 * whole page.
 *
 * ## One reading of the page
 *
 * Built once per page, from the trees the page draws: each part after the
 * read pipeline (composition, migration, gating, bindings), with the blocks
 * drawn as placeholders gone. So a bound heading is listed by its entry's
 * words, never by the template's placeholder, and a block withheld from this
 * visitor holds no anchor. `PageRenderer` sets it on the render context
 * (`ctx.outline`), `core/heading` and `core/rich-text` take their ids from
 * it, and a table of contents its entries, so a link and the heading it names
 * cannot disagree. The editor's canvas draws through the same renderer, so it
 * runs the same function on the document being edited.
 *
 * ## Page order
 *
 * The parts in the order they are handed (the Layout's header, the page,
 * then its footer), and within a part depth first: a block, then its slots'
 * children in order. On a collection template the entry's own content is
 * already composed into the page (`composeEntryContent`), so its headings
 * are listed in place.
 *
 * ## How anchors are given
 *
 * Every id an author gave any block on the page, as its CSS id or as an `id`
 * in its HTML attributes (`renderedDomId`, the id the block is drawn with),
 * is taken before the first heading. A heading carrying one is anchored by
 * it. Every other heading's anchor is made from its words by the slug rules
 * in `blocks/heading-anchors`, numbered on a repeat (`notes`, `notes-2`), and
 * never an id already taken, whether that id is drawn before the heading or
 * after it.
 *
 * ## Drawn more than once
 *
 * A Collection list draws its template once per entry. A heading in it is
 * drawn with its anchor and the entry's place (`outlineAnchors`): `title--0`,
 * `title--1`. A made anchor never holds two hyphens in a row, so no other
 * heading's words can make one of these. A Rich text there may draw the
 * entry's own passage, filled after the outline, so its anchors are made
 * from the passage drawn (`passageAnchors`).
 *
 * @experimental
 * @module outline
 */
import {
  renderedDomId,
  walkNodes,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import {
  anchorAllocator,
  rankOfTag,
  type HeadingRank,
} from "./blocks/heading-anchors";
import { text } from "./blocks/props";
import type { PageContext } from "./context";
import { headingsDrawn } from "./rich-text";

/** The part of a page a heading is drawn in. @experimental */
export type OutlineArea = "header" | "content" | "footer";

/** One part of a page, as it is drawn. @experimental */
export interface OutlinePart {
  readonly area: OutlineArea;
  /** The part's tree as the renderer draws it. */
  readonly nodes: readonly BlockNode[];
}

/** One heading the page draws. @experimental */
export interface OutlineHeading {
  /** The id it is drawn with, unique on the page. */
  readonly anchor: string;
  /** Its words, as a reader sees them. */
  readonly text: string;
  readonly level: HeadingRank;
  /** The block drawing it: a Heading, or the Rich text it sits in. */
  readonly node: BlockNode;
  readonly area: OutlineArea;
  /** Whether its author left it out of a table of contents. It keeps its anchor. */
  readonly leftOut: boolean;
  /** The types of the blocks it sits inside, outermost first. */
  readonly within: readonly string[];
}

/** Every heading a page draws, in page order. @experimental */
export interface PageOutline {
  readonly headings: readonly OutlineHeading[];
  /**
   * The anchors a block's headings are drawn with, in the order it draws
   * them: one for a Heading, one per heading for a Rich text passage, none
   * for any other block.
   */
  anchorsOf(nodeId: string): readonly string[];
}

const HEADING_BLOCK = "core/heading";
const RICH_TEXT_BLOCK = "core/rich-text";
const COLLECTION_LIST_BLOCK = "core/collection-loop";

const NONE: readonly string[] = Object.freeze([]);

/** A heading a block draws, before it is given its anchor. */
interface Found {
  readonly text: string;
  readonly level: HeadingRank;
  /** The id its author gave it, which is then its anchor. */
  readonly own: string | undefined;
  readonly leftOut: boolean;
}

/** The headings one block draws itself, in its order. */
function headingsOfBlock(node: BlockNode): readonly Found[] {
  const props = node.props ?? {};
  if (node.type === HEADING_BLOCK) {
    // Its words as `core/heading` draws them, spaces as a reader sees them.
    const words = text(props.text).replace(/\s+/g, " ").trim();
    if (words === "") return [];
    return [
      {
        text: words,
        level: rankOfTag(props.level),
        own: renderedDomId(node),
        leftOut: props.tocExclude === true,
      },
    ];
  }
  if (node.type === RICH_TEXT_BLOCK) {
    return headingsDrawn(props.content).map(heading => ({
      text: heading.text,
      level: heading.rank,
      // The block's own id is on the passage's wrapper, not on a heading.
      own: undefined,
      leftOut: false,
    }));
  }
  return [];
}

/** Every id an author gave a block in any of the parts. */
function authorIds(parts: readonly OutlinePart[]): Set<string> {
  const taken = new Set<string>();
  for (const part of parts) {
    walkNodes([...part.nodes], node => {
      const id = renderedDomId(node);
      if (id !== undefined) taken.add(id);
    });
  }
  return taken;
}

/** What an outline keeps beside its headings, for this module alone. */
interface OutlineRecord {
  /** Each part's blocks' anchors, by node id: ids are unique within a part. */
  readonly byPart: ReadonlyMap<OutlineArea, ReadonlyMap<string, string[]>>;
  /** Every id an author gave a block on the page. */
  readonly taken: ReadonlySet<string>;
  /** Every id the page's headings are drawn with: the authors' and the made. */
  readonly drawn: ReadonlySet<string>;
  /**
   * Each Rich text block inside a Collection list, by node id: its place
   * among the Rich text blocks of the nearest list holding it, from 1.
   */
  readonly passageInList: ReadonlyMap<string, number>;
}

/** The record of each outline this module made, and of each part's view. */
const RECORDS = new WeakMap<PageOutline, OutlineRecord>();

/**
 * The outline of a page drawn in these parts, in this order.
 *
 * Pure: the same parts give the same outline, which is what lets the
 * published route and the editor's canvas read one page alike. Its
 * `anchorsOf` answers for the first part holding a node id; a part's own
 * renderer reads `outlineForPart`, since node ids are unique only within
 * one document.
 *
 * @experimental
 */
export function pageOutline(parts: readonly OutlinePart[]): PageOutline {
  const taken = authorIds(parts);
  const allocator = anchorAllocator(new Set(taken));
  const headings: OutlineHeading[] = [];
  const byPart = new Map<OutlineArea, Map<string, string[]>>();
  const firstById = new Map<string, string[]>();
  const passageInList = new Map<string, number>();
  const passagesPerList = new Map<BlockNode, number>();
  for (const part of parts) {
    // The nearest Collection list holding each node, if any.
    const listOf = new Map<BlockNode, BlockNode>();
    const byNode = byPart.get(part.area) ?? new Map<string, string[]>();
    byPart.set(part.area, byNode);
    const withinOf = new Map<BlockNode, readonly string[]>();
    walkNodes([...part.nodes], (node, parent) => {
      const within =
        parent === undefined
          ? NONE
          : [...(withinOf.get(parent) ?? NONE), parent.type];
      withinOf.set(node, within);
      const list =
        parent === undefined
          ? undefined
          : parent.type === COLLECTION_LIST_BLOCK
            ? parent
            : listOf.get(parent);
      if (list !== undefined) listOf.set(node, list);
      if (
        list !== undefined &&
        node.type === RICH_TEXT_BLOCK &&
        !passageInList.has(node.id)
      ) {
        const place = (passagesPerList.get(list) ?? 0) + 1;
        passagesPerList.set(list, place);
        passageInList.set(node.id, place);
      }
      const found = headingsOfBlock(node);
      if (found.length === 0) return;
      const anchors: string[] = [];
      if (!byNode.has(node.id)) byNode.set(node.id, anchors);
      if (!firstById.has(node.id)) firstById.set(node.id, anchors);
      for (const heading of found) {
        const anchor = heading.own ?? allocator.take(heading.text);
        anchors.push(anchor);
        headings.push({
          anchor,
          text: heading.text,
          level: heading.level,
          node,
          area: part.area,
          leftOut: heading.leftOut,
          within,
        });
      }
    });
  }
  const outline: PageOutline = {
    headings,
    anchorsOf: nodeId => firstById.get(nodeId) ?? NONE,
  };
  RECORDS.set(outline, {
    byPart,
    taken,
    drawn: new Set([...taken, ...headings.map(heading => heading.anchor)]),
    passageInList,
  });
  return outline;
}

/**
 * The page's outline as one part's blocks read it: the same headings, with
 * each node id answered from that part, so a header and a page that both
 * hold a block `h1` each draw their own anchors.
 *
 * @experimental
 */
export function outlineForPart(
  outline: PageOutline,
  area: OutlineArea
): PageOutline {
  const record = RECORDS.get(outline);
  if (record === undefined) return outline;
  const byNode = record.byPart.get(area);
  const view: PageOutline = {
    headings: outline.headings,
    anchorsOf: nodeId => byNode?.get(nodeId) ?? NONE,
  };
  RECORDS.set(view, record);
  return view;
}

/**
 * The anchors a block's headings are drawn with on this render: the
 * outline's, with the entry's place after each inside a Collection list's
 * entry, where the block is drawn once per entry (`title--0`). A made anchor
 * never holds two hyphens in a row, so these never meet another heading's;
 * one an author gave a block is stepped past (`title--0--2`).
 *
 * @experimental
 */
export function outlineAnchors(
  ctx: Pick<PageContext, "outline" | "itemPosition">,
  nodeId: string
): readonly string[] {
  const outline = ctx.outline;
  const anchors = outline?.anchorsOf(nodeId) ?? NONE;
  const place = ctx.itemPosition;
  if (place === undefined || anchors.length === 0) return anchors;
  const taken = outline === undefined ? undefined : RECORDS.get(outline)?.taken;
  return anchors.map(anchor => entryId(`${anchor}--${place}`, taken));
}

/** An id inside a list's entry, stepped past any an author gave a block. */
function entryId(id: string, taken: ReadonlySet<string> | undefined): string {
  if (taken === undefined || !taken.has(id)) return id;
  let n = 2;
  while (taken.has(`${id}--${n}`)) n += 1;
  return `${id}--${n}`;
}

/**
 * The anchors a Rich text block draws its passage's headings with: the
 * outline's, with the entry's place inside a Collection list's entry
 * (`outlineAnchors`), while the passage drawn is the one the outline read.
 *
 * Inside an entry the passage can instead be the entry's own (bound to an
 * item field and filled as each entry is drawn, after the outline). Its
 * anchors are then made from the passage drawn: by the same slug rules,
 * never an id the page's headings are drawn with, with the entry's place
 * after each (`notes-2--0`), and, for the second and later Rich text block
 * of the list, the block's place among them (`notes-2--0--p2`), since each
 * passage is drawn alone and two could make the same id.
 *
 * @experimental
 */
export function passageAnchors(
  ctx: Pick<PageContext, "outline" | "itemPosition">,
  nodeId: string,
  passage: unknown
): readonly string[] {
  const place = ctx.itemPosition;
  const outline = ctx.outline;
  if (place === undefined || outline === undefined) {
    return outlineAnchors(ctx, nodeId);
  }
  const drawn = headingsDrawn(passage);
  const read = outline.headings.filter(heading => heading.node.id === nodeId);
  const asRead =
    read.length === drawn.length &&
    read.every((heading, i) => heading.text === drawn[i]?.text);
  if (asRead) return outlineAnchors(ctx, nodeId);
  const record = RECORDS.get(outline);
  const allocator = anchorAllocator(new Set(record?.drawn));
  const block = record?.passageInList.get(nodeId) ?? 1;
  const suffix = block > 1 ? `--p${block}` : "";
  return drawn.map(heading =>
    entryId(`${allocator.take(heading.text)}--${place}${suffix}`, record?.taken)
  );
}

/**
 * The anchors of every block in a subtree, in order: what a container's
 * output depends on through the headings inside it. An editor keeps an async
 * block's output by it, so a list whose inner heading is renumbered by a
 * heading outside it is drawn again.
 *
 * @experimental
 */
export function anchorsWithin(
  ctx: Pick<PageContext, "outline" | "itemPosition">,
  node: BlockNode
): readonly string[] {
  if (ctx.outline === undefined) return NONE;
  const anchors: string[] = [];
  walkNodes([node], each => {
    anchors.push(...outlineAnchors(ctx, each.id));
  });
  return anchors;
}

/** Each context this module gave an outline, and the one it was given. */
const BEFORE_OUTLINE = new WeakMap<PageContext, PageContext>();

/**
 * `ctx` with the page's outline on it.
 *
 * Never by writing to the host's object: a host may hand one context to
 * more than one render. A plain object is copied with the outline added. A
 * host's own class instance is not copied, since a copy loses its prototype
 * methods and a method reading a native private field throws on anything but
 * the instance itself; it is viewed instead (`outlineView`), with every
 * method called on the host's own instance.
 *
 * Either way the result remembers the context it was made from
 * (`contextBeforeOutline`), so what an editor keeps per context, the outputs
 * of its async blocks, is kept across a change to the outline: typing in a
 * heading changes the outline, and must not draw every image again.
 *
 * @experimental
 */
export function withOutline(
  ctx: PageContext,
  outline: PageOutline
): PageContext {
  const proto: unknown = Object.getPrototypeOf(ctx);
  const made: PageContext =
    proto === Object.prototype || proto === null
      ? { ...ctx, outline }
      : outlineView(ctx, outline);
  BEFORE_OUTLINE.set(made, contextBeforeOutline(ctx));
  return made;
}

/**
 * A view of a host's context with `outline` added: every other property is
 * read from the host's object, and a method is called with the host's object
 * as its receiver (bound once per method, so a method read twice is the same
 * function both times). The outline is also one of its own properties, so a
 * copy of the view keeps it.
 *
 * The proxy's target is an empty object of its own, not the host's: a proxy
 * may not report a frozen target's property as anything but what it holds,
 * and this one reports the outline and bound methods in place of them.
 */
function outlineView(ctx: PageContext, outline: PageOutline): PageContext {
  const bound = new Map<unknown, unknown>();
  const view = new Proxy<object>(
    {},
    {
      get(_target, key) {
        if (key === "outline") return outline;
        const value: unknown = Reflect.get(ctx, key, ctx);
        if (typeof value !== "function") return value;
        let method = bound.get(value);
        if (method === undefined) {
          method = (value as (...args: unknown[]) => unknown).bind(ctx);
          bound.set(value, method);
        }
        return method;
      },
      set(_target, key, value) {
        return Reflect.set(ctx, key, value, ctx);
      },
      has(_target, key) {
        return key === "outline" || Reflect.has(ctx, key);
      },
      ownKeys() {
        const keys = Reflect.ownKeys(ctx);
        return keys.includes("outline") ? keys : [...keys, "outline"];
      },
      getOwnPropertyDescriptor(_target, key) {
        if (key === "outline") {
          return {
            value: outline,
            writable: false,
            enumerable: true,
            configurable: true,
          };
        }
        const own = Reflect.getOwnPropertyDescriptor(ctx, key);
        // Configurable, as the empty target's own properties may only be.
        return own === undefined ? undefined : { ...own, configurable: true };
      },
      getPrototypeOf() {
        return Reflect.getPrototypeOf(ctx);
      },
    }
  );
  return view as PageContext;
}

/** The context `withOutline` was given, or `ctx` itself. @experimental */
export function contextBeforeOutline(ctx: PageContext): PageContext {
  return BEFORE_OUTLINE.get(ctx) ?? ctx;
}
