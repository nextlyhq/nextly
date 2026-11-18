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

import { type DtcgNode, isPlainObject, issue } from "./dtcg-format";
import { siteTextIssues } from "./site-text";
import type { SiteTokenSet } from "./site-tokens";

/** The parts of a token set the file keeps at its root. */
export type DtcgSiteData = Pick<
  SiteTokenSet,
  "siteText" | "order" | "fluidRange" | "builtInColoursShown"
>;

/** The site data a set states, as the file keeps it, or `undefined` for none. */
export function siteDataOf(set: SiteTokenSet): DtcgNode | undefined {
  const data: DtcgNode = {
    ...(set.siteText === undefined ? {} : { siteText: set.siteText }),
    ...(set.order === undefined ? {} : { order: set.order }),
    ...(set.fluidRange === undefined ? {} : { fluidRange: set.fluidRange }),
    ...(set.builtInColoursShown === undefined
      ? {}
      : { builtInColoursShown: set.builtInColoursShown }),
  };
  return Object.keys(data).length === 0 ? undefined : data;
}

/** The longest colour order read: the site holds no more variables. */
const MAX_ORDER = 10_000;

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
  const read: {
    -readonly [K in keyof DtcgSiteData]: DtcgSiteData[K];
  } = {};
  const skip = (what: string) =>
    issues.push(
      issue(`${what} in the file could not be read, so it was skipped.`)
    );
  if (kept.siteText !== undefined) {
    if (siteTextIssues(kept.siteText).length === 0) {
      read.siteText = kept.siteText as DtcgSiteData["siteText"];
    } else skip("Site text");
  }
  if (kept.order !== undefined) {
    const order = kept.order;
    if (
      Array.isArray(order) &&
      order.length <= MAX_ORDER &&
      order.every(entry => typeof entry === "string")
    ) {
      read.order = order as string[];
    } else skip("The colour order");
  }
  if (kept.fluidRange !== undefined) {
    const range = kept.fluidRange;
    if (
      isPlainObject(range) &&
      typeof range.min === "number" &&
      typeof range.max === "number" &&
      Number.isFinite(range.min) &&
      Number.isFinite(range.max) &&
      range.min > 0 &&
      range.min < range.max
    ) {
      read.fluidRange = { min: range.min, max: range.max };
    } else skip("The fluid range");
  }
  if (kept.builtInColoursShown !== undefined) {
    if (typeof kept.builtInColoursShown === "boolean") {
      read.builtInColoursShown = kept.builtInColoursShown;
    } else skip("The built-in colours setting");
  }
  return Object.keys(read).length === 0 ? undefined : read;
}
