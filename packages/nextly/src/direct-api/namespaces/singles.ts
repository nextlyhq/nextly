/**
 * Direct API Singles Namespace
 *
 * Top-level single entry operations — `findSingle`, `updateSingle`,
 * and `findSingles` for listing the content of every registered single type.
 *
 * @packageDocumentation
 */

import { transformRichTextFields } from "../../lib/field-transform";
import type {
  DataFromSingleSlug,
  FindSingleArgs,
  FindSinglesArgs,
  SingleListResult,
  SingleSlug,
  UpdateSingleArgs,
} from "../types/index";

import type { NextlyContext } from "./context";
import { createErrorFromSingleResult, mergeConfig } from "./helpers";

/**
 * Retrieve the content of a single by slug.
 */
export async function findSingle<TSlug extends SingleSlug>(
  ctx: NextlyContext,
  args: FindSingleArgs<TSlug>
): Promise<DataFromSingleSlug<TSlug>> {
  const config = mergeConfig(ctx.defaultConfig, args);

  const result = await ctx.singleEntryService.get(args.slug, {
    depth: config.depth,
    locale: config.locale,
    user: config.user
      ? { id: config.user.id, email: config.user.role }
      : undefined,
    overrideAccess: config.overrideAccess,
    context: config.context,
  });

  if (!result.success) {
    throw createErrorFromSingleResult(result);
  }

  let data = result.data as DataFromSingleSlug<TSlug>;

  if (
    config.richTextFormat &&
    config.richTextFormat !== "json" &&
    result.data
  ) {
    const single = await ctx.singleRegistryService.getSingleBySlug(args.slug);
    if (single?.fields && Array.isArray(single.fields)) {
      data = transformRichTextFields(
        result.data,
        single.fields,
        config.richTextFormat
      );
    }
  }

  return data;
}

/**
 * Update the content of a single by slug.
 */
export async function updateSingle<TSlug extends SingleSlug>(
  ctx: NextlyContext,
  args: UpdateSingleArgs<TSlug>
): Promise<DataFromSingleSlug<TSlug>> {
  const config = mergeConfig(ctx.defaultConfig, args);

  const result = await ctx.singleEntryService.update(args.slug, args.data, {
    locale: config.locale,
    user: config.user
      ? { id: config.user.id, email: config.user.role }
      : undefined,
    overrideAccess: config.overrideAccess,
    context: config.context,
  });

  if (!result.success) {
    throw createErrorFromSingleResult(result);
  }

  return result.data as DataFromSingleSlug<TSlug>;
}

/**
 * Fetch the actual content for every registered single type.
 */
export async function findSingles(
  ctx: NextlyContext,
  args: FindSinglesArgs = {}
): Promise<SingleListResult> {
  const config = mergeConfig(ctx.defaultConfig, args);

  const registryResult = await ctx.singleRegistryService.listSingles({
    source: args.source,
    migrationStatus: args.migrationStatus,
    locked: args.locked,
    search: args.search,
    limit: args.limit,
    offset: args.offset,
  });

  const entries = await Promise.all(
    registryResult.data.map(async record => {
      const result = await ctx.singleEntryService.get(record.slug, {
        depth: config.depth,
        locale: config.locale,
        user: config.user
          ? { id: config.user.id, email: config.user.role }
          : undefined,
        overrideAccess: config.overrideAccess,
        context: config.context,
      });

      if (!result.success) {
        throw createErrorFromSingleResult(result);
      }

      return {
        slug: record.slug,
        label: record.label,
        data: result.data as Record<string, unknown>,
      };
    })
  );

  return {
    docs: entries,
    totalDocs: registryResult.total,
    limit: args.limit ?? registryResult.data.length,
    offset: args.offset ?? 0,
  };
}
