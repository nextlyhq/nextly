/**
 * A page of a type whose SEO is switched off is answered nothing by the
 * plugin: its route serves only what its own code sets, with no title
 * pattern, no structured data and no `noindex` of the plugin's. Off is not
 * "hidden from search"; hiding a type is `hiddenTypes`' job.
 *
 * @module resolver/seo-off
 */
import type {
  PageMetadataInput,
  PageMetadataResolver,
  PluginContext,
} from "@nextlyhq/plugin-sdk";

import { singleKey } from "../problems/page-types";
import { isSeoOff } from "../settings/seo-off";

import type { ReadRules } from "./provider";

/** The key the page `input` names is kept under: its slug, or `single:<slug>`. */
function typeKeyOf(input: PageMetadataInput): string {
  const { source } = input;
  return source.kind === "entry" ? source.collection : singleKey(source.slug);
}

/** `resolver`, answering nothing for a page of a type with SEO off. */
export function withSeoOff(
  ctx: PluginContext,
  resolver: PageMetadataResolver,
  readRules: ReadRules
): PageMetadataResolver {
  return {
    ...(resolver.tags === undefined
      ? {}
      : { tags: input => resolver.tags?.(input) ?? [] }),
    async resolve(input) {
      const rules = await readRules(ctx, input.locale ?? undefined);
      if (isSeoOff(rules, typeKeyOf(input))) return {};
      return resolver.resolve(input);
    },
  };
}
