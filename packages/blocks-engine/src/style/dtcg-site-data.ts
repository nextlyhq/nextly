/**
 * The site's own design data in the design-token file: its Site text rows,
 * its colour order, its fluid range and whether the built-in colours are
 * listed. None of it is a variable, and the format has no place for it, so
 * it is Nextly-only data at the file's root, under the engine's extension
 * key, which other tools keep and ignore. Each part is read back only in a
 * shape the site can store; one that isn't is named and skipped, and the
 * rest still arrive.
 *
 * @module style/dtcg-site-data
 */
import type { ValidationIssue } from "../validation";

import { isColourOrder } from "./colour-order";
import { type DtcgNode, isPlainObject, issue } from "./dtcg-format";
import { siteTextIssues } from "./site-text";
import { resolveTokenPrefix, type SiteTokenSet } from "./site-tokens";

/** The parts of a token set the file keeps at its root. */
export type DtcgSiteData = Pick<
  SiteTokenSet,
  "siteText" | "order" | "fluidRange" | "builtInColoursShown"
> & {
  /**
   * The prefix the site writing the file emits its variables under, which
   * a `var()` in its values names them by. Read so an import can point
   * those at the importing site's own; never stored as that site's prefix.
   */
  readonly prefix?: string;
};

/** The site data a set states, as the file keeps it, or `undefined` for none. */
export function siteDataOf(set: SiteTokenSet): DtcgNode | undefined {
  const data: DtcgNode = {
    ...(set.siteText === undefined ? {} : { siteText: set.siteText }),
    ...(set.order === undefined ? {} : { order: set.order }),
    ...(set.fluidRange === undefined ? {} : { fluidRange: set.fluidRange }),
    ...(set.builtInColoursShown === undefined
      ? {}
      : { builtInColoursShown: set.builtInColoursShown }),
    ...(set.prefix === undefined ? {} : { prefix: set.prefix }),
  };
  return Object.keys(data).length === 0 ? undefined : data;
}

/** The site data a file keeps, each part checked, or `undefined` for none. */
export function readSiteData(
  kept: unknown,
  issues: ValidationIssue[]
): DtcgSiteData | undefined {
  if (!isPlainObject(kept)) {
    issues.push(
      issue(
        "The site's design data in the file could not be read, so none of it was imported."
      )
    );
    return undefined;
  }
  const read: Record<string, unknown> = {};
  for (const [key, what, readable] of PARTS) {
    const value = kept[key];
    if (value === undefined) continue;
    if (readable(value)) read[key] = value;
    else {
      issues.push(
        issue(`${what} in the file could not be read, so it was skipped.`)
      );
    }
  }
  return Object.keys(read).length === 0 ? undefined : read;
}

/** Each part the file keeps, what it is called, and the shape it must take. */
const PARTS: readonly (readonly [
  key: keyof DtcgSiteData,
  what: string,
  readable: (value: unknown) => boolean,
])[] = [
  ["siteText", "Site text", value => siteTextIssues(value).length === 0],
  // By the rule the stored site style is held to, so an order the save
  // would refuse is skipped here and the rest of the import still lands.
  ["order", "The colour order", isColourOrder],
  ["fluidRange", "The fluid range", isFluidRange],
  [
    "builtInColoursShown",
    "The built-in colours setting",
    value => typeof value === "boolean",
  ],
  [
    "prefix",
    "The variable prefix",
    value =>
      typeof value === "string" && resolveTokenPrefix(value).prefix === value,
  ],
];

/** A fluid range: two positive, finite widths, the smaller first. */
function isFluidRange(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  const { min, max } = value;
  return (
    typeof min === "number" &&
    typeof max === "number" &&
    Number.isFinite(max) &&
    min > 0 &&
    min < max
  );
}
