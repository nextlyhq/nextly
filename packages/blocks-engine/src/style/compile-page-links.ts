/**
 * Links inside a container take the container's text colour.
 *
 * A container's text colour reaches the blocks inside it by inheritance, and
 * so does a heading's, since nothing colours a heading by default. A link is
 * different: the browser's own sheet colours every link, and any declaration
 * matching an element beats a value it would inherit, so a link never takes a
 * container's colour by itself.
 *
 * So the page compile picks one of two outcomes from the site's text:
 *
 * - The Links row sets a colour or a hover colour. The element tier writes it
 *   on every link, and nothing is added here: the site's colour wins inside
 *   every container.
 * - The Links row sets no colour. Each rule that gives a container a text
 *   colour gets one more rule, at zero specificity, in the same at-rule and
 *   state: the links inside it have `color: inherit`. Any author rule beats the
 *   browser's own sheet, so a link takes the colour of the text around it, and
 *   a colour set on the link itself still wins. A link outside any coloured
 *   container keeps the browser's colour.
 *
 * Only one of the two exists for a site at a time, so the Links row and a
 * container never compete on specificity or source order.
 *
 * @module style/compile-page-links
 */
import type { BlockNode } from "../document";
import { isPlainRecord } from "../plain-record";

import type { Declaration } from "./declarations";
import type { CssRule } from "./serialize";
import { resolveSiteText, type SiteTextMap } from "./site-text";

/**
 * Whether the links inside a coloured container take its colour: while the
 * site's Links row sets no colour and no hover colour.
 *
 * @param siteText - the rows the site states; the built-in rows stand for the rest
 */
export function linksFollowContainers(siteText?: SiteTextMap): boolean {
  const link = resolveSiteText(siteText).link;
  return link?.color === undefined && link?.hoverColor === undefined;
}

/** Whether a node holds blocks of its own: only a container declares slots. */
function holdsBlocks(node: BlockNode): boolean {
  return isPlainRecord(node.slots);
}

/** The only declaration a link-colour rule writes. */
const INHERIT_COLOUR: Declaration = { property: "color", value: "inherit" };

/** One group of declarations an envelope writes, as `envelopeRules` holds it. */
interface WrittenGroup {
  /** The descendant the group attaches to: `""` for the element itself. */
  readonly descendant: string;
  /** Set when the group was routed to a part of the block. */
  readonly selector?: string;
  readonly declarations: readonly Declaration[];
}

/**
 * The rule that makes the links inside a container take its text colour, for
 * a group of its own declarations that gives it one, or `undefined` for any
 * other group.
 *
 * Wrapped whole in `:where()`, so it weighs nothing: a link's own colour, a
 * container's Link colour and any host rule on `a` still win over it.
 *
 * @param group - what the container's rule writes, and where
 * @param narrowing - what narrows the rule to containers, from the readers below; `undefined` for a rule that styles no container
 * @param element - the selector the rule styles the container by, its state included
 * @param anchor - the part of a default's selector kept outside `:where()`, if any
 * @param atRule - the at-rule the rule sits in, if any
 */
export function containerLinkRule(
  group: WrittenGroup,
  narrowing: string | undefined,
  element: string,
  anchor: string | undefined,
  atRule: string | undefined
): CssRule | undefined {
  if (narrowing === undefined || group.descendant !== "") return undefined;
  if (group.selector !== undefined) return undefined;
  if (!group.declarations.some(each => each.property === "color")) {
    return undefined;
  }
  const scoped = anchor === undefined ? element : `${anchor} ${element}`;
  return {
    ...(atRule === undefined ? {} : { atRule }),
    selector: `:where(${scoped}${narrowing} a)`,
    declarations: [INHERIT_COLOUR],
  };
}

/** The document's containers, as the page compile reads them. */
export interface ContainerReading {
  /** The block types of the document's containers. */
  readonly types: ReadonlySet<string>;
  /** The ids of the document's containers. */
  readonly ids: ReadonlySet<string>;
  /**
   * Each class's container wearers, by class id: the selectors of the
   * containers in the document that list it.
   */
  readonly wearersOf: ReadonlyMap<string, readonly string[]>;
}

/** A reading with no containers in it: nothing gets a link-colour rule. */
const NO_CONTAINERS: ContainerReading = {
  types: new Set(),
  ids: new Set(),
  wearersOf: new Map(),
};

/**
 * The document's containers: their block types and ids, and which of them
 * list each class. Empty when the site's Links row sets a colour, so no tier
 * writes a link-colour rule.
 *
 * @param nodes - each node with the class the compiler styles it by
 * @param follow - whether links follow their containers, from {@link linksFollowContainers}
 * @param classesRead - how many of a node's classes the compiler reads
 */
export function readContainers(
  nodes: readonly { node: BlockNode; className: string | undefined }[],
  follow: boolean,
  classesRead: number
): ContainerReading {
  if (!follow) return NO_CONTAINERS;
  const types = new Set<string>();
  const ids = new Set<string>();
  const wearersOf = new Map<string, string[]>();
  for (const { node, className } of nodes) {
    if (!holdsBlocks(node) || typeof node.type !== "string") continue;
    types.add(node.type);
    if (typeof node.id === "string") ids.add(node.id);
    if (className === undefined) continue;
    for (const id of classIdsOf(node, classesRead)) {
      const wearers = wearersOf.get(id) ?? [];
      wearers.push(`.${className}`);
      wearersOf.set(id, wearers);
    }
  }
  return { types, ids, wearersOf };
}

/** The class ids a node lists, as far as the compiler reads them. */
function classIdsOf(node: BlockNode, classesRead: number): string[] {
  const listed: unknown = node.classes;
  if (!Array.isArray(listed)) return [];
  return listed
    .slice(0, classesRead)
    .filter((id): id is string => typeof id === "string");
}

/**
 * What a class's rule is narrowed by for its link-colour rule, or `undefined`
 * for a class no container in the document takes a colour from.
 *
 * A look reaches only its own block type, so it is narrowed by nothing more
 * when that type is a container's. A shared style can be worn by any block,
 * and a paragraph wearing one keeps the browser's link colour as it does with
 * a colour of its own, so it is narrowed to the containers that list it.
 *
 * @param reading - the document's containers
 * @param id - the class's id
 * @param lookType - the block type a look is bound to; absent for a shared style
 */
export function classLinksNarrowing(
  reading: ContainerReading,
  id: string,
  lookType: string | undefined
): string | undefined {
  if (lookType !== undefined) {
    return reading.types.has(lookType) ? "" : undefined;
  }
  const wearers = reading.wearersOf.get(id);
  return wearers === undefined ? undefined : `:is(${wearers.join(", ")})`;
}

/**
 * What a block type's rule (its defaults, or its ★ look) is narrowed by for
 * its link-colour rule: nothing when the type is a container's, `undefined`
 * when it is not.
 */
export function typeLinksNarrowing(
  reading: ContainerReading,
  type: string
): string | undefined {
  return reading.types.has(type) ? "" : undefined;
}

/**
 * What a node's own rule is narrowed by for its link-colour rule: nothing
 * when the node is a container, `undefined` when it is not.
 */
export function nodeLinksNarrowing(
  reading: ContainerReading,
  id: string
): string | undefined {
  return reading.ids.has(id) ? "" : undefined;
}
