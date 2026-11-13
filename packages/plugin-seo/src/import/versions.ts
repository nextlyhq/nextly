/**
 * Every version of the pages an import reads: each page in each language
 * its type is translated into, as it is published, and its working draft
 * where one waits to be published, or the page itself where it never was.
 * Each version holds values of its own, so each is decided and written on
 * its own, and the import reports one row for each.
 *
 * A version is read as the person importing reads it, through the Direct
 * API, the one read that reaches a page never published and a working
 * draft: once as a visitor in its language is served it (a value missing
 * there falls back to another language), which names it and works out its
 * automatic values, and once as it is stored in that language alone, which
 * holds the values the import compares and the old group it reads. Its
 * `seo` group is read as stored by the site too, so a write goes over every
 * value, including one the person may not read.
 *
 * How a version is written follows from core's lifecycle. A status-less
 * save of a published page of a type keeping drafts is held as its working
 * draft, so a draft is written status-less, and a published version naming
 * its status, which writes the live row. On a transaction (the default language of a collection) that
 * leaves the working draft waiting; anywhere else it would publish it, so
 * there a published version whose draft waits is left to the draft (`LeftOut`).
 *
 * @module import/versions
 */
import {
  getCachedNextly,
  NextlyError,
  type PluginContext,
} from "@nextlyhq/plugin-sdk";

import { keepsDrafts, pagesOf, type ReadPage } from "../bulk/pages";
import { singleDeclaration, type SingleAccess } from "../bulk/singles";
import { isRecord } from "../plain-values";
import { pageTypeOf } from "../problems/page-types";
import { servedOf } from "../redirects/served";
import type { SiteRules } from "../resolver/page-levels";
import { SEO_GROUP } from "../tab/typed";

import type { ImportActor } from "./actor";
import type { VersionForm } from "./contract";

/**
 * How a version's write reaches it: an edit of the row as it is, a write
 * of the live row naming its published state (so it is not held as a
 * draft), or a save held as the working draft it goes into.
 */
export type VersionWrite = "inPlace" | "live" | "held";

/** One version of a page, as the import reads, decides and writes it. */
export interface ReadVersion extends ReadPage {
  /** The version's own key: its page, its language and its form. */
  key: string;
  /** The language it is in, where its type is translated. */
  locale?: string;
  /** That language's name. */
  language?: string;
  form: VersionForm;
  write: VersionWrite;
  /** The version as stored in its own language, nothing filled from another. */
  own: Record<string, unknown>;
  /** Its `seo` group as stored, read as the site: what a write goes over. */
  stored: Record<string, unknown>;
  /** Whether it is written on the import's one transaction. */
  inTransaction: boolean;
  /**
   * The address it is served at in its language: its path, with the
   * language's prefix, or on the language's own domain in full.
   */
  served?: string;
  /** Why the import leaves it as it is, where it must (`LeftOut`). */
  leftOut?: LeftOut;
}

/**
 * Why a version is left as it is, whatever the source holds for it:
 *
 * - `withDraft`: a published version whose working draft waits, outside the
 *   transaction, where writing it would publish the draft. The draft is
 *   written, and takes the values live when it is published.
 * - `untilDraftDone`: the same, where the draft can't take the values either.
 * - `draftInLanguage`: a working draft in a language other than the default,
 *   which a save outside the transaction does not keep a group in.
 */
export type LeftOut = "withDraft" | "untilDraftDone" | "draftInLanguage";

/** The Direct API reads a version takes, named structurally. */
interface VersionReads {
  find(args: Record<string, unknown>): Promise<{ items: unknown[] }>;
  findByID(args: Record<string, unknown>): Promise<unknown>;
  findSingle(args: Record<string, unknown>): Promise<unknown>;
}

/** The site itself, reading what is stored. */
const AS_STORED: SingleAccess = { overrideAccess: true };

/** How many pages one read takes. */
const READ_AT_ONCE = 200;

/** A version's key: its page, language and form. */
function versionKey(
  type: string,
  id: string,
  locale: string | undefined,
  form: VersionForm
): string {
  return `${type}|${id}|${locale ?? ""}|${form}`;
}

/** A page's key, whatever its version. */
export function pageKey(page: { type: string; id: string }): string {
  return `${page.type}|${page.id}`;
}

/** The site's languages as they are now, its default first. */
interface SiteLanguages {
  codes: readonly string[];
  /** The default one. */
  first: string;
}

/**
 * A language's name: as the site's configuration labels it, else in the
 * language itself ("Deutsch"), else its code.
 */
