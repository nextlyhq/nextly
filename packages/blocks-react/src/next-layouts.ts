/**
 * Which regions a routed page is drawn inside, and what its cache entry has to
 * carry because it asked.
 *
 * A page names a Layout, names nothing (the site's default), or switches its
 * header and footer off. The RULE that turns those into one answer is the
 * engine's `resolvePageLayout`, shared with the plugin and the editor; this
 * module only reads what the rule asks about, in the order the rule needs it,
 * so a page reads no more than its own answer depends on.
 *
 * Reachable only from `next.ts`, because the reads here are tagged through
 * `nextly/runtime`: the package root stays usable with no CMS behind it.
 *
 * @module next-layouts
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  resolvePageLayout,
  type BlockDocument,
  type LayoutResolution,
  type PageLayoutChoice,
} from "@nextlyhq/blocks-engine";
import {
  cachedFind,
  nextlySingleTags,
  releaseBoundedRevalidate,
} from "nextly/runtime";
import type { ContentEntry } from "nextly/runtime";

import type { QueryBudget } from "./context";

/**
 * Where a route finds the site's Layouts, for a route drawing each page inside
 * its Layout.
 *
 * A PROVIDER, for the reason `siteStyles` takes one: the site's default lives
 * in storage and changes without a deploy, so it is read per render, and a
 * read through the Direct API contributes no cache tag of its own. `singles`
 * names what `readDefault` reads, so a write to it reaches the pages that
 * depend on the default. The page-builder plugin supplies one, so this package
 * never imports the plugin to learn where the default is kept.
 *
 * @experimental New public surface: its names and shape may change before it
 * is marked stable.
 */
export interface BlocksLayoutsProvider {
  /** The site's default Layout id, or null. Called per render. */
  readDefault: () => Promise<string | null>;
  /**
   * The Singles `readDefault` reads, so a write to them revalidates the pages
   * that depend on the default. An empty array states that it reads none.
   */
  singles: readonly string[];
  /** The Layouts collection. Defaults to {@link DEFAULT_LAYOUTS_COLLECTION}. */
  collection?: string;
  /** The page's field names, each defaulted as named below. */
  pageFields?: {
    /** The relationship to the page's Layout. Defaults to `layout`. */
    layout?: string;
    /** The switch for no header or footer. Defaults to `noHeaderFooter`. */
    noHeaderFooter?: string;
  };
}

/** What Layouts are stored under when a route names nothing. */
export const DEFAULT_LAYOUTS_COLLECTION = "layouts";

/**
 * The longest a cached read may live, in seconds, when it answers that a page
 * has no usable default Layout.
 *
 * A tag is not enough on its own here. The plugin repairs a lost default from
 * its job runner, which usually runs outside a request, and a tag revalidation
 * issued there can be held rather than applied; a page cached as "no regions"
 * would then wait for some unrelated write. Bounding the reads that gave that
 * answer means the page asks again within this long and picks up the repaired
 * default. Short, because the state it bounds is a fault being repaired, and
 * only pages in that state pay for it: a page with a usable Layout keeps the
 * ordinary lifetime.
 */
// 60 s: the repair's tag revalidation can be held when it runs outside a
// request, so this bound, not the tag, is what guarantees the refresh.
const NO_DEFAULT_REVALIDATE_SECONDS = 60;

/**
 * The lifetime a cached read takes under both bounds: the next scheduled
 * release, as every read on the route already has, and a cap of its own. The
 * smaller wins; `false` (no release scheduled) leaves the cap alone.
 */
export function cappedLifetime(release: number | false, cap: number): number {
  return release === false ? cap : Math.min(release, cap);
}

/**
 * The areas a route draws, and where each goes relative to the page.
 *
 * Stated here rather than read from the plugin's area list, which this
 * package cannot import. An area the plugin adds later is simply not drawn
 * until a route knows where it goes, which is the honest answer: a sidebar has
 * no position in "before the page, after the page".
 */
const REGION_AREAS = ["header", "footer"] as const;

/** One of the areas a route draws. */
export type RegionArea = (typeof REGION_AREAS)[number];

/** One region to draw: which area, filled by which component. */
export interface LayoutRegion {
  readonly area: RegionArea;
  readonly componentId: string;
}

/**
 * The provider, checked once when the route is built.
 *
 * A bare function is refused rather than read as a provider for the reason
 * `siteStyles` refuses one: a JavaScript caller passing `readDefault` alone
 * would leave its singles untagged, and every page depending on the default
 * would keep its old regions for good. A wrong shape fails at boot, which is
 * the one outcome nobody can mistake for working.
 */
export function checkedLayoutsProvider(
  value: unknown
): BlocksLayoutsProvider | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as { readDefault?: unknown }).readDefault !== "function" ||
    !Array.isArray((value as { singles?: unknown }).singles)
  ) {
    throw new TypeError(
      "layouts must be { readDefault, singles }: a provider that does not name the singles its read depends on leaves cached pages on their old regions."
    );
  }
  return value as BlocksLayoutsProvider;
}

