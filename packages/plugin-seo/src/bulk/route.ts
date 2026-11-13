/**
 * The bulk routes Pages' Edit mode reads and saves through: the content
 * types it can edit, one type's pages, and a save of the titles and
 * descriptions a person changed.
 *
 * Every read and write is made as the person asking, so the collection's own
 * access decides what they see and change. A save is one transaction: every
 * change is saved, or, where any one is refused, none is. Each change carries
 * the version its page was read at, so a page someone else saved since is
 * refused rather than overwritten. A change is an ordinary save of the page:
 * held as a draft where the type keeps drafts, and checked again for the
 * problem list once it is saved.
 *
 * A Single is a content type with one page, keyed `single:<slug>`. It is
 * read and written through the Direct API as the person asking
 * (`bulk/singles`), since a plugin has no other way to a Single it does not
 * own, and a save of it is its own step.
 *
 * @module bulk/route
 */
import {
  mayWriteEntry,
  NextlyError,
  respondAction,
  respondDoc,
  type PluginContext,
  type PluginRoute,
  type PluginRouteContext,
  type ServiceOpts,
} from "@nextlyhq/plugin-sdk";
import { z } from "nextly/zod";

import { idText } from "../import/records";
import { mayChangePageSeo } from "../permissions";
import { isRecord } from "../plain-values";
import { recheckSaved, type ProblemChecks } from "../problems/check";
import { pageTypeOf } from "../problems/page-types";
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
import {
  readSingle,
  restoreSingleSeo,
  SINGLE_AS_STORED,
  singleAccessOf,
  writeSingleSeo,
  type SingleAccess,
} from "./singles";

