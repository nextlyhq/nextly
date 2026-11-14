/**
 * When a page last changed, as every output tells a reader: the date its
 * published content last changed in a language (`content-dates/store`), else,
 * for a page saved before its content dates were kept, its own last save.
 *
 * One answer for the sitemap's `<lastmod>` and the structured data's
 * `dateModified`, so a save that changed only a page's SEO, as an import of
 * old values makes, moves neither, and a content change moves both to the
 * same date.
 *
 * @module content-dates/last-changed
 */
import type { AddressHolder, PluginContext } from "@nextlyhq/plugin-sdk";

import { toLastModified } from "../sitemap";

import { readContentDates } from "./store";

/**
 * A page's last change: `contentDate` where one is kept, else the document's
 * own last save, as ISO text; none where neither is a date.
 */
export function lastChangedOf(
  contentDate: string | undefined,
  document: Readonly<Record<string, unknown>>
): string | undefined {
  return contentDate ?? toLastModified(document.updatedAt);
}

/**
 * One page's content date in `locale`, read by the batch reader the sitemap
 * uses; none where none is kept, and its reader then takes the page's own
 * last save, as {@link lastChangedOf} does.
 */
export async function contentDateOf(
  ctx: PluginContext,
  holder: AddressHolder,
  locale: string
): Promise<string | undefined> {
  const dates = await readContentDates(
    ctx,
    holder.collection,
    [holder.id],
    locale
  );
  return dates.get(holder.id);
}