/** A relationship value as an id: stored as the id, or populated as the row. */
function relationId(value: unknown): string | null {
  if (typeof value === "string") return value.trim() === "" ? null : value;
  if (typeof value === "object" && value !== null) {
    return relationId((value as { id?: unknown }).id);
  }
  return null;
}

/** What the entry says about its Layout, read through the configured names. */
function pageChoice(
  entry: ContentEntry,
  provider: BlocksLayoutsProvider
): PageLayoutChoice {
  const fields = provider.pageFields ?? {};
  return {
    layout: relationId(entry[fields.layout ?? "layout"]),
    noHeaderFooter: entry[fields.noHeaderFooter ?? "noHeaderFooter"] === true,
  };
}

/**
 * Reads Layout rows by id at the route's posture, tagged per requested id.
 *
 * `maxLifetime` caps how long a cached read may live, in seconds, on top of
 * the release bound every read takes; see {@link NO_DEFAULT_REVALIDATE_SECONDS}.
 */
export type LayoutRowReader = (
  ids: readonly string[],
  options?: { maxLifetime?: number }
) => Promise<readonly Record<string, unknown>[]>;

/** What {@link regionsFor} reads through. */
export interface RegionsForArgs {
  readonly provider: BlocksLayoutsProvider;
  readonly entry: ContentEntry;
  readonly readRows: LayoutRowReader;
  readonly budget: QueryBudget;
  readonly cacheScope: string | undefined;
}

/**
 * The regions `entry` is drawn inside, by the engine's rule.
 *
 * Reads in the order the rule needs answers, and no further:
 *
 * - a page that switches its header and footer off reads nothing at all;
 * - a page naming a Layout reads that Layout, and stops there when it is
 *   published, so its cache entry carries that Layout's tag and nothing about
 *   the default;
 * - only a page that depends on the default (it names nothing, or names a
 *   Layout that is not published now) reads the default, which is what puts
 *   the settings Single's tag and the default Layout's tag on it and on no
 *   other page.
 *
 * The rule is asked at every step rather than restated here, so "does this
 * page need the default" is answered by the same function that decides which
 * Layout it gets.
 *
 * Never writes. A site whose default is missing or not published draws its
 * pages with no regions and says so; repairing the default is the plugin's
 * scheduled job, and its write to the Single revalidates these pages.
 */
export async function regionsFor(
  args: RegionsForArgs
): Promise<readonly LayoutRegion[]> {
  const { provider, entry, readRows } = args;
  const choice = pageChoice(entry, provider);
  const rows = new Map<string, Record<string, unknown>>();
  const asked = new Set<string>();
  const fetchRow = async (
    id: string,
    options?: { maxLifetime?: number }
  ): Promise<void> => {
    for (const row of await readRows([id], options)) {
      // Filed under the id ASKED for, never under one read off the row: an
      // `afterRead` hook may rewrite the returned id, and a row filed under
      // another key would let one Layout stand in for a different one.
      if (relationId(row) === id) rows.set(id, row);
    }
  };
  const read = async (id: string | null | undefined): Promise<void> => {
    if (id === null || id === undefined || asked.has(id)) return;
    asked.add(id);
    await fetchRow(id);
  };
  const resolve = (defaultLayout: string | null): LayoutResolution =>
    resolvePageLayout(choice, {
      defaultLayout,
      isPublished: id => rows.has(id),
    });

  // With nothing read, the rule can only answer "switched off" for certain.
  if (isSwitchedOff(resolve(null))) return [];

  await read(choice.layout);
  const own = resolve(null);
  if (own.kind === "layout") return regionsOf(rows.get(own.id));

  const defaultLayout = await readDefaultLayout(args);
  await read(defaultLayout);
  const resolution = resolve(defaultLayout);
  if (resolution.kind === "layout") {
    return regionsOf(rows.get(resolution.id));
  }

  // "No usable default" is asked again, through reads that may live no longer
  // than NO_DEFAULT_REVALIDATE_SECONDS, and THEIR answer is the one drawn. The
  // reads above cannot carry that bound: whether they answer "no default" is
  // only known once they have run. Kept apart under their own cache keys, so
  // the bound applies to exactly the pages in this state, and the page's own
  // entry, which lives no longer than its shortest read, follows.
  const repaired = await readDefaultLayout(args, NO_DEFAULT_REVALIDATE_SECONDS);
  if (repaired !== null) {
    await fetchRow(repaired, { maxLifetime: NO_DEFAULT_REVALIDATE_SECONDS });
  }
  const answer = resolve(repaired);
  if (answer.kind === "layout") return regionsOf(rows.get(answer.id));
  reportNoDefault(repaired);
  return [];
}

function isSwitchedOff(resolution: LayoutResolution): boolean {
  return resolution.kind === "none" && resolution.reason === "switched-off";
}

