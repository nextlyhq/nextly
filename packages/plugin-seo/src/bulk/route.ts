/**
 * The bulk edit screen's routes: the content types it can edit, one type's
 * pages, and a save of the titles and descriptions a person changed.
 *
 * Every read and write is made as the person asking, so the collection's own
 * access decides what they see and change. A save is one transaction: every
 * change is saved, or, where any one is refused, none is. Each change carries
 * the version its page was read at, so a page someone else saved since is
 * refused rather than overwritten. A change is an ordinary save of the page:
 * held as a draft where the type keeps drafts, and checked again for the
 * problem list once it is saved.
 *
 * @module bulk/route
 */
import {
  NextlyError,
  respondAction,
  respondDoc,
  type PluginContext,
  type PluginRoute,
  type PluginRouteContext,
  type ServiceOpts,
} from "@nextlyhq/plugin-sdk";
import { z } from "nextly/zod";

import { isRecord } from "../plain-values";
import { recheckSaved, type ProblemChecks } from "../problems/check";
import type { ReadRules } from "../resolver/provider";
import { SEO_GROUP } from "../tab/typed";

import {
  BULK_PAGE_SIZE,
  BULK_ROWS_PATH,
  BULK_SAVE_LIMIT,
  BULK_SAVE_PATH,
  BULK_TYPES_PATH,
  type BulkRow,
  type BulkRowsBody,
  type BulkSaveBody,
  type BulkType,
  type BulkTypesBody,
} from "./contract";
import {
  keepsDrafts,
  pageLabel,
  readPages,
  typeNamesOf,
  type ReadPage,
} from "./pages";

/** What the bulk routes need from the plugin. */
export interface BulkSetup {
  /** The collections the plugin adds SEO to. */
  targets: readonly string[];
  readRules: ReadRules;
  /** The problem list's checks, run again for each saved page. */
  checks: ProblemChecks;
}

/** The person asking, as a managed read or write takes them. */
export function asCaller(ctx: PluginRouteContext): ServiceOpts {
  if (ctx.user === null) throw NextlyError.authRequired();
  return {
    as: "user",
    user: ctx.user,
    ...(ctx.authenticatedScope === undefined
      ? {}
      : { authenticatedScope: ctx.authenticatedScope }),
  };
}

/** A content type SEO is added to, or a refusal naming the slug. */
function targetOf(setup: BulkSetup, slug: string): string {
  if (!setup.targets.includes(slug)) {
    throw NextlyError.notFound({
      logContext: { reason: "seo-bulk-not-a-target", slug },
    });
  }
  return slug;
}

/** A page as the table shows it. */
function rowOf(page: ReadPage): BulkRow {
  const typed = (name: string) => {
    const value = page.seo[name];
    return typeof value === "string" ? value : "";
  };
  return {
    id: page.id,
    label: page.label,
    ...(page.path === undefined ? {} : { path: page.path }),
    title: typed("metaTitle"),
    description: typed("metaDescription"),
    ...(page.auto.title === undefined ? {} : { autoTitle: page.auto.title }),
    ...(page.auto.description === undefined
      ? {}
      : { autoDescription: page.auto.description }),
    ...(page.rev === undefined ? {} : { rev: page.rev }),
  };
}

/** The types the person may read, with how many pages each has. */
async function typesFor(
  ctx: PluginRouteContext,
  setup: BulkSetup,
  locale: string | undefined
): Promise<BulkType[]> {
  const caller = ctx.caller;
  if (caller === null) throw NextlyError.authRequired();
  const as = asCaller(ctx);
  const rules = await setup.readRules(ctx, locale);
  const types: BulkType[] = [];
  for (const slug of setup.targets) {
    if (!(await caller.can("read", slug))) continue;
    const pattern = {
      ...rules.defaultPatterns,
      ...rules.patterns[slug],
    }.title;
    types.push({
      slug,
      ...typeNamesOf(ctx, slug),
      total: await ctx.services.collections.count(slug, {}, as),
      ...(pattern === undefined ? {} : { titlePattern: pattern }),
      drafts: keepsDrafts(ctx, slug),
    });
  }
  if (types.length === 0) throw NextlyError.forbidden();
  return types;
}

/** A query parameter's text, or none. */
function param(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name);
  return value === null || value === "" ? undefined : value;
}

const SAVE_BODY = z.object({
  type: z.string().min(1),
  locale: z.string().min(1).nullish(),
  changes: z
    .array(
      z.object({
        id: z.string().min(1),
        rev: z.string().min(1).nullish(),
        title: z.string().nullish(),
        description: z.string().nullish(),
      })
    )
    .min(1)
    .max(BULK_SAVE_LIMIT),
});

type SaveBody = z.infer<typeof SAVE_BODY>;

/** The save's body, parsed, or a refusal naming what is wrong. */
async function saveBodyOf(req: Request): Promise<SaveBody> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw NextlyError.invalidInput({
      message: "The request body is not JSON.",
      logContext: { reason: "seo-bulk-body-not-json" },
    });
  }
  const parsed = SAVE_BODY.safeParse(raw);
  if (!parsed.success) {
    throw NextlyError.invalidInput({
      message: "The request body is not one this route accepts.",
      logContext: {
        reason: "seo-bulk-body-invalid",
        issues: parsed.error.issues.map(issue => issue.path.join(".")),
      },
    });
  }
  return parsed.data;
}

