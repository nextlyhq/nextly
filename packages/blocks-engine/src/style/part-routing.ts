/**
 * Root properties a block part takes when the block renders a wrapper as its
 * root.
 *
 * An image with a caption renders a figure around its picture, and one with a
 * link renders an anchor: the node's classes stay on that wrapper, so every
 * tier styling the node (a look, a shared style, its own values) lands on the
 * wrapper's box. For most properties that is right. For a picture's corners,
 * proportion and fit it is not: on the figure, a radius rounds the box around
 * the caption and an aspect ratio squares the caption with the picture, and
 * `inherit` cannot help, because the figure keeps the value and paints it.
 *
 * A part names the properties it takes and the wrapper parts it takes them
 * from. The compiler then writes those declarations, from every tier alike,
 * on the part instead of the wrapper: the root rule gains `:not(<wrappers>)`,
 * and a second rule reaches the part as a child of the wrapper. Every tier's
 * rule gains the same weight, so the order between tiers is the order it was,
 * and the block type's own defaults stay weightless.
 *
 * @module part-routing
 * @experimental
 */

import { isBlockType, isPartName, type BlockPart } from "../document";
import { isPlainRecord } from "../plain-record";

import { STYLE_CATALOG } from "./catalog";
import type { StyleShape } from "./catalog-types";
import { escapeIdentifier } from "./css-value";
import type { Declaration } from "./declarations";
import { blockPartClassName } from "./node-class";

/** Where one routed property goes: the wrappers it leaves, the part it reaches. */
interface PartRoute {
  /** The wrapper parts' class selectors, `.nx-bp-…`. */
  readonly wrappers: readonly string[];
  /** The receiving part's class selector. */
  readonly target: string;
}

/** Routes keyed by CSS property, as a compiled declaration names it. */
export type PartRouting = ReadonlyMap<string, readonly PartRoute[]>;

/** Every CSS property a style key's shape can emit, from the catalog. */
function cssPropertiesOf(shape: StyleShape, into: Set<string>): void {
  switch (shape.kind) {
    case "union":
      for (const variant of shape.of) cssPropertiesOf(variant, into);
      return;
    case "object":
      for (const field of Object.values(shape.fields)) {
        cssPropertiesOf(field, into);
      }
      return;
    case "logicalSides":
      for (const side of Object.values(shape.sides)) {
        cssPropertiesOf(side, into);
      }
      return;
    case "logicalCorners":
      for (const corner of Object.values(shape.corners)) {
        cssPropertiesOf(corner, into);
      }
      return;
    default:
      into.add(shape.cssProperty);
  }
}

/** The CSS properties a list of style keys emits; an unknown key adds none. */
function cssPropertiesOfKeys(keys: readonly unknown[]): Set<string> {
  const properties = new Set<string>();
  for (const key of keys) {
    const entry = STYLE_CATALOG.find(each => each.property === key);
    if (entry !== undefined) cssPropertiesOf(entry.shape, properties);
  }
  return properties;
}

/** A part's class selector, escaped as the parts tier writes it. */
function partSelector(type: string, part: string): string {
  return `.${escapeIdentifier(blockPartClassName(type, part))}`;
}

/** One part's declared route, or `undefined` when it declares none usable. */
function routeOf(
  type: string,
  name: string,
  part: BlockPart | undefined
): { properties: Set<string>; route: PartRoute } | undefined {
  const takes: unknown = part?.takesFromRoot;
  if (!isPlainRecord(takes)) return undefined;
  const { properties, whenRootIs } = takes;
  if (!Array.isArray(properties) || !Array.isArray(whenRootIs)) {
    return undefined;
  }
  // A wrapper name reaches a selector, so it is held to the part grammar.
  const wrappers = whenRootIs
    .filter(each => isPartName(each))
    .map(each => partSelector(type, each));
  const css = cssPropertiesOfKeys(properties);
  if (wrappers.length === 0 || css.size === 0) return undefined;
  return {
    properties: css,
    route: { wrappers, target: partSelector(type, name) },
  };
}

/**
 * The routes every registered block's parts declare, by CSS property. Read
 * from the same record the parts tier compiles, and held to the same
 * grammar, so a type or part that tier refuses routes nothing either.
 */
export function partRouting(
  blockParts:
    | Readonly<Record<string, Readonly<Record<string, BlockPart>>>>
    | undefined
): PartRouting {
  const routing = new Map<string, PartRoute[]>();
  for (const type of Object.keys(blockParts ?? {}).sort()) {
    addTypeRoutes(routing, type, blockParts?.[type]);
  }
  return routing;
}

/** One block type's part routes, added to `routing` by CSS property. */
function addTypeRoutes(
  routing: Map<string, PartRoute[]>,
  type: string,
  parts: unknown
): void {
  if (!isBlockType(type) || !isPlainRecord(parts)) return;
  for (const name of Object.keys(parts).sort()) {
    if (!isPartName(name)) continue;
    const found = routeOf(type, name, parts[name] as BlockPart | undefined);
    if (found === undefined) continue;
    for (const property of found.properties) {
      routing.set(property, [...(routing.get(property) ?? []), found.route]);
    }
  }
}

/** One rule a routed group adds, before the caller's anchoring. */
interface RoutedRule {
  readonly selector: string;
  readonly declarations: Declaration[];
}

/** The routes of one declaration list, as a key two lists can share. */
function routesKey(routes: readonly PartRoute[]): string {
  return routes.map(r => `${r.target}<${r.wrappers.join(",")}`).join("|");
}

/**
 * A root rule's declarations split by where they go: those no part takes stay
 * on `root` as they were; each group a part takes is written twice, on the
 * root while it is no wrapper, and on the part inside each wrapper (directly,
 * or inside another of the part's wrappers, as a picture in a link in a
 * figure is). Both selectors keep the root's state, which is the element the
 * author hovered.
 */
export function routeDeclarations(
  root: string,
  state: string,
  declarations: readonly Declaration[],
  routing: PartRouting
): { kept: Declaration[]; routed: RoutedRule[] } {
  const kept: Declaration[] = [];
  const groups = new Map<
    string,
    { routes: readonly PartRoute[]; declarations: Declaration[] }
  >();
  for (const declaration of declarations) {
    const routes = routing.get(declaration.property);
    if (routes === undefined || declaration.descendant !== undefined) {
      kept.push(declaration);
      continue;
    }
    const key = routesKey(routes);
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, { routes, declarations: [declaration] });
    } else {
      group.declarations.push(declaration);
    }
  }
  const routed: RoutedRule[] = [];
  for (const { routes, declarations: group } of groups.values()) {
    const wrappers = [...new Set(routes.flatMap(r => r.wrappers))];
    routed.push({
      selector: `${root}:not(${wrappers.join(", ")})${state}`,
      declarations: group,
    });
    const targets = routes.flatMap(r =>
      r.wrappers.flatMap(outer => [
        `${root}${outer}${state} > ${r.target}`,
        ...r.wrappers
          .filter(inner => inner !== outer)
          .map(inner => `${root}${outer}${state} > ${inner} > ${r.target}`),
      ])
    );
    routed.push({ selector: targets.join(", "), declarations: group });
  }
  return { kept, routed };
}
