/**
 * Recording what a content route's code supplies as its page's head is
 * answered: when the site's page-metadata provider is asked about an entry
 * or a Single SEO is added to, what the route's `buildMetadata` gave is
 * exactly what the provider is handed, so it is kept for the admin's views
 * of the page (`route-values/store`).
 *
 * @module route-values/record
 */
import {
  languageAddressOf,
  publicAddressOf,
  type PageMetadataInput,
  type PageMetadataResolver,
  type PluginContext,
  type PublicAddressType,
} from "@nextlyhq/plugin-sdk";

import { singleKey } from "../problems/page-types";
import { laterListPage } from "../resolver/page-levels";

import { recordRouteValues, type RouteValuesPage } from "./store";

/** The content types whose routes' values are kept. */
export interface RouteValuesTypes {
  /** The collections SEO is added to. */
  collections: readonly string[];
  /** The Singles SEO is added to. */
  singles: readonly string[];
}

/**
 * Whether the route served a later page of the document's own list
 * (`/news/page/2` of `/news`): its values are that page's, not the
 * document's, so they are not kept as the document's. Judged against the
 * document's own address in the language read, by the rule its canonical
 * is formed by, so a document whose own address merely ends in `/page/2`
 * is kept as itself.
 */
async function servesLaterListPage(
  input: PageMetadataInput,
  type: PublicAddressType,
  document: Readonly<Record<string, unknown>>
): Promise<boolean> {
  if (input.path === undefined) return false;
  const own = await publicAddressOf(type, document, input.locale);
  if (own.status !== "resolved") return false;
  let path = own.path;
  if (input.locale !== undefined) {
    const inLanguage = await languageAddressOf(path, input.locale);
    if (inLanguage.status === "resolved") path = inLanguage.path;
  }
  return laterListPage(path, input.path) !== undefined;
}

/** The id a document is stored under, as text, or none. */
function idOf(document: Readonly<Record<string, unknown>>): string | undefined {
  const { id } = document;
  if (typeof id === "string" && id !== "") return id;
  return typeof id === "number" ? String(id) : undefined;
}

/**
 * The page `input` names, as its route's values are kept, where it is a page
 * of a type SEO is added to; nothing for any other page, a later page of a
 * list, or an entry with no id.
 */
export async function routeValuesPageOf(
  ctx: PluginContext,
  input: PageMetadataInput,
  types: RouteValuesTypes
): Promise<RouteValuesPage | undefined> {
  const { source } = input;
  let type: string;
  let id: string;
  if (source.kind === "entry") {
    if (!types.collections.includes(source.collection)) return undefined;
    const found = idOf(source.entry);
    if (found === undefined) return undefined;
    const address = { kind: "collection", slug: source.collection } as const;
    if (await servesLaterListPage(input, address, source.entry)) {
      return undefined;
    }
    type = source.collection;
    id = found;
  } else {
    if (!types.singles.includes(source.slug)) return undefined;
    const address = { kind: "single", slug: source.slug } as const;
    if (await servesLaterListPage(input, address, source.document)) {
      return undefined;
    }
    type = singleKey(source.slug);
    id = "";
  }
  // A route reading the page in no particular language serves the site's
  // default one, which the admin's views name it by.
  const language =
    input.locale ?? (await ctx.publicAddresses.defaultLanguage());
  return { type, id, language };
}

/**
 * `resolver`, keeping what each route supplied in code for a page of
 * `types` once it has answered: a head that could not be answered was not
 * served, so its values are not kept. The page's head is answered whatever
 * happens to the record.
 */
export function withRouteValues(
  ctx: PluginContext,
  resolver: PageMetadataResolver,
  types: RouteValuesTypes
): PageMetadataResolver {
  return {
    ...(resolver.tags === undefined
      ? {}
      : { tags: input => resolver.tags?.(input) ?? [] }),
    async resolve(input) {
      const answer = await resolver.resolve(input);
      try {
        const page = await routeValuesPageOf(ctx, input, types);
        if (page !== undefined) await recordRouteValues(ctx, page, input.code);
      } catch (error) {
        ctx.logger.warn("What a page's route supplies could not be recorded", {
          error,
        });
      }
      return answer;
    },
  };
}
