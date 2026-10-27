/**
 * What a chart's numbers count, so a tooltip reads "12 new posts" rather than a bare "12".
 *
 * A chart is handed its unit by the card that draws it, which knows its collection; a chart with
 * none writes its numbers bare. Free of the chart engine.
 *
 * @module components/features/widgets/charts/chart-unit
 */

import pluralize from "pluralize";
import type { JSX, ReactNode } from "react";

import { useBranding } from "@admin/context/providers/BrandingProvider";

import { collectionSlugOf } from "../frame/list-view-href";
import { collectionLabel } from "../widget-as-asked";

/** The noun a chart's numbers count, for one and for any other number: "post", "posts". */
export interface ChartUnit {
  one: string;
  other: string;
}

/** A number as drawn with the noun it counts: "12 new posts", "1 new post", "2,000+ posts". */
export function withUnit(
  drawn: string,
  count: number,
  unit: ChartUnit | undefined
): string {
  if (!unit) return drawn;
  return `${drawn} ${count === 1 ? unit.one : unit.other}`;
}

/**
 * A collection's label as a noun inside a sentence: each word lowercased whose rest is already
 * lowercase, so "Blog Posts" reads "blog posts" and "FAQ Entries" keeps its "FAQ".
 */
function asNoun(label: string): string {
  return label
    .split(" ")
    .map(word =>
      word.slice(1) === word.slice(1).toLowerCase() ? word.toLowerCase() : word
    )
    .join(" ");
}

/**
 * The unit of a chart counting a collection's entries, by the collection's label as published to
 * this reader, with `qualifier` before it ("new posts"); `undefined` for no collection.
 */
export function useCollectionUnit(
  collection: string | undefined,
  qualifier?: string
): ChartUnit | undefined {
  const sources = useBranding().widgetSources;
  if (collection === undefined) return undefined;
  const other = asNoun(collectionLabel(collection, sources));
  const one = pluralize.singular(other);
  const before = qualifier ? `${qualifier} ` : "";
  return { one: `${before}${one}`, other: `${before}${other}` };
}

/**
 * The unit of a card reading the collection a `collection:<slug>` source names, handed to a chart
 * drawn where no hook can be called: an archetype's body is drawn by a function.
 */
export function WithCollectionUnit({
  source,
  qualifier,
  children,
}: {
  source: string | undefined;
  qualifier?: string;
  children: (unit: ChartUnit | undefined) => ReactNode;
}): JSX.Element {
  return (
    <>{children(useCollectionUnit(collectionSlugOf(source), qualifier))}</>
  );
}
