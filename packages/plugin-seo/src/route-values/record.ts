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
  listPageNumber,
  listPageOf,
  type PageMetadataInput,
  type PageMetadataResolver,
  type PluginContext,
} from "@nextlyhq/plugin-sdk";

import { singleKey } from "../problems/page-types";

import { recordRouteValues, type RouteValuesPage } from "./store";

/** The content types whose routes' values are kept. */
export interface RouteValuesTypes {
  /** The collections SEO is added to. */
  collections: readonly string[];
  /** The Singles SEO is added to. */
  singles: readonly string[];
}

/**
 * Whether `path` is a later page of a list (`/news/page/2`): its route's
 * values are that page's, not the list's own, so they are not kept as the
 * values of the document it lists.
 */
function laterListPage(path: string | undefined): boolean {
  if (path === undefined) return false;
  const later = listPageOf(path.replace(/^\/+/, ""));
  if (later === null) return false;
  const page = listPageNumber(later.segment);
  return page !== null && page >= 2;
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
  if (laterListPage(input.path)) return undefined;
  const { source } = input;
  let type: string;
  let id: string;
  if (source.kind === "entry") {
    if (!types.collections.includes(source.collection)) return undefined;
    const found = idOf(source.entry);
    if (found === undefined) return undefined;
    type = source.collection;
    id = found;
  } else {
    if (!types.singles.includes(source.slug)) return undefined;
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
 * `types` before it answers. The page's head is answered whatever happens
 * to the record.
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
      try {
        const page = await routeValuesPageOf(ctx, input, types);
        if (page !== undefined) await recordRouteValues(ctx, page, input.code);
      } catch (error) {
        ctx.logger.warn("What a page's route supplies could not be recorded", {
          error,
        });
      }
      return resolver.resolve(input);
    },
  };
}