/**
 * The site's default Layout id, through a read tagged with the provider's
 * singles.
 *
 * Cached so that the read can carry tags at all: a Direct API read inside the
 * provider contributes none, and the tag has to reach the PAGE's cache entry
 * for the default's change to reach the page. Read only for a page that
 * depends on the default, which is what keeps those tags off every other page.
 *
 * A provider that throws costs the regions, never the page, and how the
 * failure is cached depends on which read met it:
 *
 * - The ordinary read lets the error out of its cached function, so it is
 *   never stored, let alone under the ordinary lifetime. Read as no default,
 *   it sends `regionsFor` to the bounded read below.
 * - The bounded read (`maxLifetime`, NO_DEFAULT_REVALIDATE_SECONDS) catches it
 *   INSIDE its cached function and answers null. That answer is a successful
 *   cache entry living at most that long and carrying the provider's Single
 *   tags, so the page built on it is rebuilt within the bound once the
 *   provider recovers, or at once by a write to the settings. A failure
 *   caught outside every cached read would leave the page cached headerless
 *   with nothing to invalidate it.
 *
 * Reported once per read that meets it: by the bounded read, which every
 * failing ordinary read is followed by.
 */
async function readDefaultLayout(
  args: RegionsForArgs,
  maxLifetime?: number
): Promise<string | null> {
  const { provider, budget, cacheScope } = args;
  // A read is a read, charged like every other one this render makes.
  if (!budget.take()) return null;
  const bounded = maxLifetime !== undefined;
  const read = async (): Promise<string | null> => {
    try {
      return relationId(await provider.readDefault());
    } catch (error) {
      if (!bounded) throw error;
      reportUnreadableDefault(error);
      return null;
    }
  };
  try {
    const release = await releaseBoundedRevalidate(undefined);
    const revalidate = bounded ? cappedLifetime(release, maxLifetime) : release;
    return await cachedFind(read, {
      tags: provider.singles.flatMap(slug => nextlySingleTags(slug)),
      keyParts: [
        // A bounded read is its own entry, so the cap applies to it alone and
        // an ordinary read of the same default keeps its lifetime.
        bounded
          ? `nextly-layout-default:${String(maxLifetime)}`
          : "nextly-layout-default",
        // The tenant discriminator, as every other cached read on this route
        // keys it, so two deployments never serve each other's default.
        cacheScope ?? "",
        ...provider.singles,
      ],
      revalidate,
    });
  } catch (error) {
    // What reaches here is never stored. The ordinary read's provider failure
    // is reported by the bounded read that follows it; anything else (the
    // cache itself failing) is reported now.
    if (bounded) reportUnreadableDefault(error);
    return null;
  }
}

/** Say that the provider could not answer, and what that costs the page. */
function reportUnreadableDefault(error: unknown): void {
  console.warn(
    `[nextly] The site's default Layout could not be read, so this page is drawn with no header or footer: ${error instanceof Error ? error.message : String(error)}`
  );
}

/**
 * Say why a page that depends on the default has no regions.
 *
 * Logged rather than thrown: the page itself is fine, and failing it over its
 * header would turn one missing setting into every page on the site erroring.
 */
function reportNoDefault(defaultLayout: string | null): void {
  console.warn(
    defaultLayout === null
      ? "[nextly] The site has no default Layout, so pages that use the default are drawn with no header or footer until one is set."
      : `[nextly] The site's default Layout (${defaultLayout}) is not published, so pages that use the default are drawn with no header or footer until it is.`
  );
}

/**
 * The regions a Layout row fills, in the order the route draws them.
 *
 * `areas` is a repeater stored as JSON, so it is read as untrusted data: a row
 * with no area or no component is skipped, and the first row for an area wins
 * (the Layout's own write refuses a repeated area, so a second can only arrive
 * from a write that skipped that check).
 */
function regionsOf(
  row: Record<string, unknown> | undefined
): readonly LayoutRegion[] {
  const areas = row?.areas;
  if (!Array.isArray(areas)) return [];
  const regions: LayoutRegion[] = [];
  for (const area of REGION_AREAS) {
    const filled = areas.find(
      (item: unknown) =>
        typeof item === "object" &&
        item !== null &&
        (item as { area?: unknown }).area === area
    ) as { component?: unknown } | undefined;
    const componentId = relationId(filled?.component);
    if (componentId !== null) regions.push({ area, componentId });
  }
  return regions;
}

/**
 * A document holding one component instance per region.
 *
 * A region is drawn through the SAME composition path as a component on a
 * page, rather than through a renderer of its own: an instance node is what
 * that path already reads, tags, budgets and draws, nested components and
 * drafts included. The node id is fixed per area, so each region's compiled
 * classes are stable from one render to the next.
 */
export function regionDocument(
  regions: readonly LayoutRegion[]
): BlockDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: regions.map(region => ({
      id: `nextly-region-${region.area}`,
      type: COMPONENT_INSTANCE_TYPE,
      version: 1,
      props: { componentId: region.componentId },
    })),
  };
}