/**
 * The page's `seo` group with `values` set over it: every other value the
 * group holds is kept, since the group is written whole.
 */
export function seoWith(
  current: unknown,
  values: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  return { ...(isRecord(current) ? current : {}), ...values };
}

/**
 * A refusal from saving one page, said about that page: a version
 * conflict names it, and anything else is passed on as it is.
 */
export function refusalAbout(error: unknown, label: string): unknown {
  if (
    NextlyError.isCode(error, "STALE_VERSION") ||
    NextlyError.isCode(error, "CONFLICT")
  ) {
    return NextlyError.conflict({
      reason: "version",
      message: `“${label}” was saved by someone else after this was read. Nothing was saved. Read it again, then make the change again.`,
      cause: error instanceof Error ? error : undefined,
    });
  }
  return error;
}

/** The pages a save names, read on its transaction, by id. */
async function storedPages(
  ctx: PluginContext,
  transaction: Parameters<
    PluginContext["services"]["collections"]["updateEntryInTransaction"]
  >[0],
  type: string,
  ids: readonly string[],
  as: ServiceOpts
): Promise<Map<string, Record<string, unknown>>> {
  const found = new Map<string, Record<string, unknown>>();
  for (let at = 0; at < ids.length; at += 100) {
    const chunk = ids.slice(at, at + 100);
    const { data } = await ctx.services.collections.listEntriesInTransaction(
      transaction,
      type,
      {
        where: { id: { in: chunk } },
        depth: 0,
        pagination: { limit: chunk.length, page: 1 },
      },
      as
    );
    for (const entry of data as unknown[]) {
      if (isRecord(entry)) found.set(String(entry.id), entry);
    }
  }
  return found;
}

/** Save every change in one transaction, or none of them. */
async function save(
  ctx: PluginRouteContext,
  setup: BulkSetup,
  body: SaveBody
): Promise<BulkSaveBody> {
  const type = targetOf(setup, body.type);
  const as: ServiceOpts = {
    ...asCaller(ctx),
    ...(body.locale ? { locale: body.locale } : {}),
  };
  const ids = body.changes.map(change => change.id);
  if (new Set(ids).size !== ids.length) {
    throw NextlyError.invalidInput({
      message: "A page is named more than once.",
      logContext: { reason: "seo-bulk-repeated-page" },
    });
  }
  await ctx.services.collections.warmLocalizedReadiness(type);
  const revs: Record<string, string> = {};
  await ctx.services.collections.withTransaction(async transaction => {
    const stored = await storedPages(ctx, transaction, type, ids, as);
    for (const change of body.changes) {
      const entry = stored.get(change.id);
      if (entry === undefined) {
        throw NextlyError.notFound({
          logContext: { reason: "seo-bulk-page-gone", id: change.id },
        });
      }
      const values: Record<string, unknown> = {};
      if (change.title !== undefined && change.title !== null) {
        values.metaTitle = change.title;
      }
      if (change.description !== undefined && change.description !== null) {
        values.metaDescription = change.description;
      }
      try {
        const saved = await ctx.services.collections.updateEntryInTransaction(
          transaction,
          type,
          change.id,
          {
            [SEO_GROUP]: seoWith(entry[SEO_GROUP], values),
            ...(change.rev ? { _rev: change.rev } : { _overwrite: true }),
          },
          as
        );
        if (typeof saved._rev === "string") revs[change.id] = saved._rev;
      } catch (error) {
        throw refusalAbout(error, pageLabel(ctx, type, entry));
      }
    }
  });
  // Committed: each saved page is checked again for the problem list.
  for (const id of ids) recheckSaved(ctx, setup.checks, type, id);
  return { saved: ids.length, revs };
}

/** The bulk edit screen's routes. */
export function bulkRoutes(setup: BulkSetup): PluginRoute[] {
  return [
    {
      method: "GET",
      path: BULK_TYPES_PATH,
      noStore: true,
      handler: async (req, ctx) => {
        const locale = param(new URL(req.url), "locale");
        const body: BulkTypesBody = {
          types: await typesFor(ctx, setup, locale),
        };
        return respondDoc(body);
      },
    },
    {
      method: "GET",
      path: BULK_ROWS_PATH,
      noStore: true,
      handler: async (req, ctx) => {
        const url = new URL(req.url);
        const type = targetOf(setup, param(url, "type") ?? "");
        if (!(await ctx.caller?.can("read", type))) {
          throw NextlyError.forbidden();
        }
        const locale = param(url, "locale");
        const page = Math.max(1, Number(param(url, "page") ?? "1") || 1);
        const read = await readPages(ctx, type, {
          as: asCaller(ctx),
          ...(locale === undefined ? {} : { locale }),
          rules: await setup.readRules(ctx, locale),
          page,
          limit: BULK_PAGE_SIZE,
        });
        const body: BulkRowsBody = {
          type,
          rows: read.pages.map(rowOf),
          total: read.total,
          more: page * BULK_PAGE_SIZE < read.total,
        };
        return respondDoc(body);
      },
    },
    {
      method: "POST",
      path: BULK_SAVE_PATH,
      handler: async (req, ctx) => {
        const body = await saveBodyOf(req);
        const saved = await save(ctx, setup, body);
        const pages = `${saved.saved} ${saved.saved === 1 ? "page" : "pages"}`;
        return respondAction(`Saved ${pages}.`, { ...saved });
      },
    },
  ];
}
