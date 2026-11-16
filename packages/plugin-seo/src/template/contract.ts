/**
 * What a Page Builder template's SEO panel and its route agree on: where the
 * route answers, and what it answers. A leaf, importing nothing that runs, so
 * the admin bundle can read it without reaching the server's code.
 *
 * @module template/contract
 */
import type { Levels } from "../resolver/order";
import type { PatternField } from "../settings/contract";
import type { SeoTabContext } from "../tab/contract";

/** The route's path under the plugin's namespace. */
export const SEO_TEMPLATE_PATH = "/template";

/** What the panel asks: the design as edited, and the entry to preview. */
export interface TemplateRequest {
  /** The collection the design draws. */
  collection: string;
  /** The entry to preview the design with; the newest when absent. */
  entryId?: string | null;
  locale?: string | null;
  /** The design as it is being edited, its rule included. */
  document: unknown;
}

/** One entry the design may be previewed with. */
export interface TemplateEntry {
  id: string;
  label: string;
}

/** What the route answers. */
export interface TemplateContext {
  /** The type's name for one of its pages, such as "Blog post". */
  typeLabel: string;
  /** The type's name for its pages together, such as "Blog posts". */
  typePlural: string;
  /** The variables a rule may name: each field of the type it can read. */
  fields: PatternField[];
  /** The type's image fields, which a share image may be taken from. */
  imageFields: { name: string; label: string }[];
  /** Published entries the reader may read, newest first, to preview with. */
  entries: TemplateEntry[];
  /** How many published entries of the type the reader may read. */
  count: number;
  /** The entry previewed, and every level of its answer with the design. */
  previewed?: {
    id: string;
    levels: Levels;
  };
  site: SeoTabContext["site"];
}
