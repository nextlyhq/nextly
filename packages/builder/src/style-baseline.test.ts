/**
 * The Baseline gate, checked against the web-features release the build pins.
 *
 * The gate itself (`style-baseline.ts`) ships only the short list of what it
 * withholds, because the dataset is several megabytes and the editor has no use
 * for it at run time. This file is where that list is held to the data: every
 * value the Style tab offers must be "widely available", and every value it
 * withholds must still not be — so a deliberate bump of the pin either passes
 * or names exactly which entries to add or release.
 *
 * **The compat key is derived from the catalog's own `cssProperty`**, never
 * restated in a second table: `css.properties.<property>` for the property, and
 * `css.properties.<property>.<keyword>` for one of its keywords where the data
 * tracks that keyword separately. A keyword the data does not track is covered
 * by its property's key. The "every property key exists" case below is what
 * keeps that derivation honest: a property the convention cannot find fails
 * there instead of passing as covered.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { STYLE_CATALOG, shapeLeaves } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";
import { features } from "web-features";

import {
  BASELINE_DATA_RELEASE,
  BASELINE_WITHHELD,
  keywordWithheld,
  propertyWithheld,
} from "./style-baseline";

// The dataset types the status as `boolean`, though it only ever stores `false`.
type BaselineStatus = "high" | "low" | boolean;

interface KeyStatus {
  /** The status the data gives this one compat key. */
  readonly key: BaselineStatus;
  /** The status of the feature the key belongs to. */
  readonly feature: BaselineStatus;
}

/**
 * Every compat key the data assigns to a feature, with its own status and its
 * feature's.
 *
 * Both are kept because Baseline is a FEATURE's status: `display: contents` is
 * supported everywhere as a key, but the feature is held back by accessibility
 * defects, and `background-attachment` the property is everywhere while the
 * feature is not, because `fixed` is missing on iOS. A value counts as widely
 * available only when both say so.
 */
function statusByKey(): ReadonlyMap<string, KeyStatus> {
  const map = new Map<string, KeyStatus>();
  for (const feature of Object.values(features)) {
    if (feature.kind !== "feature") continue;
    for (const key of feature.compat_features ?? []) {
      map.set(key, {
        key:
          feature.status.by_compat_key?.[key]?.baseline ??
          feature.status.baseline,
        feature: feature.status.baseline,
      });
    }
  }
  return map;
}

const STATUS = statusByKey();

/** The CSS-wide keywords, tracked by the data under their own type. */
const CSS_WIDE = new Set([
  "inherit",
  "initial",
  "unset",
  "revert",
  "revert-layer",
]);

/**
 * The compat key a property is tracked under. A custom property the engine
 * writes (a background's overlay, which its image reads through `color-mix`,
 * itself widely available) is tracked as every custom property is, under one
 * key for them all.
 */
function propertyKey(cssProperty: string): string {
  return cssProperty.startsWith("--")
    ? "css.properties.custom-property"
    : `css.properties.${cssProperty}`;
}

/**
 * The compat keys a keyword is tracked under, or none when the data tracks it
 * only as part of its property.
 *
 * A keyword of several words is either tracked whole (`last baseline`, spelt
 * with underscores) or as the multi-keyword syntax plus each of its words, the
 * way `display: block ruby` is both two-value display and ruby.
 */
function keywordKeys(cssProperty: string, keyword: string): string[] {
  if (CSS_WIDE.has(keyword)) return [`css.types.global_keywords.${keyword}`];
  const base = propertyKey(cssProperty);
  const whole = `${base}.${keyword.replaceAll(" ", "_")}`;
  if (STATUS.has(whole)) return [whole];
  const words = keyword.split(" ");
  if (words.length === 1) return [];
  return [
    `${base}.multi-keyword_values`,
    ...words.map(word => `${base}.${word}`),
  ].filter(key => STATUS.has(key));
}

/** Whether every one of these keys is widely available, key and feature both. */
function widelyAvailable(keys: readonly string[]): boolean {
  return keys.every(key => {
    const status = STATUS.get(key);
    return status?.key === "high" && status.feature === "high";
  });
}

/** One offerable thing: a property, or one keyword of it. */
interface Offerable {
  readonly cssProperty: string;
  readonly keyword?: string;
}

