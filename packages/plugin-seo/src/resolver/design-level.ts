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
const PAGE_BUILDER_PLUGIN = "@nextlyhq/plugin-page-builder";

/** Its service answering a page's design level. */
const DESIGN_SEO_SERVICE = "designSeo";

/** The service's one question, as the Page Builder answers it. */
type ValuesFor = (request: {
  collection: string;
  entry: Readonly<Record<string, unknown>>;
  locale?: string;
}) => Promise<PageMetadataValues | undefined>;

/** The service's question, where the Page Builder offers it. */
function valuesForOf(ctx: PluginContext): ValuesFor | undefined {
  const services: unknown = ctx.services.plugins?.[PAGE_BUILDER_PLUGIN];
  const service = isRecord(services) ? services[DESIGN_SEO_SERVICE] : undefined;
  const valuesFor = isRecord(service) ? service.valuesFor : undefined;
  return typeof valuesFor === "function" ? (valuesFor as ValuesFor) : undefined;
}

/** The design level of the page `source` names, in `locale`. */
export async function designLevelOf(
  ctx: PluginContext,
  source: PageMetadataInput["source"],
  locale?: string
): Promise<PageMetadataValues> {
  // A Single's page is drawn by its own route alone; no design is asked.
  if (source.kind !== "entry") return {};
  const valuesFor = valuesForOf(ctx);
  if (valuesFor === undefined) return {};
  const values = await valuesFor({
    collection: source.collection,
    entry: source.entry,
    ...(locale === undefined ? {} : { locale }),
  });
  return values ?? {};
}
