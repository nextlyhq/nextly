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
  BASE_BREAKPOINT,
  deviceVisibility,
  renderedDomId,
  walkNodes,
  type BlockNode,
  type BreakpointSet,
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
  /**
   * The breakpoints the part's styles are compiled under, which decide on
   * which devices a block is hidden. Absent, that is read from what each
   * block stores.
   */
  readonly breakpoints?: BreakpointSet;
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
  /**
   * Whether a table of contents lists it: a heading of the page's own
   * content, not inside a Collection list or an accordion, not left out by
   * its author, and drawn on at least one device, by itself and every block
   * around it. See `listedHere`.
   */
  readonly listed: boolean;
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

/**
 * The blocks whose headings a table of contents never lists: a Collection
 * list draws its headings once per entry, and a link into a closed accordion
 * question does not open it in every browser.
 */
const UNLISTED_WITHIN: ReadonlySet<string> = new Set([
  COLLECTION_LIST_BLOCK,
  "core/accordion",
  "core/accordion-item",
]);

/**
 * Whether a block is hidden on every device, read from what it stores: hidden
 * from the widest device down (`base`), with no breakpoint storing a show.
 * Used only when its part gives no breakpoints, as an outline built from the
 * trees alone has none to read the cascade with.
 */
function storedHiddenEverywhere(node: BlockNode): boolean {
  const devices: unknown = node.visibility?.devices;
  if (typeof devices !== "object" || devices === null) return false;
  const stored = devices as Readonly<Record<string, unknown>>;
  return (
    Object.hasOwn(stored, BASE_BREAKPOINT) &&
    stored[BASE_BREAKPOINT] === false &&
    !Object.values(stored).includes(true)
  );
}

/**
 * The viewport devices a block is drawn on: those on which it shows, read
 * through the engine's one statement of the cascade (`deviceVisibility`), as
 * the compiler and the Layers panel read it, and on which every block around
 * it shows too (`around`, absent at the top of a part). Container breakpoints
 * answer about a box, not a device, so they neither hide a block everywhere
 * nor show one again.
 */
function devicesDrawnOn(
  node: BlockNode,
  breakpoints: BreakpointSet,
  around: ReadonlySet<string> | undefined
): ReadonlySet<string> {
  const drawn = new Set<string>();
  for (const device of deviceVisibility(node.visibility, breakpoints)) {
    if (device.axis !== "viewport" || !device.visible) continue;
    if (around === undefined || around.has(device.id)) drawn.add(device.id);
  }
  return drawn;
}

/**
 * Whether a block can be seen on any device, given its parent's place. With
 * breakpoints, a block hidden on every device its ancestors show on is never
 * drawn, though neither it nor any one of them hides everywhere alone.
 */
function visibilityOf(
  node: BlockNode,
  around: NodePlace | undefined,
  breakpoints: BreakpointSet | undefined
): Pick<NodePlace, "hidden" | "drawnOn"> {
  if (breakpoints === undefined) {
    return {
      hidden: (around?.hidden ?? false) || storedHiddenEverywhere(node),
      drawnOn: undefined,
    };
  }
  const drawnOn = devicesDrawnOn(node, breakpoints, around?.drawnOn);
  return { hidden: drawnOn.size === 0, drawnOn };
}

/** Whether a heading with these facts is one a table of contents lists. */
function listedHere(
  area: OutlineArea,
  within: readonly string[],
  leftOut: boolean,
  hidden: boolean
): boolean {
  return (
    area === "content" &&
    !leftOut &&
    !hidden &&
    !within.some(type => UNLISTED_WITHIN.has(type))
  );
}

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

/** Where a block sits in its part. */
interface NodePlace {
  /** The types of the blocks around it, outermost first. */
  readonly within: readonly string[];
  /** Whether it is drawn on no device, alone or for a block around it. */
  readonly hidden: boolean;
  /**
   * The viewport devices it and every block around it show on, when its part
   * gives breakpoints.
   */
  readonly drawnOn: ReadonlySet<string> | undefined;
  /** The nearest Collection list holding it, if any. */
  readonly list: BlockNode | undefined;
}

/**
 * Reads each block's place from its parent's, for a walk that visits a
 * parent before its children.
 */
function placeReader(
  breakpoints: BreakpointSet | undefined
): (node: BlockNode, parent: BlockNode | undefined) => NodePlace {
  const places = new Map<BlockNode, NodePlace>();
  return (node, parent) => {
    const around = parent === undefined ? undefined : places.get(parent);
    const place: NodePlace = {
      within:
        parent === undefined
          ? NONE
          : [...(around?.within ?? NONE), parent.type],
      ...visibilityOf(node, around, breakpoints),
      list: parent?.type === COLLECTION_LIST_BLOCK ? parent : around?.list,
    };
    places.set(node, place);
    return place;
  };
}

/**
 * Numbers a Heading or Rich text block inside a Collection list among every
 * such block on the page, the first time it is met. Counted over the whole
 * page, not per list: two lists' entries share their places (`0`, `1`), so
 * only this tells them apart.
 */