/** Every property and keyword the catalog declares, once each. */
function catalogOfferables(): Offerable[] {
  const seen = new Set<string>();
  const out: Offerable[] = [];
  const add = (entry: Offerable) => {
    const id = `${entry.cssProperty}:${entry.keyword ?? ""}`;
    if (seen.has(id)) return;
    seen.add(id);
    out.push(entry);
  };
  for (const entry of STYLE_CATALOG) {
    for (const leaf of shapeLeaves(entry.shape)) {
      add({ cssProperty: leaf.cssProperty });
      const keywords =
        leaf.kind === "keyword"
          ? leaf.values
          : leaf.kind === "dimension" || leaf.kind === "url"
            ? (leaf.keywords ?? [])
            : [];
      for (const keyword of keywords)
        add({ cssProperty: leaf.cssProperty, keyword });
      // The declarations a keyword writes beside its own reach a page just
      // the same, so each property they use is held to the same bar.
      if (leaf.kind === "keyword") {
        for (const expansion of Object.values(leaf.expands ?? {}).flat())
          add({ cssProperty: expansion.property });
      }
    }
  }
  return out;
}

function keysOf(entry: Offerable): string[] {
  const property = [propertyKey(entry.cssProperty)];
  return entry.keyword === undefined
    ? property
    : [...property, ...keywordKeys(entry.cssProperty, entry.keyword)];
}

function withheld(entry: Offerable): boolean {
  return entry.keyword === undefined
    ? propertyWithheld(entry.cssProperty)
    : keywordWithheld(entry.cssProperty, entry.keyword);
}

const describeEntry = (entry: Offerable) =>
  entry.keyword === undefined
    ? entry.cssProperty
    : `${entry.cssProperty}: ${entry.keyword}`;

describe("the Baseline gate", () => {
  it("reads the web-features release the package pins, exactly", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const manifest = JSON.parse(
      readFileSync(join(here, "..", "package.json"), "utf8")
    ) as {
      devDependencies: Record<string, string>;
    };
    const installed = JSON.parse(
      readFileSync(
        join(here, "..", "node_modules", "web-features", "package.json"),
        "utf8"
      )
    ) as { version: string };
    // An exact pin, so moving it is a reviewed change that reruns this file.
    expect(manifest.devDependencies["web-features"]).toBe(
      BASELINE_DATA_RELEASE
    );
    expect(installed.version).toBe(BASELINE_DATA_RELEASE);
  });

  it("finds every catalog property in the data under its derived key", () => {
    const missing = [
      ...new Set(catalogOfferables().map(entry => entry.cssProperty)),
    ].filter(cssProperty => !STATUS.has(propertyKey(cssProperty)));
    expect(missing).toEqual([]);
  });

  it("tells a value that is not widely available from one that is", () => {
    // Positive and negative controls on values whose answer is known, so a
    // checker that answered "available" for everything cannot pass the cases
    // below.
    expect(
      widelyAvailable(keysOf({ cssProperty: "display", keyword: "flex" }))
    ).toBe(true);
    expect(
      widelyAvailable(keysOf({ cssProperty: "background-attachment" }))
    ).toBe(false);
    expect(
      widelyAvailable(
        keysOf({ cssProperty: "background-attachment", keyword: "fixed" })
      )
    ).toBe(false);
    expect(
      widelyAvailable(keysOf({ cssProperty: "display", keyword: "block ruby" }))
    ).toBe(false);
    expect(widelyAvailable(keysOf({ cssProperty: "anchor-name" }))).toBe(false);
  });

  it("offers only what Baseline marks widely available", () => {
    const offeredButNotWide = catalogOfferables()
      .filter(entry => !withheld(entry))
      .filter(entry => !widelyAvailable(keysOf(entry)))
      .map(describeEntry);
    expect(offeredButNotWide).toEqual([]);
  });

  it("withholds only what is still not widely available", () => {
    // The other direction: an entry the data now marks widely available is
    // ready to be offered, and leaving it here would keep a working control
    // from authors after the bump that made it safe.
    const withheldButWide = BASELINE_WITHHELD.filter(entry =>
      widelyAvailable(keysOf(entry))
    ).map(describeEntry);
    expect(withheldButWide).toEqual([]);
  });

  it("names nothing the catalog does not declare", () => {
    // A withheld keyword may be a whole value or one word of one, since the
    // gate withholds a value when any of its words is (`safe` in `safe center`).
    const declared = new Set(
      catalogOfferables().flatMap(entry => {
        const words =
          entry.keyword === undefined
            ? [""]
            : [entry.keyword, ...entry.keyword.split(" ")];
        return words.map(word => `${entry.cssProperty}:${word}`);
      })
    );
    const stale = BASELINE_WITHHELD.filter(
      entry => !declared.has(`${entry.cssProperty}:${entry.keyword ?? ""}`)
    ).map(describeEntry);
    expect(stale).toEqual([]);
  });

  it("withholds every keyword of a withheld property", () => {
    // A property the gate withholds draws no control at all, so asking about
    // one of its keywords must give the same answer rather than offering a
    // keyword of a property that is not there.
    expect(propertyWithheld("background-attachment")).toBe(true);
    expect(keywordWithheld("background-attachment", "scroll")).toBe(true);
    expect(keywordWithheld("display", "flex")).toBe(false);
  });
});
