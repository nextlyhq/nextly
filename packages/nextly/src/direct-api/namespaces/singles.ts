/**
 * Direct API Singles Namespace
 *
 * Top-level single entry operations — `findSingle`, `updateSingle`,
 * and `findSingles` for listing the content of every registered single type.
 *
 * @packageDocumentation
 */

import { currentPrincipal } from "../../auth/principal-scope";
import type { ListSinglesOptions } from "../../domains/singles/services/single-registry-service";
import { collectingWarnings } from "../../hooks/side-effect-warnings";
import { transformRichTextFields } from "../../lib/field-transform";
import type { Principal } from "../../plugins/principals/types";
import type {
  MutationResult,
  RowFromSingleSlug,
  FindSingleArgs,
  FindSinglesArgs,
  SingleListResult,
  SingleSlug,
  UpdateSingleArgs,
} from "../types/index";

import type { NextlyContext } from "./context";
import {
  accessOptions,
  buildMutationMessage,
  createErrorFromSingleResult,
  mergeConfig,
} from "./helpers";

/**
 * Retrieve the content of a single by slug.
 */
export async function findSingle<TSlug extends SingleSlug>(
  ctx: NextlyContext,
  args: FindSingleArgs<TSlug>
): Promise<RowFromSingleSlug<TSlug>> {
  const config = mergeConfig(ctx.defaultConfig, args);

  const result = await ctx.singleEntryService.get(args.slug, {
    depth: config.depth,
    locale: config.locale,
    // Fallback control belongs to the read: it decides whether an untranslated
    // field falls back to the default language, and a rule keyed on it sees
    // `undefined` when it is dropped here.
    fallbackLocale: config.fallbackLocale,
    // Forwarded to the same service option `findByID` uses for its own `draft`
    // flag, so one idea keeps one spelling across the two read paths. The
    // service applies the trust gate; nothing is decided here.
    includeWorkingDraft: args.draft,
    ...(args.status === undefined ? {} : { status: args.status }),
    ...accessOptions(config),
    context: config.context,
  });

  if (!result.success) {
    throw createErrorFromSingleResult(result);
  }

  let data = result.data as RowFromSingleSlug<TSlug>;

  if (
    config.richTextFormat &&
    config.richTextFormat !== "json" &&
    result.data
  ) {
    const single = await ctx.singleRegistryService.getSingleBySlug(args.slug);
    if (single?.fields && Array.isArray(single.fields)) {
      // Redundant in this package's own tsconfig, but required when the value is
      // re-checked from a consumer's compilation (e.g. the playground) where the
      // transform's return widens to Record<string, unknown>.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      data = transformRichTextFields(
        result.data,
        single.fields,
        config.richTextFormat
      ) as RowFromSingleSlug<TSlug>;
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
): Promise<MutationResult<RowFromSingleSlug<TSlug>>> {
  const config = mergeConfig(ctx.defaultConfig, args);

  const { result, warnings } = await collectingWarnings(() =>
    ctx.singleEntryService.update(args.slug, args.data, {
      locale: config.locale,
      ...accessOptions(config),
      context: config.context,
      disableRevalidate: config.disableRevalidate,
    })
  );

  if (!result.success) {
    throw createErrorFromSingleResult(result);
  }

  return {
    message: buildMutationMessage(args.slug, "updated"),
    item: result.data as RowFromSingleSlug<TSlug>,
    ...(warnings ? { warnings } : {}),
  };
}

/**
 * Fetch the actual content for every registered single type.
 */
export async function findSingles(
  ctx: NextlyContext,
  args: FindSinglesArgs = {}
): Promise<SingleListResult> {
  const config = mergeConfig(ctx.defaultConfig, args);
  const filters = {
    source: args.source,
    migrationStatus: args.migrationStatus,
    locked: args.locked,
    search: args.search,
  };

  // Made as a person, the list holds only the Singles the person may read,
  // and its total counts only those: a total taken before the read gate
  // would say how many protected Singles match a search, and so whether one
  // exists, even on a page past the end where no Single is read at all.
  const person = currentPrincipal();
  const registryResult = await ctx.singleRegistryService.listSingles({
    ...filters,
    ...(person === null
      ? {}
      : { slugAllowlist: await readableSingleSlugs(ctx, person, filters) }),
    limit: args.limit,
    offset: args.offset,
  });

  const entries = await Promise.all(
    registryResult.data.map(async record => {
      const result = await ctx.singleEntryService.get(record.slug, {
        depth: config.depth,
        locale: config.locale,
        fallbackLocale: config.fallbackLocale,
        ...accessOptions(config),
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

/**
 * The slugs of the Singles matching `filters` that `person` may read, asked
 * of the same gate a Single read as them asks.
 */
async function readableSingleSlugs(
  ctx: NextlyContext,
  person: Principal,
  filters: Omit<ListSinglesOptions, "limit" | "offset" | "slugAllowlist">
): Promise<string[]> {
  const { data } = await ctx.singleRegistryService.listSingles(filters);
  const admitted = await Promise.all(
    data.map(record =>
      ctx.rbacAccessControlService.checkPrincipalCodeAccess({
        operation: "read",
        resource: record.slug,
        principal: person,
      })
    )
  );
  return data.filter((_, index) => admitted[index]).map(record => record.slug);
}
