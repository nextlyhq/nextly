/**
 * The design level of a page asked outside a request: the title, description
 * and share image the Page Builder design drawing the page offers.
 *
 * A route tells the resolver this level as it serves a page (`derived`). The
 * SEO tab, the problem list and the check of what search engines received ask
 * about a page without serving it, so they ask the Page Builder's design
 * service, which works the level out by the route's own derivation. Where the
 * Page Builder is not installed, or no design draws the page, the level is
 * empty and the next level answers, as on a served page.
 *
 * @module resolver/design-level
 */
import type {
  PageMetadataInput,
  PageMetadataValues,
  PluginContext,
} from "@nextlyhq/plugin-sdk";

import { isRecord } from "../plain-values";

/** The Page Builder, as its services are offered under its name. */
export const PAGE_BUILDER_PLUGIN = "@nextlyhq/plugin-page-builder";

/** Its service answering a page's design level. */
const DESIGN_SEO_SERVICE = "designSeo";

/** One page, as the service is asked about it. */
interface DesignRequest {
  collection: string;
  entry: Readonly<Record<string, unknown>>;
  locale?: string;
  document?: unknown;
}

/** What drew a page: its own design, or its collection's template. */
export type DesignDrawnBy = "design" | "template";

/** A page's design level and, where the Page Builder says, what drew it. */
export interface PageDesign {
  values: PageMetadataValues;
  drawnBy?: DesignDrawnBy;
}

/** The service's question, as the Page Builder answers it. */
type DesignFor = (request: DesignRequest) => Promise<PageDesign | undefined>;

/**
 * The service's question, where the Page Builder offers it: `designFor`, or
 * `valuesFor` alone from a Page Builder that does not say what drew a page.
 */
function designForOf(ctx: PluginContext): DesignFor | undefined {
  const services: unknown = ctx.services.plugins?.[PAGE_BUILDER_PLUGIN];
  const service = isRecord(services) ? services[DESIGN_SEO_SERVICE] : undefined;
  if (!isRecord(service)) return undefined;
  const { designFor, valuesFor } = service;
  if (typeof designFor === "function") return designFor as DesignFor;
  if (typeof valuesFor !== "function") return undefined;
  return async request => {
    const values = (await valuesFor(request)) as PageMetadataValues | undefined;
    return values === undefined ? undefined : { values };
  };
}

/**
 * The design of the page `source` names, in `locale`: drawn by `document`
 * where one is handed (a design being edited), else by the design the page's
 * route draws it with. Empty values where nothing draws it.
 */
export async function designOf(
  ctx: PluginContext,
  source: PageMetadataInput["source"],
  locale?: string,
  document?: unknown
): Promise<PageDesign> {
  // A Single's page is drawn by its own route alone; no design is asked.
  if (source.kind !== "entry") return { values: {} };
  const designFor = designForOf(ctx);
  if (designFor === undefined) return { values: {} };
  const design = await designFor({
    collection: source.collection,
    entry: source.entry,
    ...(locale === undefined ? {} : { locale }),
    ...(document === undefined ? {} : { document }),
  });
  return design ?? { values: {} };
}

/** The design level of a page: its design's values (`designOf`). */
export async function designLevelOf(
  ctx: PluginContext,
  source: PageMetadataInput["source"],
  locale?: string,
  document?: unknown
): Promise<PageMetadataValues> {
  return (await designOf(ctx, source, locale, document)).values;
}
