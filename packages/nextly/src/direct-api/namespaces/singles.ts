/**
 * Direct API Singles Namespace
 *
 * Top-level single (global) entry operations — `findGlobal`, `updateGlobal`,
 * and `findGlobals` for listing the content of every registered single type.
 *
 * @packageDocumentation
 */

import { transformRichTextFields } from "../../lib/field-transform";
import type {
  DataFromSingleSlug,
  FindGlobalArgs,
  FindGlobalsArgs,
  SingleListResult,
  SingleSlug,
  UpdateGlobalArgs,
} from "../types/index";

import type { NextlyContext } from "./context";
import {
  convertServiceError,
  createErrorFromSingleResult,
  mergeConfig,
} from "./helpers";

/**
 * Retrieve the content of a single (global) by slug.
 */
export async function findGlobal<TSlug extends SingleSlug>(
  ctx: NextlyContext,
  args: FindGlobalArgs<TSlug>
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
        result.data as Record<string, unknown>,
        single.fields as Parameters<typeof transformRichTextFields>[1],
        config.richTextFormat
      ) as DataFromSingleSlug<TSlug>;
    }
  }

  return data;
}

/**
 * Update the content of a single (global) by slug.
 */
export async function updateGlobal<TSlug extends SingleSlug>(
  ctx: NextlyContext,
  args: UpdateGlobalArgs<TSlug>
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
export async function findGlobals(
  ctx: NextlyContext,
  args: FindGlobalsArgs = {}
): Promise<SingleListResult> {
  const config = mergeConfig(ctx.defaultConfig, args);

  let registryResult;
  try {
    registryResult = await ctx.singleRegistryService.listSingles({
      source: args.source,
      migrationStatus: args.migrationStatus,
      locked: args.locked,
      search: args.search,
      limit: args.limit,
      offset: args.offset,
    });
  } catch (error) {
    throw convertServiceError(error);
  }

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