/** What the bulk routes need from the plugin. */
export interface BulkSetup {
  /**
   * The content types the plugin adds SEO to, by key: each collection's
   * slug, and `single:<slug>` for each Single.
   */
  targets: readonly string[];
  readRules: ReadRules;
  /** The problem list's checks, run again for each saved page. */
  checks: ProblemChecks;
  /** Whether changing a type's SEO takes a permission of its own. */
  pagePermissions: boolean;
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

/**
 * The language a request names, where it is the site's default, or a
 * refusal: a write on a transaction is made in the default language, so
 * the table reads and writes in it alone, rather than read one language and
 * write another; an import reads its source in it, and reaches every
 * language itself (`import/versions`).
 */
export async function defaultLanguageOnly(
  ctx: PluginContext,
  locale: string | null | undefined
): Promise<string | undefined> {
  if (locale === undefined || locale === null || locale === "") {
    return undefined;
  }
  if (locale === (await ctx.publicAddresses.defaultLanguage())) return locale;
  throw NextlyError.invalidInput({
    message:
      "Bulk edit works in the site's default language. Edit other languages' SEO on each page.",
    logContext: { reason: "seo-bulk-not-default-language", locale },
  });
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

/**
 * The pages of `type` whose SEO the caller may change: where the type's SEO
 * takes its own permission, they hold it, and each page's own update, with
 * its rules and the `seo` group's field rule, would let them write it. A
 * Single's one page is asked of its own update.
 */
export async function writablePages(
  ctx: PluginRouteContext,
  type: string,
  ids: readonly string[],
  options: {
    locale?: string | undefined;
    pagePermissions: boolean;
    /**
     * Whether the caller writes each version of a page itself, its working
     * draft included, as the import does: a type keeping drafts is then
     * asked like any other.
     */
    versions?: boolean;
  }
): Promise<Set<string>> {
  const writable = new Set<string>();
  const caller = ctx.caller;
  if (caller === null) return writable;
  const { kind, slug } = pageTypeOf(type);
  if (!(await mayChangePageSeo(ctx, slug, options.pagePermissions))) {
    return writable;
  }
  // A published page of a type keeping working drafts holds its pending
  // edits in a draft these reads do not see, so its SEO is changed in its
  // own editor, where the draft is, and is read-only here.
  if (options.versions !== true && (await keepsDrafts(ctx, type))) {
    return writable;
  }
  const identity = await caller.identity();
  const language =
    options.locale === undefined ? {} : { locale: options.locale };
  if (kind === "single") {
    const may = await mayWriteEntry(identity, {
      single: slug,
      fields: [SEO_GROUP],
      ...language,
    });
    return may ? new Set(ids) : writable;
  }
  for (const id of new Set(ids)) {
    const may = await mayWriteEntry(identity, {
      collection: type,
      id,
      fields: [SEO_GROUP],
      ...language,
    });
    if (may) writable.add(id);
  }
  return writable;
}

/** How many pages of `type` the caller may read: a Single has one or none. */
async function pagesOfType(
  ctx: PluginRouteContext,
  type: string,
  as: ServiceOpts,
  locale: string | undefined
): Promise<number> {
  const { kind, slug } = pageTypeOf(type);
  if (kind === "collection") {
    return ctx.services.collections.count(slug, {}, as);
  }
  const document = await readSingle(slug, await singleAccessOf(ctx), locale);
  return document === undefined ? 0 : 1;
}

/** A page as the table shows it. */
function rowOf(page: ReadPage, writable: ReadonlySet<string>): BulkRow {
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
    editable: writable.has(page.id),
    ...(page.auto.hiddenByCode === true ? { hiddenByCode: true } : {}),
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
  for (const key of setup.targets) {
    if (!(await caller.can("read", pageTypeOf(key).slug))) continue;
    const pattern = {
      ...rules.defaultPatterns,
      ...rules.patterns[key],
    }.title;
    types.push({
      slug: key,
      ...typeNamesOf(ctx, key),
      total: await pagesOfType(ctx, key, as, locale),
      ...(pattern === undefined ? {} : { titlePattern: pattern }),
      drafts: await keepsDrafts(ctx, key),
    });
  }
  if (types.length === 0) throw NextlyError.forbidden();
  return types;
}

/** What the screen's reads may ask in their query, parsed. */
export interface RouteQuery {
  type?: string | undefined;
  locale?: string | undefined;
  page?: number | undefined;
}

/** What the screen's reads may ask in their query. */
const QUERY: z.ZodType<RouteQuery> = z.object({
  type: z.string().min(1).max(255).optional(),
  locale: z.string().min(1).max(64).optional(),
  page: z.coerce.number().int().min(1).max(100_000).optional(),
});

/** A read's query, parsed, or a refusal naming what is wrong. */
export function queryOf(req: Request): RouteQuery {
  const given = Object.fromEntries(
    [...new URL(req.url).searchParams].filter(([, value]) => value !== "")
  );
  const parsed = QUERY.safeParse(given);
  if (!parsed.success) {
    throw NextlyError.invalidInput({
      message: "The query is not one this route accepts.",
      logContext: {
        reason: "seo-bulk-query-invalid",
        issues: parsed.error.issues.map(issue => issue.path.join(".")),
      },
    });
  }
  return parsed.data;
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

/** A stored value as it compares with one sent: an image by its id. */
function storedForm(value: unknown): string {
  const id = idText(isRecord(value) ? value.id : value);
  return id ?? JSON.stringify(value ?? null);
}

/** Refuse where a value sent into the group is not what was stored. */
export function refuseDroppedValues(
  saved: unknown,
  values: Readonly<Record<string, unknown>>,
  id: string
): void {
  const seo =
    isRecord(saved) && isRecord(saved[SEO_GROUP]) ? saved[SEO_GROUP] : {};
  const dropped = Object.keys(values).filter(
    name => storedForm(seo[name]) !== storedForm(values[name])
  );
  if (dropped.length === 0) return;
  throw NextlyError.forbidden({
    logContext: { reason: "seo-value-not-yours", id, fields: dropped },
  });
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

/**
 * How a write reads the groups it writes over: as stored, as the system, so
 * a value inside the group the person may not read is written back as it
 * was rather than dropped. The person's own rules still judge the write.
 */
function asStored(locale: string | undefined): ServiceOpts {
  return { as: "system", ...(locale === undefined ? {} : { locale }) };
}

/** The pages a write names, read on its transaction, by id. */
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

/**
 * The pages `ids` names, read before a write as `as`: by the caller, for
 * the names a refusal may show them, or as stored (`asStored`), for the
 * groups the write goes over. Read outside the write's transaction, so it
 * holds no lock on the rows the write then takes; each write sends the
 * version its page was read at, which refuses it where the page has changed
 * since.
 */
async function readStored(
  ctx: PluginContext,
  type: string,
  ids: readonly string[],
  as: ServiceOpts
): Promise<Map<string, Record<string, unknown>>> {
  const found = new Map<string, Record<string, unknown>>();
  const pageType = pageTypeOf(type);
  if (pageType.kind === "single") {
    // A Single is read as stored here: its name and its group, for a
    // refusal and a write, are the plugin's to know.
    if (as.as !== "system") {
      throw NextlyError.internal({
        logContext: { reason: "seo-bulk-single-stored-as-user", type },
      });
    }
    const document = await readSingle(
      pageType.slug,
      SINGLE_AS_STORED,
      as.locale
    );
    const id = document === undefined ? undefined : String(document.id);
    if (document !== undefined && id !== undefined && ids.includes(id)) {
      found.set(id, document);
    }
    return found;
  }
  for (let at = 0; at < ids.length; at += 100) {
    const chunk = ids.slice(at, at + 100);
    const { data } = await ctx.services.collections.listEntries(
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

/**
 * Refuse a write that kept the page but not every value sent into its `seo`
 * group, read back as stored on the write's own transaction, where the
 * write's row is already held: a field rule inside the group (a site's own
 * `fields`) leaves out a value the person may not set, and the write would
 * otherwise answer as if it were made. Thrown on the transaction, so
 * nothing of it is kept.
 */
export async function refuseIfNotStored(
  ctx: PluginContext,
  transaction: Parameters<
    PluginContext["services"]["collections"]["updateEntryInTransaction"]
  >[0],
  page: { type: string; id: string; locale: string | undefined },
  values: Readonly<Record<string, unknown>>
): Promise<void> {
  const stored = await storedPages(
    ctx,
    transaction,
    page.type,
    [page.id],
    asStored(page.locale)
  );
  refuseDroppedValues(stored.get(page.id), values, page.id);
}

/** The values a change sets in the `seo` group. */
function valuesOf(
  change: SaveBody["changes"][number]
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  if (change.title !== undefined && change.title !== null) {
    values.metaTitle = change.title;
  }
  if (change.description !== undefined && change.description !== null) {
    values.metaDescription = change.description;
  }
  return values;
}

/**
 * Every page a save names, read as stored, each with the version the
 * change was made from: a page gone, or a change naming no version of a
 * page that keeps one, refuses the save before anything is written.
 */
async function storedForSave(
  ctx: PluginRouteContext,
  type: string,
  body: SaveBody,
  locale: string | undefined
): Promise<Map<string, Record<string, unknown>>> {
  const ids = body.changes.map(change => change.id);
  const stored = await readStored(ctx, type, ids, asStored(locale));
  for (const change of body.changes) {
    const entry = stored.get(change.id);
    if (entry === undefined) {
      throw NextlyError.notFound({
        logContext: { reason: "seo-bulk-page-gone", id: change.id },
      });
    }
    if (typeof entry._rev === "string" && !change.rev) {
      throw NextlyError.invalidInput({
        message:
          "A change names no version of its page, so it can't be told from one made before someone else's. Read the table again.",
        logContext: { reason: "seo-bulk-no-version", id: change.id },
      });
    }
  }
  return stored;
}

/**
 * Write a Single's `seo` group with `values` set over it as `access`, and
 * refuse, with the group put back, where its field rules kept out a value
 * sent. Answers the Single's new version, where it keeps one.
 */
export async function saveSingleSeo(
  access: SingleAccess,
  page: { type: string; id: string; label: string; rev?: string | undefined },
  stored: Record<string, unknown>,
  values: Readonly<Record<string, unknown>>,
  locale: string | undefined
): Promise<string | undefined> {
  const { slug } = pageTypeOf(page.type);
  let rev: string | undefined;
  try {
    rev = await writeSingleSeo(
      slug,
      access,
      locale,
      seoWith(stored[SEO_GROUP], values),
      page.rev
    );
  } catch (error) {
    throw refusalAbout(error, page.label);
  }
  // Read back and judged together, so a failed read puts the group back too.
  try {
    const saved = await readSingle(slug, SINGLE_AS_STORED, locale);
    refuseDroppedValues(saved, values, page.id);
  } catch (error) {
    await restoreSingleSeo(slug, locale, stored[SEO_GROUP], rev);
    throw error;
  }
  return rev;
}

/** Save the one page of a Single, as its own step. */
async function saveSingle(
  ctx: PluginRouteContext,
  setup: BulkSetup,
  body: SaveBody,
  type: string,
  locale: string | undefined
): Promise<BulkSaveBody> {
  const [change, ...others] = body.changes;
  if (change === undefined || others.length > 0) {
    throw NextlyError.invalidInput({
      message: "A Single has one page, so a save of it names one change.",
      logContext: { reason: "seo-bulk-single-changes", type },
    });
  }
  // Asked first, so a Single the caller may not change refuses the save
  // before anything is read or written.
  const writable = await writablePages(ctx, type, [change.id], {
    locale,
    pagePermissions: setup.pagePermissions,
  });
  if (!writable.has(change.id)) {
    throw NextlyError.forbidden({
      logContext: { reason: "seo-bulk-page-not-writable", id: change.id },
    });
  }
  const stored = await storedForSave(ctx, type, body, locale);
  const entry = stored.get(change.id) ?? {};
  const rev = await saveSingleSeo(
    await singleAccessOf(ctx),
    {
      type,
      id: change.id,
      label: pageLabel(ctx, type, entry),
      rev: change.rev ?? undefined,
    },
    entry,
    valuesOf(change),
    locale
  );
  // Saved: the page is checked again for the problem list.
  recheckSaved(ctx, setup.checks, type, change.id);
  return { saved: 1, revs: rev === undefined ? {} : { [change.id]: rev } };
}

/** Save every change in one transaction, or none of them. */
async function save(
  ctx: PluginRouteContext,
  setup: BulkSetup,
  body: SaveBody
): Promise<BulkSaveBody> {
  const type = targetOf(setup, body.type);
  const locale = await defaultLanguageOnly(ctx, body.locale);
  if (pageTypeOf(type).kind === "single") {
    return saveSingle(ctx, setup, body, type, locale);
  }
  const as: ServiceOpts = {
    ...asCaller(ctx),
    ...(locale === undefined ? {} : { locale }),
  };
  const ids = body.changes.map(change => change.id);
  if (new Set(ids).size !== ids.length) {
    throw NextlyError.invalidInput({
      message: "A page is named more than once.",
      logContext: { reason: "seo-bulk-repeated-page" },
    });
  }
  // Every page is asked first, so a page the caller may not change refuses
  // the whole save before anything is written.
  const writable = await writablePages(ctx, type, ids, {
    locale,
    pagePermissions: setup.pagePermissions,
  });
  const refused = ids.find(id => !writable.has(id));
  if (refused !== undefined) {
    throw NextlyError.forbidden({
      logContext: { reason: "seo-bulk-page-not-writable", id: refused },
    });
  }
  // A page's name in a refusal is read as the caller reads it.
  const visible = await readStored(ctx, type, ids, as);
  const label = (id: string) => pageLabel(ctx, type, visible.get(id) ?? { id });
  const stored = await storedForSave(ctx, type, body, locale);
  await ctx.services.collections.warmLocalizedReadiness(type);
  const revs: Record<string, string> = {};
  await ctx.services.collections.withTransaction(async transaction => {
    for (const change of body.changes) {
      const values = valuesOf(change);
      try {
        const saved = await ctx.services.collections.updateEntryInTransaction(
          transaction,
          type,
          change.id,
          {
            [SEO_GROUP]: seoWith(stored.get(change.id)?.[SEO_GROUP], values),
            ...(change.rev ? { _rev: change.rev } : { _overwrite: true }),
          },
          as
        );
        await refuseIfNotStored(
          ctx,
          transaction,
          { type, id: change.id, locale },
          values
        );
        if (typeof saved._rev === "string") revs[change.id] = saved._rev;
      } catch (error) {
        throw refusalAbout(error, label(change.id));
      }
    }
  });
  // Committed: each saved page is checked again for the problem list.
  for (const id of ids) recheckSaved(ctx, setup.checks, type, id);
  return { saved: ids.length, revs };
}

/** The bulk routes, which Pages' Edit mode reads and saves through. */
export function bulkRoutes(setup: BulkSetup): PluginRoute[] {
  return [
    {
      method: "GET",
      path: BULK_TYPES_PATH,
      noStore: true,
      handler: async (req, ctx) => {
        const locale = await defaultLanguageOnly(ctx, queryOf(req).locale);
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
        const query = queryOf(req);
        const type = targetOf(setup, query.type ?? "");
        if (!(await ctx.caller?.can("read", pageTypeOf(type).slug))) {
          throw NextlyError.forbidden();
        }
        const locale = await defaultLanguageOnly(ctx, query.locale);
        const page = query.page ?? 1;
        const read = await readPages(ctx, type, {
          as: asCaller(ctx),
          ...(pageTypeOf(type).kind === "single"
            ? { singleAs: await singleAccessOf(ctx) }
            : {}),
          ...(locale === undefined ? {} : { locale }),
          rules: await setup.readRules(ctx, locale),
          page,
          limit: BULK_PAGE_SIZE,
        });
        const writable = await writablePages(
          ctx,
          type,
          read.pages.map(page => page.id),
          { locale, pagePermissions: setup.pagePermissions }
        );
        const body: BulkRowsBody = {
          type,
          rows: read.pages.map(page => rowOf(page, writable)),
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
