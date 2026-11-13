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
import { NextlyError } from "../../errors/nextly-error";
import { collectingWarnings } from "../../hooks/side-effect-warnings";
import { transformRichTextFields } from "../../lib/field-transform";
import type { Principal } from "../../plugins/principals/types";
import { assertPaginationIsComplete } from "../../shared/base-registry-service";
import type {
  MutationResult,
  RowFromSingleSlug,
  FindSingleArgs,
  FindSinglesArgs,
  FoundSingle,
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
import { hiddenFieldRead } from "./hidden-fields";

/**
 * Retrieve the content of a single by slug. With `createIfMissing: false`, a
 * Single that has no stored document answers `null` and nothing is created.
 */
export async function findSingle<
  TSlug extends SingleSlug,
  TCreate extends boolean | undefined = undefined,
>(
  ctx: NextlyContext,
  args: FindSingleArgs<TSlug> & { createIfMissing?: TCreate }
): Promise<FoundSingle<TSlug, TCreate>> {
  // Only a read that declines to create can be asked what to answer in place
  // of the document it would have created; refused rather than ignored, so a
  // caller who expected the default read learns it asked for a creating one.
  if (args.whenAbsent !== undefined && args.createIfMissing !== false) {
    throw NextlyError.validation({
      errors: [
        {
          path: "whenAbsent",
          code: "REQUIRES_CREATE_IF_MISSING_FALSE",
          message:
            "Only a read with createIfMissing: false may set whenAbsent.",
        },
      ],
      logContext: {
        single: args.slug,
        reason: "when-absent-without-no-create",
      },
    });
  }
  const config = mergeConfig(ctx.defaultConfig, args);

  const result = await ctx.singleEntryService.get(args.slug, {
    depth: config.depth,
    locale: config.locale,
    // Fallback control belongs to the read: it decides whether an untranslated
    // field falls back to the default language, and a rule keyed on it sees
    // `undefined` when it is dropped here.
    fallbackLocale: config.fallbackLocale,
    wholeDocumentFallback: args.wholeDocumentFallback,
    // Forwarded to the same service option `findByID` uses for its own `draft`
    // flag, so one idea keeps one spelling across the two read paths. The
    // service applies the trust gate; nothing is decided here.
    includeWorkingDraft: args.draft,
    ...(args.status === undefined ? {} : { status: args.status }),
    // Forwarded only when stated, so the service's default (create) holds for
    // every call that does not ask.
    ...(args.createIfMissing === undefined
      ? {}
      : { createIfMissing: args.createIfMissing }),
    ...(args.whenAbsent === undefined ? {} : { whenAbsent: args.whenAbsent }),
    ...accessOptions(config),
    context: config.context,
  });

  if (!result.success) {
    throw createErrorFromSingleResult(result);
  }

  // A success with no document is the service honouring
  // `createIfMissing: false`; nothing else answers that way. The cast states
  // what `FoundSingle` already says for such a call: `null` is in its type.
  if (result.data === undefined) {
    return null as FoundSingle<TSlug, TCreate>;
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
        config.richTextFormat,
        config.richTextStyles
      ) as RowFromSingleSlug<TSlug>;
    }
  }

  // A document is in hand, which every `FoundSingle` admits whatever
  // `TCreate` is. Its hidden fields are left out where this read says so.
  return hiddenFieldRead(config).without(data, {
    kind: "single",
    slug: args.slug,
  });
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

  // The refusal before any work: made as a person, the call below reads the
  // registry for the allowlist before it lists, and a call this call will
  // refuse must not do even that read.
  assertPaginationIsComplete({ limit: args.limit, offset: args.offset });

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

  // One per call, so every Single and the documents populated on them share
  // one read of each source's declarations.
  const hiding = hiddenFieldRead(config);
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
        // Each Single's hidden fields are left out where this read says so,
        // as `findSingle` leaves them out of one.
        data: await hiding.without(result.data as Record<string, unknown>, {
          kind: "single",
          slug: record.slug,
        }),
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