function countEntryPassage(
  passageInList: Map<string, number>,
  area: OutlineArea,
  node: BlockNode
): void {
  if (node.type !== RICH_TEXT_BLOCK && node.type !== HEADING_BLOCK) return;
  const key = passageKey(area, node.id);
  if (!passageInList.has(key)) passageInList.set(key, passageInList.size + 1);
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
   * Each Heading and Rich text block inside a Collection list, by part and
   * node id (`passageKey`): its place among every such block on the page,
   * from 1, in page order.
   */
  readonly passageInList: ReadonlyMap<string, number>;
  /** The part a view of the outline answers for; the page's content if none. */
  readonly area?: OutlineArea;
}

/** A Rich text block's key among the page's entry passages. */
function passageKey(area: OutlineArea | undefined, nodeId: string): string {
  return `${area ?? "content"}\u0000${nodeId}`;
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
  for (const part of parts) {
    const byNode = byPart.get(part.area) ?? new Map<string, string[]>();
    byPart.set(part.area, byNode);
    const placeOf = placeReader(part.breakpoints);
    walkNodes([...part.nodes], (node, parent) => {
      const { within, hidden, list } = placeOf(node, parent);
      if (list !== undefined) countEntryPassage(passageInList, part.area, node);
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
          listed: listedHere(part.area, within, heading.leftOut, hidden),
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
  RECORDS.set(view, { ...record, area });
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
 * inside any list on the page, the block's place among them
 * (`notes-2--0--p2`), since each passage is drawn alone and two could make
 * the same id.
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
  const drawn = headingsDrawn(passage).map(heading => heading.text);
  // Drawn with no page outline (a host drawing blocks with `BlockList`):
  // the passage is outlined by itself.
  if (outline === undefined) {
    const alone = anchorAllocator();
    return drawn.map(words => {
      const id = alone.take(words);
      return place === undefined ? id : `${id}--${place}`;
    });
  }
  if (place === undefined) return outlineAnchors(ctx, nodeId);
  return entryAnchors(ctx, outline, place, nodeId, drawn);
}

/**
 * The anchors of a block inside a list's entry, from the words it draws:
 * the outline's while it draws the words the outline read for it in its
 * own part, else made from the words drawn (`passageAnchors`).
 */
function entryAnchors(
  ctx: Pick<PageContext, "outline" | "itemPosition">,
  outline: PageOutline,
  place: string,
  nodeId: string,
  drawn: readonly string[]
): readonly string[] {
  const record = RECORDS.get(outline);
  const area = record?.area ?? "content";
  const read = outline.headings.filter(
    heading => heading.node.id === nodeId && heading.area === area
  );
  const asRead =
    read.length === drawn.length &&
    read.every((heading, i) => heading.text === drawn[i]);
  if (asRead) return outlineAnchors(ctx, nodeId);
  const allocator = anchorAllocator(new Set(record?.drawn));
  const block = record?.passageInList.get(passageKey(area, nodeId)) ?? 1;
  const suffix = block > 1 ? `--p${block}` : "";
  return drawn.map(words =>
    entryId(`${allocator.take(words)}--${place}${suffix}`, record?.taken)
  );
}

/**
 * The anchors a Heading block is drawn with: the page outline's
 * (`outlineAnchors`), or, drawn with no outline (a host drawing blocks with
 * `BlockList`), those of the block outlined by itself.
 *
 * @experimental
 */
export function headingAnchors(
  ctx: Pick<PageContext, "outline" | "itemPosition">,
  node: BlockNode,
  words: string
): readonly string[] {
  const place = ctx.itemPosition;
  const drawn = words.replace(/\s+/g, " ").trim();
  // Inside a list's entry the words may be the entry's own, bound to an
  // item field and filled after the outline.
  if (ctx.outline !== undefined && place !== undefined) {
    return entryAnchors(
      ctx,
      ctx.outline,
      place,
      node.id,
      drawn === "" ? [] : [drawn]
    );
  }
  return outlineAnchors(
    {
      outline: ctx.outline ?? pageOutline([{ area: "content", nodes: [node] }]),
      ...(place === undefined ? {} : { itemPosition: place }),
    },
    node.id
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
  const record = RECORDS.get(ctx.outline);
  const anchors: string[] = [];
  let holdsPassage = false;
  walkNodes([node], each => {
    anchors.push(...outlineAnchors(ctx, each.id));
    // A passage an entry gives a Rich text is anchored with its block's
    // place among such blocks, which a list put before it moves.
    const passage = record?.passageInList.get(passageKey(record.area, each.id));
    if (passage === undefined) return;
    anchors.push(`p${passage}`);
    holdsPassage = true;
  });
  // And, for what is drawn inside a list's entry or holds blocks drawn
  // there, by every id the page's headings and authors use: their anchors
  // step past those ids, which a change anywhere on the page may move. Any
  // other block's anchors are the outline's own, already in the key.
  if (
    (holdsPassage || ctx.itemPosition !== undefined) &&
    record !== undefined
  ) {
    anchors.push(...record.drawn);
  }
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
