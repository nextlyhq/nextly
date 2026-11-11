/**
 * A page's structured data, from the same answer as its head.
 *
 * {@link withStructuredData} adds it to the answer the page-metadata provider
 * gives core, so the route helpers hand it to the page as they build its head
 * from the rest. {@link pageStructuredData} answers the same for the SEO tab,
 * and {@link structuredDataProblems} the details a page's chosen type is
 * missing, for the problem list; both are derived from the one build.
 *
 * @module structured-data/provider
 */
import type {
  PageMetadataInput,
  PageMetadataResolver,
  PluginContext,
} from "@nextlyhq/plugin-sdk";

import { seoPageMetadata, type ReadRules } from "../resolver/provider";

import {
  buildStructuredData,
  type PageStructuredData,
  type StructuredDataProblem,
} from "./graph";
import type { ReadStructuredDataRules, StructuredDataRules } from "./rules";

/** No rules: no address, brand or choices, so pages carry none. */
const noStructuredDataRules: ReadStructuredDataRules = () =>
  Promise.resolve({ brand: {}, types: {} } satisfies StructuredDataRules);

/**
 * `resolver` with each page's structured data added to its answer, worked
 * out from that answer: its title, description, address and image are the
 * head's own.
 */
export function withStructuredData(
  ctx: PluginContext,
  resolver: PageMetadataResolver,
  readRules: ReadStructuredDataRules = noStructuredDataRules
): PageMetadataResolver {
  return {
    // The head's own cache tags: structured data reads nothing they miss
    // but the entries a relationship names, which the page's route tags.
    ...(resolver.tags === undefined
      ? {}
      : { tags: input => resolver.tags?.(input) ?? [] }),
    async resolve(input) {
      const answer = await resolver.resolve(input);
      const { nodes } = await buildStructuredData(
        ctx,
        input,
        answer,
        await readRules(ctx, input.locale)
      );
      return nodes.length === 0 ? answer : { ...answer, structuredData: nodes };
    },
  };
}

/** Where a page's head and structured data read their rules from. */
export interface StructuredDataReaders {
  /** The resolver's rules, as the head reads them. */
  readRules?: ReadRules;
  /** The structured data rules, as the page reads them. */
  readStructuredDataRules?: ReadStructuredDataRules;
}

/**
 * The structured data of the page `input` names: the type it is described
 * as and how that was decided, the types it may choose from, its nodes, and
 * the problems that keep a chosen type out.
 */
export async function pageStructuredData(
  ctx: PluginContext,
  input: PageMetadataInput,
  readers: StructuredDataReaders = {}
): Promise<PageStructuredData> {
  const answer = await seoPageMetadata(ctx, readers.readRules).resolve(input);
  const readStructured =
    readers.readStructuredDataRules ?? noStructuredDataRules;
  return buildStructuredData(
    ctx,
    input,
    answer,
    await readStructured(ctx, input.locale)
  );
}

/**
 * What the page `input` names is missing for the type it is described as,
 * one problem per detail, each naming it: the type's markup is left out
 * until every one is there.
 */
export async function structuredDataProblems(
  ctx: PluginContext,
  input: PageMetadataInput,
  readers: StructuredDataReaders = {}
): Promise<StructuredDataProblem[]> {
  return (await pageStructuredData(ctx, input, readers)).problems;
}