function languageName(ctx: PluginContext, code: string): string {
  const labelled = ctx.config.localization?.locales.find(
    locale => locale.code === code
  )?.label;
  if (labelled !== undefined && labelled !== code) return labelled;
  try {
    return new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Whether the type `key` keeps its values per language. */
async function translated(ctx: PluginContext, key: string): Promise<boolean> {
  const type = pageTypeOf(key);
  if (type.kind === "single") {
    if (singleDeclaration(ctx, type.slug)?.localized === true) return true;
    const { data } = await ctx.services.singles.list({ limit: 500 });
    const listed: unknown = data.find(single => single.slug === type.slug);
    return isRecord(listed) && listed.localized === true;
  }
  const record: unknown = await ctx.services.collections.getCollection(
    type.slug,
    {}
  );
  return isRecord(record) && record.localized === true;
}

/**
 * The languages a type's pages are read in: every one the site has, the
 * default first, where the type is translated; else none named, which is
 * the default.
 */
function languagesOf(
  ctx: PluginContext,
  site: SiteLanguages,
  translatedType: boolean
): { code?: string; label?: string }[] {
  if (site.codes.length < 2 || !translatedType) return [{}];
  return site.codes.map(code => ({ code, label: languageName(ctx, code) }));
}

/** The language options of a read: served with fallbacks, or as stored. */
function language(
  locale: string | undefined,
  served: boolean
): Record<string, unknown> {
  return {
    ...(locale === undefined ? {} : { locale }),
    ...(served ? {} : { fallbackLocale: false }),
  };
}

/** A Single's document as `access` reads it, or none where it has none they may read. */
async function singleRead(
  api: VersionReads,
  slug: string,
  access: SingleAccess,
  options: Record<string, unknown>
): Promise<Record<string, unknown> | undefined> {
  try {
    const document = await api.findSingle({
      slug,
      ...access,
      status: "all",
      createIfMissing: false,
      depth: 0,
      ...options,
    });
    return isRecord(document) ? document : undefined;
  } catch (error) {
    if (
      NextlyError.isCode(error, "NOT_FOUND") ||
      NextlyError.isCode(error, "FORBIDDEN")
    ) {
      return undefined;
    }
    throw error;
  }
}

/** Every document of the type `key` as `access` reads it, in every state. */
async function documentsOf(
  api: VersionReads,
  key: string,
  access: SingleAccess,
  options: Record<string, unknown>
): Promise<Record<string, unknown>[]> {
  const type = pageTypeOf(key);
  if (type.kind === "single") {
    const document = await singleRead(api, type.slug, access, options);
    return document === undefined ? [] : [document];
  }
  const documents: Record<string, unknown>[] = [];
  for (let page = 1; ; page++) {
    const { items } = await api.find({
      collection: type.slug,
      ...access,
      status: "all",
      depth: 0,
      sort: "-createdAt",
      limit: READ_AT_ONCE,
      page,
      ...options,
    });
    documents.push(...items.filter(isRecord));
    if (items.length < READ_AT_ONCE) return documents;
  }
}

/** A document's working draft as `access` reads it, where one waits. */
async function draftOf(
  api: VersionReads,
  key: string,
  id: string,
  access: SingleAccess,
  options: Record<string, unknown>
): Promise<Record<string, unknown> | undefined> {
  const type = pageTypeOf(key);
  const document =
    type.kind === "single"
      ? await singleRead(api, type.slug, access, { ...options, draft: true })
      : await api.findByID({
          collection: type.slug,
          id,
          ...access,
          status: "all",
          draft: true,
          depth: 0,
          disableErrors: true,
          ...options,
        });
  return isRecord(document) && document._isWorkingDraft === true
    ? document
    : undefined;
}

/** The ids of a collection's pages whose working draft waits in `locale`. */
async function pendingIds(
  api: VersionReads,
  key: string,
  locale: string | undefined
): Promise<Set<string>> {
  const type = pageTypeOf(key);
  // A Single's one page is asked for its draft itself.
  if (type.kind === "single") return new Set();
  const ids = new Set<string>();
  for (let page = 1; ; page++) {
    const { items } = await api.find({
      collection: type.slug,
      ...AS_STORED,
      where: { _pendingChange: true },
      status: "all",
      depth: 0,
      select: { id: true },
      limit: READ_AT_ONCE,
      page,
      ...language(locale, false),
    });
    for (const item of items) {
      if (isRecord(item)) ids.add(String(item.id));
    }
    if (items.length < READ_AT_ONCE) return ids;
  }
}

/** A document's `seo` group, or an empty one. */
function groupOf(document: Record<string, unknown> | undefined) {
  const seo = document?.[SEO_GROUP];
  return isRecord(seo) ? { ...seo } : {};
}

/** Documents by id. */
function byId(
  documents: readonly Record<string, unknown>[]
): Map<string, Record<string, unknown>> {
  return new Map(documents.map(document => [String(document.id), document]));
}

/** What reading a type's versions in one language needs. */
interface LanguageRead {
  ctx: PluginContext;
  api: VersionReads;
  actor: ImportActor;
  /** The site's rules in the language read. */
  rules: SiteRules;
  key: string;
  locale: { code?: string; label?: string };
  /** The site's default language. */
  first: string;
  /** Whether the type keeps its values per language, however many it has. */
  translated: boolean;
  keeps: boolean;
  inTransaction: boolean;
}

/** The pages `documents` are, read as served in the language read, by id. */
async function pagesBy(
  read: LanguageRead,
  documents: readonly Record<string, unknown>[]
): Promise<Map<string, ReadPage>> {
  const { ctx, actor, rules, key, locale } = read;
  const pages = await pagesOf(ctx, key, documents, {
    as: actor.as,
    singleAs: actor.single,
    ...(locale.code === undefined ? {} : { locale: locale.code }),
    rules,
  });
  return new Map(pages.map(page => [page.id, page]));
}

/**
 * One version made of `page`, as read as served, with its own values
 * (`own`) and its group as stored (`stored`).
 */
function versionOf(
  read: LanguageRead,
  page: ReadPage,
  own: Record<string, unknown>,
  stored: Record<string, unknown> | undefined,
  form: VersionForm,
  write: VersionWrite
): ReadVersion {
  const { key, locale } = read;
  return {
    ...page,
    // Named and worked out as served; its values are its own.
    document: own,
    seo: groupOf(own),
    key: versionKey(key, page.id, locale.code, form),
    ...(locale.code === undefined ? {} : { locale: locale.code }),
    ...(locale.label === undefined ? {} : { language: locale.label }),
    form,
    write,
    own,
    stored: groupOf(stored),
    inTransaction: read.inTransaction,
  };
}

/** Whether `locale` is read with nothing to fill in from another language. */
function readsAsStored(read: LanguageRead): boolean {
  // The default language can fall back to another too, so only a read
  // naming no language at all is its own values.
  return read.locale.code === undefined;
}

/** A working draft waiting beside a page: as served, its own, and as stored. */
interface WaitingDraft {
  shown: Record<string, unknown>;
  own: Record<string, unknown>;
  stored: Record<string, unknown> | undefined;
}

/** The working draft waiting beside page `id` in the language read, or none. */
async function waitingDraft(
  read: LanguageRead,
  id: string
): Promise<WaitingDraft | undefined> {
  const { api, actor, key, locale } = read;
  const shown = await draftOf(
    api,
    key,
    id,
    actor.single,
    language(locale.code, true)
  );
  if (shown === undefined) return undefined;
  const asStored = language(locale.code, false);
  const own = readsAsStored(read)
    ? shown
    : ((await draftOf(api, key, id, actor.single, asStored)) ?? shown);
  return {
    shown,
    own,
    stored: await draftOf(api, key, id, AS_STORED, asStored),
  };
}

/**
 * Whether a page as served is published, and whether it is one a working
 * draft can wait beside: a published page of a type keeping drafts, whose
 * live row is written naming its state, or the write would be held.
 */
function lifecycleOf(
  read: LanguageRead,
  shown: Record<string, unknown>
): { published: boolean; splits: boolean } {
  // A type with no lifecycle has no status: its one version is what is served.
  const lifecycle = typeof shown.status === "string";
  const published = !lifecycle || shown.status === "published";
  return { published, splits: read.keeps && lifecycle && published };
}

/**
 * The working drafts waiting beside the pages `shown`, by id: asked of each
 * page a draft can wait beside that the pending-change read names (a
 * Single's one page is asked itself).
 */
async function draftsOf(
  read: LanguageRead,
  shown: readonly Record<string, unknown>[]
): Promise<Map<string, WaitingDraft>> {
  const drafts = new Map<string, WaitingDraft>();
  if (!read.keeps) return drafts;
  const single = pageTypeOf(read.key).kind === "single";
  const pending = single
    ? undefined
    : await pendingIds(read.api, read.key, read.locale.code);
  for (const document of shown) {
    const id = String(document.id);
    const asked = pending === undefined || pending.has(id);
    if (!asked || !lifecycleOf(read, document).splits) continue;
    const draft = await waitingDraft(read, id);
    if (draft !== undefined) drafts.set(id, draft);
  }
  return drafts;
}

/** What one language's read of a type holds, page by page. */
interface LanguagePages {
  shown: readonly Record<string, unknown>[];
  own: ReadonlyMap<string, Record<string, unknown>>;
  stored: ReadonlyMap<string, Record<string, unknown>>;
  live: ReadonlyMap<string, ReadPage>;
  drafts: ReadonlyMap<string, WaitingDraft>;
  held: ReadonlyMap<string, ReadPage>;
}

/** A page's versions in the language read: as published, and its waiting draft. */
function versionsOfPage(
  read: LanguageRead,
  pages: LanguagePages,
  document: Record<string, unknown>
): ReadVersion[] {
  const id = String(document.id);
  const page = pages.live.get(id);
  if (page === undefined) return [];
  const { published, splits } = lifecycleOf(read, document);
  const version = versionOf(
    read,
    page,
    pages.own.get(id) ?? document,
    pages.stored.get(id),
    published ? "published" : "draft",
    splits ? "live" : "inPlace"
  );
  const draft = pages.drafts.get(id);
  const draftPage = pages.held.get(id);
  if (draft === undefined || draftPage === undefined) return [version];
  const held = versionOf(
    read,
    draftPage,
    draft.own,
    draft.stored,
    "draft",
    "held"
  );
  return beside(read, version, held);
}

/**
 * A published version and the working draft beside it, each with how it is
 * written: on the transaction or as a step, or left as it is.
 */
function beside(
  read: LanguageRead,
  version: ReadVersion,
  held: ReadVersion
): ReadVersion[] {
  // A held save is a step of its own, read back as stored, since what a save
  // on the transaction answers is the person's read of it; but a translated
  // type's draft keeps a group only from a save on the transaction, so its
  // draft in the default language is written there.
  if (read.inTransaction) {
    return [
      version,
      read.translated ? held : { ...held, inTransaction: false },
    ];
  }
  // A collection's draft in another language does not keep a group a save
  // outside the transaction sends; a Single's draft does.
  if (pageTypeOf(read.key).kind === "collection") {
    return [
      { ...version, leftOut: "untilDraftDone" },
      { ...held, leftOut: "draftInLanguage" },
    ];
  }
  return [{ ...version, leftOut: "withDraft" }, held];
}

/** Every version of the type `key`'s pages in one language. */
async function versionsInLanguage(read: LanguageRead): Promise<ReadVersion[]> {
  const { api, actor, key, locale } = read;
  const asStored = language(locale.code, false);
  const shown = await documentsOf(
    api,
    key,
    actor.single,
    language(locale.code, true)
  );
  const own = readsAsStored(read)
    ? shown
    : await documentsOf(api, key, actor.single, asStored);
  const drafts = await draftsOf(read, shown);
  const pages: LanguagePages = {
    shown,
    own: byId(own),
    stored: byId(await documentsOf(api, key, AS_STORED, asStored)),
    drafts,
    // Each read named and worked out once for every page of it.
    live: await pagesBy(read, shown),
    held: await pagesBy(
      read,
      [...drafts.values()].map(draft => draft.shown)
    ),
  };
  const versions = shown.flatMap(document =>
    versionsOfPage(read, pages, document)
  );
  return Promise.all(versions.map(version => withServed(version)));
}

/** A version with the address it is served at in its language. */
async function withServed(version: ReadVersion): Promise<ReadVersion> {
  if (version.path === undefined) return version;
  const served =
    version.locale === undefined
      ? version.path
      : await servedOf(version.path, version.locale);
  return { ...version, served };
}

/**
 * Every version of every page of `types`, read as the actor: each language
 * a type is translated into, and each form a page is in there.
 */
export async function everyVersion(
  ctx: PluginContext,
  actor: ImportActor,
  types: readonly string[],
  rulesIn: (locale: string | undefined) => Promise<SiteRules>
): Promise<ReadVersion[]> {
  const api = (await getCachedNextly()) as unknown as VersionReads;
  // The languages as they are now, a list set in Settings included.
  const codes = await ctx.publicAddresses.languages();
  const site: SiteLanguages = {
    codes,
    first: codes[0] ?? (await ctx.publicAddresses.defaultLanguage()),
  };
  const versions: ReadVersion[] = [];
  for (const key of types) {
    const keeps = await keepsDrafts(ctx, key);
    const isTranslated = await translated(ctx, key);
    const collection = pageTypeOf(key).kind === "collection";
    for (const locale of languagesOf(ctx, site, isTranslated)) {
      versions.push(
        ...(await versionsInLanguage({
          ctx,
          api,
          actor,
          rules: await rulesIn(locale.code),
          key,
          locale,
          first: site.first,
          translated: isTranslated,
          keeps,
          // A collection's default language is written on the transaction;
          // another language, and a Single, only as a step of its own.
          inTransaction:
            collection &&
            (locale.code === undefined || locale.code === site.first),
        }))
      );
    }
  }
  return versions;
}
