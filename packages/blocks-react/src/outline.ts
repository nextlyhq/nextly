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
 * heading's words can make one of these.
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

/**
 * The outline of a page drawn in these parts, in this order.
 *
 * Pure: the same parts give the same outline, which is what lets the
 * published route and the editor's canvas read one page alike.
 *
 * @experimental
 */
export function pageOutline(parts: readonly OutlinePart[]): PageOutline {
  const allocator = anchorAllocator(authorIds(parts));
  const headings: OutlineHeading[] = [];
  const byNode = new Map<string, { node: BlockNode; anchors: string[] }>();
  for (const part of parts) {
    const withinOf = new Map<BlockNode, readonly string[]>();
    walkNodes([...part.nodes], (node, parent) => {
      const within =
        parent === undefined
          ? NONE
          : [...(withinOf.get(parent) ?? NONE), parent.type];
      withinOf.set(node, within);
      const found = headingsOfBlock(node);
      if (found.length === 0) return;
      // Node ids are unique within a document, not across a page's parts: a
      // second block reusing an id is still listed, but the id answers the
      // first block's anchors.
      const known = byNode.get(node.id);
      const anchors: string[] = [];
      if (known === undefined) byNode.set(node.id, { node, anchors });
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
  return {
    headings,
    anchorsOf: nodeId => byNode.get(nodeId)?.anchors ?? NONE,
  };
}

/**
 * The anchors a block's headings are drawn with on this render: the
 * outline's, with the entry's place after each inside a Collection list's
 * entry, where the block is drawn once per entry.
 *
 * @experimental
 */
export function outlineAnchors(
  ctx: Pick<PageContext, "outline" | "itemPosition">,
  nodeId: string
): readonly string[] {
  const anchors = ctx.outline?.anchorsOf(nodeId) ?? NONE;
  const place = ctx.itemPosition;
  return place === undefined || anchors.length === 0
    ? anchors
    : anchors.map(anchor => `${anchor}--${place}`);
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
 * function both times).
 */
function outlineView(ctx: PageContext, outline: PageOutline): PageContext {
  const bound = new Map<unknown, unknown>();
  return new Proxy(ctx, {
    get(target, key) {
      if (key === "outline") return outline;
      const value: unknown = Reflect.get(target, key, target);
      if (typeof value !== "function") return value;
      let method = bound.get(value);
      if (method === undefined) {
        method = (value as (...args: unknown[]) => unknown).bind(target);
        bound.set(value, method);
      }
      return method;
    },
    has(target, key) {
      return key === "outline" || Reflect.has(target, key);
    },
  });
}

/** The context `withOutline` was given, or `ctx` itself. @experimental */
export function contextBeforeOutline(ctx: PageContext): PageContext {
  return BEFORE_OUTLINE.get(ctx) ?? ctx;
}
