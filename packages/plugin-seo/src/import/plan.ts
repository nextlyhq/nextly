/**
 * An import worked out and, once confirmed, applied.
 *
 * Working it out reads every version of each page (`import/versions`): each
 * language its type is translated into, what is published there and the
 * working draft waiting beside it. It matches each of the source's records
 * to versions here, and decides each version's new `seo` values on its own,
 * changing nothing: that is the dry run. A value is written only into an
 * empty place: a value a person already typed here, in that version, is
 * kept, and one the same as what the version would show automatically is
 * left automatic, so a later change to a pattern still reaches it. The
 * plugin's own group, as an earlier version of the plugin stored it, is the
 * one case that rewrites typed values, and only those the same as the
 * automatic one, which become automatic.
 *
 * Applying works the import out again and refuses unless it is exactly the
 * one the dry run showed (`plan`, a digest of every change and each
 * version's revision), then writes every version of a collection's page in
 * the default language, and adds every redirect, in one transaction: in
 * full, or, where anything is refused part-way, not at all. A Single's page,
 * a page in another language, and the working draft of a type that is not
 * translated are each written first, as a step of its own, read back as
 * stored, and put back as it was where any later step is refused.
 *
 * The engine holds no request and draws nothing: `planImport(engine, args)`
 * and `applyImport(plan)` take the site's context and who the import is made
 * as (`import/actor`), so the admin's import panel and a command run on the
 * server take the same path. A plan reports, for each page and each record
 * passed over, what it would set, what is the same as automatic, what a
 * person already typed and keeps, and why a record is skipped. Run again
 * after an apply, it sets nothing: every place it filled is filled.
 *
 * @module import/plan
 */
import { createHash } from "node:crypto";

import {
  getCachedNextly,
  NextlyError,
  type ParticipantTransaction,
  type PluginContext,
} from "@nextlyhq/plugin-sdk";

import { readEveryPage, typeNamesOf, type ReadPage } from "../bulk/pages";
import {
  refusalAbout,
  refuseDroppedValues,
  refuseIfNotStored,
  seoWith,
} from "../bulk/route";
import {
  SINGLE_AS_STORED,
  singleDeclaration,
  writeSingleSeo,
  type SingleAccess,
} from "../bulk/singles";
import { productionAddressesOf, typedCanonical } from "../canonical";
import { writeConnections } from "../connections/store";
import { isRecord } from "../plain-values";
import { recheckSaved, type ProblemChecks } from "../problems/check";
import { pageTypeOf } from "../problems/page-types";
import { keptFrom, originBeside } from "../redirects/served";
import { putRedirect } from "../redirects/store";
import { resolveOrder } from "../resolver/order";
import type { SiteRules } from "../resolver/page-levels";
import type { ReadRules } from "../resolver/provider";
import { SEPARATORS } from "../settings/patterns";
import { SEO_GROUP, typedPageLevel } from "../tab/typed";

import type { ImportActor } from "./actor";
import {
  IMPORT_PARTLY_APPLIED,
  type TypeWithOwnSeo,
  type DryRunBody,
  type ImportGroup,
  type ImportReportEntry,
  type ImportSource,
  type ImportTarget,
  type VersionForm,
} from "./contract";
import { declaresOtherGroups, groupsOf, OWN_FIELDS, readGroup } from "./group";
import { readFile } from "./read-file";
import {
  count,
  fillTemplate,
  idText,
  ImportFileRefused,
  originOfAddress,
  pathOfAddress,
  textValue,
  type ImageRef,
  type ImportedRecord,
  type ParsedSource,
  type TemplateValues,
} from "./records";
import {
  everyVersion,
  pageKey,
  type LeftOut,
  type ReadVersion,
  type VersionWrite,
} from "./versions";

type Transaction = ParticipantTransaction["transaction"];

/** What the import needs from the plugin. */
export interface ImportSetup {
  /**
   * The content types the plugin adds SEO to, by key: each collection's
   * slug, and `single:<slug>` for each Single.
   */
  targets: readonly string[];
  readRules: ReadRules;
  /** The problem list's checks, run again for each changed page. */
  checks: ProblemChecks;
  /** Whether changing a type's SEO takes a permission of its own. */
  pagePermissions: boolean;
}

/** Where each place's value is kept in the plugin's `seo` group. */
const STORED: Readonly<
  Record<Exclude<ImportTarget, "shown" | "skip">, string>
> = {
  title: "metaTitle",
  description: "metaDescription",
  image: "ogImage",
  socialTitle: "socialTitle",
  socialDescription: "socialDescription",
  canonical: "canonical",
  hidden: "noindex",
};

/** Where the group keeps that a page first appeared on another site. */
const CANONICAL_ELSEWHERE = "canonicalElsewhere";

/** The text places, in the order a page's values are decided. */
const TEXT_PLACES = [
  "title",
  "description",
  "socialTitle",
  "socialDescription",
  "canonical",
] as const;

/** One version of a page, and its change. */
export interface PlannedPage {
  type: string;
  id: string;
  label: string;
  rev?: string;
  /** The version's own key: its page, its language and its form. */
  key: string;
  /** The language it is in, where its type is translated. */
  locale?: string;
  /** That language's name. */
  language?: string;
  form: VersionForm;
  /** How its write reaches it (`import/versions`). */
  write: VersionWrite;
  /** Whether it is written on the import's one transaction. */
  inTransaction: boolean;
  /** Why the import leaves it as it is, where it must (`import/versions`). */
  leftOut?: LeftOut;
  /** The values written into its `seo` group. */
  writes: Record<string, unknown>;
  /** Its `seo` group as stored, read as the site, which the writes go over. */
  seo: Record<string, unknown>;
  /** The places it changes. */
  places: ImportTarget[];
  /** The places whose value is the same as the page's automatic one. */
  same: ImportTarget[];
  /** The places a person already filled, which keep their value. */
  kept: ImportTarget[];
  /**
   * The places whose value never reached the page, since its route's code
   * sets that value itself: left out unless the import includes them.
   */
  neverServed: ImportTarget[];
  /** The title and description the source holds for the page, as imported. */
  values: ReportedValues;
}

/** The title and description a source holds for a page, as imported. */
type ReportedValues = Partial<Record<"title" | "description", string>>;

/** One redirect the import adds. */
export interface PlannedRedirect {
  /** The language it is kept in. */
  locale: string;
  /** Its addresses as kept: without the language's own prefix or domain. */
  source: string;
  target: string;
  permanent: boolean;
}

/** A redirect a record asks for, before it is placed in a language. */
type AskedRedirect = Omit<PlannedRedirect, "locale"> & {
  /** The From address in full, as the source wrote it, where it did. */
  address?: string;
};

/** What an import runs with: the site, who it is made as, and the plugin's setup. */
export interface ImportEngine {
  ctx: PluginContext;
  actor: ImportActor;
  setup: ImportSetup;
}

/** What an import is asked for. */
export interface PlanImportArgs {
  /** Where the values come from: a field group by name, or an export file. */
  source: ImportSource;
  /**
   * The content types to import into, by key (a collection's slug, or
   * `single:<slug>`); every type SEO is added to that the actor may read
   * where none are named.
   */
  types?: readonly string[];
  /**
   * Where each of a field group's fields goes. Where none is given, the
   * source's own `map`, else where each field's name says it goes.
   */
  mapping?: Readonly<Record<string, ImportTarget>>;
  /**
   * The language a file is read in, and redirects are kept in where their
   * address names none: the site's default one. The values themselves go
   * into every language each page is translated into (`import/versions`).
   */
  locale?: string;
  /**
   * Whether values a page's own code overrides, which never reached it, are
   * imported anyway. Left out by default: importing one would change what
   * the page shows.
   */
  includeNeverServed?: boolean;
}

/** An import worked out, ready for `applyImport`. */
export interface ImportPlan {
  /** What a dry run shows, its per-page report and its digest included. */
  body: DryRunBody;
  /** The versions it changes, each with its writes. */
  pages: PlannedPage[];
  redirects: PlannedRedirect[];
  /** The default language: a file is read in it, and redirects kept in it. */
  locale: string;
  /** What it was worked out with, which its apply writes with. */
  engine: ImportEngine;
  /** What it was asked for. */
  args: PlanImportArgs;
}

/**
 * The types the import reads: those named, each one SEO is added to, or
 * every one; of those, the ones the actor may read.
 */
async function readableTypes(
  engine: ImportEngine,
  named: readonly string[] | undefined
): Promise<string[]> {
  const { targets } = engine.setup;
  const unknown = (named ?? []).filter(key => !targets.includes(key));
  if (unknown.length > 0) {
    throw NextlyError.invalidInput({
      message: `SEO is not added to ${unknown.join(", ")}.`,
      logContext: { reason: "seo-import-not-a-target", types: unknown },
    });
  }
  const readable: string[] = [];
  for (const key of named ?? targets) {
    if (await engine.actor.mayRead(key)) readable.push(key);
  }
  return readable;
}

/** How many collections one listing reads while finding types with their own `seo`. */
const LISTED_AT_ONCE = 100;

/**
 * The site's own types, other than those SEO is added to, that hold a field
 * of their own named `seo`: the plugin's group can't join one until that
 * field has another name, after which its values are imported from it. A
 * type SEO is added to can't hold one, since the two would clash. Only
 * types the actor may read are named, so none is revealed to someone who
 * can't see it.
 */
export async function typesWithOwnSeo(
  engine: ImportEngine
): Promise<TypeWithOwnSeo[]> {
  const { ctx, actor, setup } = engine;
  const found: TypeWithOwnSeo[] = [];
  for (let page = 1; ; page += 1) {
    const listed = await ctx.services.collections.listCollections(
      { page, limit: LISTED_AT_ONCE, sortBy: "slug", sortOrder: "asc" },
      {}
    );
    for (const row of listed.data) {
      const type = ownSeoOf(row);
      if (type === undefined || setup.targets.includes(type.slug)) continue;
      if (await actor.mayRead(type.slug)) found.push(type);
    }
    if (!listed.pagination.hasMore) return found;
  }
}

/** A listed collection of the site's own holding a field named `seo`, or none. */
function ownSeoOf(row: unknown): TypeWithOwnSeo | undefined {
  if (!isRecord(row) || (row.source !== "code" && row.source !== "ui")) {
    return undefined;
  }
  const slug = textValue(row.slug);
  const fields = Array.isArray(row.fields) ? row.fields : [];
  const holds = fields.some(
    field => isRecord(field) && field.name === SEO_GROUP
  );
  if (slug === undefined || !holds) return undefined;
  const labels = isRecord(row.labels) ? row.labels : {};
  return {
    slug,
    label: textValue(labels.plural) ?? slug,
    definedIn: row.source === "code" ? "code" : "admin",
  };
}

/** Every page of `types`, read as the actor in `locale`. */
async function everyPage(
  engine: ImportEngine,
  types: readonly string[],
  locale: string | undefined,
  rules: SiteRules
): Promise<ReadPage[]> {
  const pages: ReadPage[] = [];
  for (const key of types) {
    pages.push(
      ...(await readEveryPage(engine.ctx, key, {
        as: engine.actor.as,
        singleAs: engine.actor.single,
        ...(locale === undefined ? {} : { locale }),
        rules,
      }))
    );
  }
  return pages;
}

/**
 * A Single's fields: as code declares them, which name the component each
 * component field holds; else as the Singles registry lists them, which
 * keeps each field's name and type only.
 */
async function singleFields(
  ctx: PluginContext,
  slug: string
): Promise<unknown> {
  const declared = singleDeclaration(ctx, slug)?.fields;
  if (Array.isArray(declared)) return declared;
  const { data } = await ctx.services.singles.list({ limit: 500 });
  return data.find(single => single.slug === slug)?.fields;
}

/**
 * Each type's declared fields: a collection's registered schema, and a
 * Single's (`singleFields`).
 */
async function typeFields(
  ctx: PluginContext,
  types: readonly string[]
): Promise<{ slug: string; label: string; fields: unknown }[]> {
  const answer: { slug: string; label: string; fields: unknown }[] = [];
  for (const key of types) {
    const type = pageTypeOf(key);
    const fields =
      type.kind === "single"
        ? await singleFields(ctx, type.slug)
        : (await ctx.services.collections.getCollection(type.slug, {}))
            .schemaDefinition.fields;
    answer.push({
      slug: key,
      label: typeNamesOf(ctx, key).label,
      fields: fields ?? [],
    });
  }
  return answer;
}

/**
 * Whether the types the actor may read declare a field group other than the
 * plugin's own, read from their declarations without reading any page: where
 * none does, there are no old values to import.
 */
export async function declaresOldGroups(
  engine: ImportEngine
): Promise<boolean> {
  const types = await readableTypes(engine, undefined);
  return declaresOtherGroups(engine.ctx, await typeFields(engine.ctx, types));
}

/**
 * The field groups the types the actor may read hold, each field with how
 * many pages fill it and where it is suggested to go.
 */
export async function importGroups(
  engine: ImportEngine,
  locale: string | undefined
): Promise<ImportGroup[]> {
  const { ctx } = engine;
  const types = await readableTypes(engine, undefined);
  const rules = await engine.setup.readRules(ctx, locale);
  const pages = await everyPage(engine, types, locale, rules);
  return groupsOf(ctx, await typeFields(ctx, types), pages);
}

/** The separator the site's titles use, from its default title pattern. */
function separatorOf(rules: SiteRules): string {
  const pattern = rules.defaultPatterns?.title ?? "";
  return SEPARATORS.find(each => pattern.includes(` ${each} `)) ?? "|";
}

/** The source's records, read with `mapping` for a field group. */
function parsedSource(
  source: ImportSource,
  mapping: Readonly<Record<string, ImportTarget>>,
  pages: readonly ReadPage[],
  language: string
): ParsedSource {
  switch (source.kind) {
    case "group":
      return readGroup(
        pages,
        source.field,
        source.field === SEO_GROUP ? OWN_FIELDS : mapping
      );
    case "records":
      return source.parsed;
    default:
      return refusedAsInput(() => readFile(source.kind, source.text, language));
  }
}

/** `read`'s answer, a file it refuses answered as invalid input. */
function refusedAsInput(read: () => ParsedSource): ParsedSource {
  try {
    return read();
  } catch (error) {
    if (!(error instanceof ImportFileRefused)) throw error;
    throw NextlyError.invalidInput({
      message: error.message,
      logContext: { reason: error.reason },
    });
  }
}

/** What a record was matched to: a page's versions, more than one page, or none. */
type Found = ReadVersion[] | "ambiguous" | undefined;

/** A page in one language: every form of it there is one place for a record. */
const placeOf = (version: ReadVersion) =>
  `${version.type}|${version.id}|${version.locale ?? ""}`;

/**
 * The address a version is served at, as a file's address is read: decoded
 * and without a trailing slash, in its own language, with the origin it is
 * served on where its language has a domain of its own.
 */
function servedAddress(
  version: ReadVersion
): { origin?: string; path: string } | undefined {
  const served = version.served ?? version.path;
  if (served === undefined) return undefined;
  const path = pathOfAddress(served);
  if (path === undefined) return undefined;
  const origin = originOfAddress(served);
  return origin === undefined ? { path } : { origin, path };
}

/** Adds `place` to the places found at `at`. */
function add(map: Map<string, Set<string>>, at: string, place: string): void {
  map.set(at, new Set([...(map.get(at) ?? []), place]));
}

/** Where each version can be found: by key, place, address, path and slug. */
interface VersionIndex {
  byKey: Map<string, ReadVersion>;
  places: Map<string, ReadVersion[]>;
  byAddress: Map<string, Set<string>>;
  byPath: Map<string, Set<string>>;
  bySlug: Map<string, Set<string>>;
  /** The origins languages are served on, each a language's own domain. */
  origins: Set<string>;
  /** The paths of pages of a type that isn't translated, served on every origin. */
  byUnlocalizedPath: Map<string, Set<string>>;
}

/**
 * Each version indexed where a record can name it. An address on a
 * language's own domain is found by its origin and path. By its path alone,
 * as an address on another site (the old one) or with no origin is read,
 * only the default language is found where the languages have domains,
 * since every language serves the same path there; by slug, the default
 * language alone.
 */
function indexOf(
  versions: readonly ReadVersion[],
  defaultLocale: string | undefined
): VersionIndex {
  const index: VersionIndex = {
    byKey: new Map(),
    places: new Map(),
    byAddress: new Map(),
    byPath: new Map(),
    bySlug: new Map(),
    origins: new Set(),
    byUnlocalizedPath: new Map(),
  };
  for (const version of versions) {
    index.byKey.set(version.key, version);
    const place = placeOf(version);
    index.places.set(place, [...(index.places.get(place) ?? []), version]);
    const inDefault =
      version.locale === undefined || version.locale === defaultLocale;
    indexAddress(index, version, place, inDefault);
    if (version.slug !== undefined && inDefault) {
      add(index.bySlug, version.slug, place);
    }
  }
  return index;
}

/** Indexes the address `version` is served at, as `indexOf` says. */
function indexAddress(
  index: VersionIndex,
  version: ReadVersion,
  place: string,
  inDefault: boolean
): void {
  const served = servedAddress(version);
  if (served === undefined) return;
  if (version.locale === undefined) {
    add(index.byUnlocalizedPath, served.path, place);
  }
  if (served.origin !== undefined) {
    index.origins.add(served.origin);
    add(index.byAddress, `${served.origin}${served.path}`, place);
  }
  if (served.origin === undefined || inDefault) {
    add(index.byPath, served.path, place);
  }
}

/** The versions of the one place `found` names, or why there are none. */
function onePlace(index: VersionIndex, found: ReadonlySet<string>): Found {
  if (found.size === 0) return undefined;
  if (found.size > 1) return "ambiguous";
  const [only] = found;
  return only === undefined ? undefined : index.places.get(only);
}

/** The versions a record read from a page names: that version, or its default language. */
function pageVersions(
  index: VersionIndex,
  page: NonNullable<ImportedRecord["match"]["page"]>,
  defaultLocale: string | undefined
): Found {
  if (page.version !== undefined) {
    const found = index.byKey.get(page.version);
    return found === undefined ? undefined : [found];
  }
  const list = [...index.byKey.values()].filter(
    each =>
      each.type === page.type &&
      each.id === page.id &&
      (each.locale === undefined || each.locale === defaultLocale)
  );
  return list.length === 0 ? undefined : list;
}

/**
 * The versions each record could be: the one version a field group was read
 * from, or every form of the page in the language its address is served in,
 * or, by slug, in the default language.
 */
export function matcher(
  versions: readonly ReadVersion[],
  defaultLocale: string | undefined
): (record: ImportedRecord) => Found {
  const index = indexOf(versions, defaultLocale);
  return ({ match }) => {
    if (match.page !== undefined) {
      return pageVersions(index, match.page, defaultLocale);
    }
    const atAddress =
      match.path === undefined || match.origin === undefined
        ? undefined
        : index.byAddress.get(`${match.origin}${match.path}`);
    if (atAddress !== undefined) return onePlace(index, atAddress);
    // An address on a language's own domain names that language alone: one
    // no page holds there matches nothing, rather than another language.
    // A page of a type that isn't translated is the same on every one.
    if (match.origin !== undefined && index.origins.has(match.origin)) {
      const shared =
        match.path === undefined
          ? undefined
          : index.byUnlocalizedPath.get(match.path);
      return shared === undefined ? undefined : onePlace(index, shared);
    }
    const atPath =
      match.path === undefined ? undefined : index.byPath.get(match.path);
    if (atPath !== undefined) return onePlace(index, atPath);
    const atSlug =
      match.slug === undefined ? undefined : index.bySlug.get(match.slug);
    return atSlug === undefined ? undefined : onePlace(index, atSlug);
  };
}

/** The file name an address ends in, decoded, or none. */
function fileNameOf(url: string): string | undefined {
  try {
    const path = new URL(url, "https://example.invalid").pathname;
    const name = decodeURIComponent(path.slice(path.lastIndexOf("/") + 1));
    return name === "" ? undefined : name;
  } catch {
    return undefined;
  }
}

/**
 * The media library's id for each image address: the file of the same
 * name, looked up once an address.
 */
/** How many media items one page of a search reads. */
const MEDIA_PAGE = 100;

/** Whether a media item is the file named `name`. */
function isFile(file: unknown, name: string): boolean {
  return (
    isRecord(file) &&
    (file.filename === name ||
      file.originalFilename === name ||
      (typeof file.url === "string" && file.url.endsWith(`/${name}`)))
  );
}

/**
 * The media library's id for the file named `name`: its search for the
 * name's stem, read page by page until the file is found or every match has
 * been read, since the search also matches other text and newer files first.
 */
export async function mediaIdOf(
  ctx: PluginContext,
  name: string
): Promise<string | undefined> {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  for (let page = 1; ; page++) {
    const { data } = await ctx.services.media.listMedia(
      { search: stem, limit: MEDIA_PAGE, page },
      {}
    );
    const items = data as unknown[];
    const same = items.find(file => isFile(file, name));
    if (same !== undefined) return isRecord(same) ? idText(same.id) : undefined;
    if (items.length < MEDIA_PAGE) return undefined;
  }
}

/** The media library's id for each image address: the file of the same name. */
async function mediaIds(
  ctx: PluginContext,
  urls: readonly string[]
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  for (const url of new Set(urls)) {
    const name = fileNameOf(url);
    const id = name === undefined ? undefined : await mediaIdOf(ctx, name);
    if (id !== undefined) found.set(url, id);
  }
  return found;
}

/** Text the same as another, read as a person would: spaces and case aside. */
function same(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  const tidy = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();
  return tidy(a) === tidy(b);
}

/**
 * A canonical that names the page's own address, which it has anyway: its
 * path, alone or on one of the site's own origins, with no query or
 * fragment. Anything else names another address, and is kept.
 */
function ownAddress(
  canonical: string,
  page: Decided,
  origins: readonly string[]
): boolean {
  // Where the page is served in its language: its prefix, or its domain.
  const served = page.served ?? page.path;
  if (served === undefined) return false;
  let url: URL;
  let home: URL;
  try {
    url = new URL(canonical, RELATIVE);
    home = new URL(served, RELATIVE);
  } catch {
    return false;
  }
  if (url.search !== "" || url.hash !== "") return false;
  const onSite =
    url.origin === RELATIVE ||
    (home.origin === RELATIVE
      ? origins.includes(url.origin)
      : url.origin === home.origin);
  const trim = (path: string) => path.replace(/\/+$/, "") || "/";
  return onSite && trim(url.pathname) === trim(home.pathname);
}

/** The origin a relative address is read on, and known by. */
const RELATIVE = "https://relative.invalid";

/** A page a record's values are decided for: one version, served where it is. */
type Decided = ReadPage & { served?: string };

/**
 * The digest an apply is held to: every change, each version it goes into
 * and how, and the revision each was read at.
 */
function planDigest(
  locale: string | undefined,
  pages: readonly PlannedPage[],
  redirects: readonly PlannedRedirect[]
): string {
  const hash = createHash("sha256");
  hash.update(JSON.stringify({ locale: locale ?? null }));
  for (const page of pages) {
    hash.update(
      JSON.stringify([
        page.key,
        page.write,
        page.rev ?? null,
        page.seo,
        page.writes,
      ])
    );
  }
  for (const redirect of redirects) hash.update(JSON.stringify(redirect));
  return hash.digest("hex");
}

/** A list of names, the first few spelled out. */
function someOf(names: readonly string[]): string {
  const shown = names.slice(0, 5).join(", ");
  return names.length > 5 ? `${shown} and ${names.length - 5} more` : shown;
}

/** What the decisions over every page counted, for the dry run. */
interface Tally {
  same: number;
  kept: number;
  unfilled: number;
  missingImages: number;
  /** Canonicals on another site, whose pages are marked as first there. */
  elsewhere: number;
  /** Canonicals that are no address a page could name. */
  unusableCanonicals: number;
}

/**
 * One page's writes, the places they fill, and the places left as they are
 * because their value is the same as the automatic one, or a person
 * already filled them.
 */
interface Decision {
  writes: Record<string, unknown>;
  places: ImportTarget[];
  same: ImportTarget[];
  kept: ImportTarget[];
  neverServed: ImportTarget[];
  values: ReportedValues;
}

/** A decision that changes nothing yet. */
const undecided = (): Decision => ({
  writes: {},
  places: [],
  same: [],
  kept: [],
  neverServed: [],
  values: {},
});

/** What deciding one record's values needs about its page. */
interface Deciding {
  /** The site's own origins, a canonical on which names the page itself. */
  origins: readonly string[];
  /**
   * The group's fields holding a value the person may not read: never
   * empty places, so the import leaves them as they are.
   */
  unreadable: ReadonlySet<string>;
  record: ImportedRecord;
  page: Decided;
  templates: TemplateValues;
  tally: Tally;
  decision: Decision;
  /** Whether values the page's own code overrides are imported anyway. */
  includeNeverServed: boolean;
}

/**
 * What a text place answers with nothing typed in it, given every other
 * value the page keeps and the import writes: the resolver's own answer, so
 * a social title compared here falls back to the title the page would show.
 */
function automaticFor(
  place: Exclude<(typeof TEXT_PLACES)[number], "canonical">,
  page: ReadPage,
  decided: Readonly<Record<string, unknown>>
): string | undefined {
  const { [STORED[place]]: _left, ...others } = { ...page.seo, ...decided };
  return resolveOrder({ ...page.levels, page: typedPageLevel(others) })[place]
    ?.value;
}

/**
 * Whether a shared title or description falls back to a title or
 * description the person may not read: what it would show automatically
 * then can't be known from what they read, so it is never left automatic.
 */
function fallsBackUnseen(
  at: Deciding,
  place: Exclude<(typeof TEXT_PLACES)[number], "canonical">
): boolean {
  if (place === "socialTitle") return at.unreadable.has(STORED.title);
  if (place === "socialDescription") {
    return at.unreadable.has(STORED.description);
  }
  return false;
}

/** A place a person already filled with another value: kept, and counted. */
function keep(at: Deciding, place: ImportTarget): void {
  at.tally.kept++;
  at.decision.kept.push(place);
}

/**
 * Whether `value` never reached the page: its route's code sets that place
 * itself, to something else, so the stored value was never what the page
 * showed, and importing it would change the page. Such a value is left out
 * unless the import includes them; one that agrees with the code is not
 * marked, since importing it changes nothing.
 */
function neverServed(
  at: Deciding,
  place: (typeof TEXT_PLACES)[number],
  value: string
): boolean {
  if (at.includeNeverServed || place === "canonical") return false;
  const fromCode = at.page.levels.code[place];
  return fromCode !== undefined && !same(fromCode, value);
}

/** Whether `value` is left out as never served, recorded on the page. */
function leftAsNeverServed(
  at: Deciding,
  place: (typeof TEXT_PLACES)[number],
  value: string
): boolean {
  if (!neverServed(at, place, value)) return false;
  at.decision.neverServed.push(place);
  return true;
}

/** Write `value` into `place`, unless it is typed already or is automatic. */
function decideText(at: Deciding, place: (typeof TEXT_PLACES)[number]): void {
  const raw = at.record.values[place];
  if (raw === undefined) return;
  // An address is no template: its percent escapes are not variables.
  const value =
    place === "canonical"
      ? raw
      : fillTemplate(raw, at.record.variables, {
          ...at.templates,
          title: at.record.sourceTitle ?? at.page.label,
        });
  if (value === undefined) {
    at.tally.unfilled++;
    return;
  }
  // The title and description the source holds, for the report.
  if (place === "title" || place === "description") {
    at.decision.values[place] = value;
  }
  if (at.unreadable.has(STORED[place])) {
    keep(at, place);
    return;
  }
  const current = textValue(at.page.seo[STORED[place]]);
  if (current !== undefined) {
    // Typed already: kept as typed, whether or not the source holds the
    // same value. Never reported as the same as automatic, which it is not,
    // nor as never served: a typed value wins over the route's code, so it
    // is what the page shows.
    keep(at, place);
    return;
  }
  if (leftAsNeverServed(at, place, value)) return;
  const automatic =
    place === "canonical"
      ? ownAddress(value, at.page, at.origins)
      : !fallsBackUnseen(at, place) &&
        same(value, automaticFor(place, at.page, at.decision.writes));
  if (automatic) {
    at.tally.same++;
    at.decision.same.push(place);
    return;
  }
  if (place === "canonical" && !placeCanonical(at, value)) return;
  at.decision.writes[STORED[place]] = value;
  at.decision.places.push(place);
}

/**
 * Whether an imported canonical can stand, as the page's head reads it
 * (`typedCanonical`): one on another site does where the page is marked as
 * having first appeared there, which the source's own canonical says it
 * did, so the mark is written beside it; one that is no address is left out.
 */
function placeCanonical(at: Deciding, value: string): boolean {
  const site = { productionAddresses: at.origins };
  if (typedCanonical(value, { ...site, elsewhere: false }) !== undefined) {
    return true;
  }
  if (typedCanonical(value, { ...site, elsewhere: true }) === undefined) {
    at.tally.unusableCanonicals++;
    return false;
  }
  at.decision.writes[CANONICAL_ELSEWHERE] = true;
  at.tally.elsewhere++;
  return true;
}

/** The id an image already chosen holds, as text, or none. */
function chosenImage(value: unknown): string | undefined {
  return idText(isRecord(value) ? value.id : value);
}

/** Write the share image, found in the media library, into an empty place. */
function decideImage(at: Deciding, images: ReadonlyMap<string, string>): void {
  const image = at.record.values.image;
  if (image === undefined) return;
  const id = "id" in image ? image.id : images.get(image.url);
  if (id === undefined) {
    at.tally.missingImages++;
    return;
  }
  if (at.unreadable.has(STORED.image)) {
    keep(at, "image");
    return;
  }
  const current = chosenImage(at.page.seo[STORED.image]);
  if (current !== undefined) {
    // Chosen already, as this image or another: kept as chosen.
    keep(at, "image");
    return;
  }
  at.decision.writes[STORED.image] = id;
  at.decision.places.push("image");
}

/** Hide the page where the source hid it; a page a person hid stays hidden. */
function decideHidden(at: Deciding): void {
  const hidden = at.record.values.hidden;
  if (hidden !== undefined && at.unreadable.has(STORED.hidden)) {
    keep(at, "hidden");
    return;
  }
  const current = at.page.seo[STORED.hidden] === true;
  // A type hidden whole hides the page already, and showing the type again
  // should show it: the page is left to the type.
  if (hidden === true && !current && at.page.levels.typeHidden === true) {
    at.tally.same++;
    at.decision.same.push("hidden");
  } else if (hidden === true && !current) {
    at.decision.writes[STORED.hidden] = true;
    at.decision.places.push("hidden");
  } else if (current && hidden !== undefined) {
    // Hidden by a person: kept so, whatever the source says.
    keep(at, "hidden");
  } else if (
    hidden === false &&
    at.page.levels.typeHidden !== true &&
    at.page.levels.code.hidden !== true
  ) {
    // Shown, as a page is where nothing hides it: the same as automatic.
    // A page its type or its route's code hides stays hidden, which the
    // import can't change, so it is not counted as the same.
    at.tally.same++;
    at.decision.same.push("hidden");
  }
}

/**
 * The values one record writes into its page: each into an empty place, a
 * value the same as the automatic one left automatic, a typed one kept.
 */
function decide(
  record: ImportedRecord,
  page: Decided,
  templates: TemplateValues,
  images: ReadonlyMap<string, string>,
  tally: Tally,
  origins: readonly string[],
  unreadable: ReadonlySet<string>,
  includeNeverServed: boolean
): Decision {
  const at: Deciding = {
    includeNeverServed,
    origins,
    unreadable,
    record,
    page,
    templates,
    tally,
    decision: undecided(),
  };
  for (const place of TEXT_PLACES) decideText(at, place);
  decideImage(at, images);
  decideHidden(at);
  return at.decision;
}

/**
 * The plugin's own group's typed title and description that are the same as
 * the automatic ones, made automatic; every other value stays.
 */
function tidyOwn(page: ReadPage, tally: Tally): Decision {
  const decision = undecided();
  for (const place of ["title", "description"] as const) {
    const current = textValue(page.seo[STORED[place]]);
    // What the page holds is what the report shows, so a value made
    // automatic again can be checked before it is.
    if (current !== undefined) decision.values[place] = current;
    if (current !== undefined && same(current, page.auto[place])) {
      decision.writes[STORED[place]] = "";
      decision.places.push(place);
      tally.same++;
    } else if (current !== undefined) {
      decision.kept.push(place);
    }
  }
  return decision;
}

/**
 * The redirects the redirect rules would refuse, each with why: tried in
 * turn on a transaction that is then undone, so trying changes nothing.
 */
async function refusedRedirects(
  ctx: PluginContext,
  redirects: readonly PlannedRedirect[]
): Promise<Map<PlannedRedirect, string>> {
  const refused = new Map<PlannedRedirect, string>();
  if (redirects.length === 0) return refused;
  // Thrown to undo the transaction, and recognised as that alone.
  const undo = NextlyError.conflict({
    reason: "state",
    logContext: { reason: "seo-import-redirects-tried" },
  });
  try {
    await ctx.services.collections.withTransaction(async transaction => {
      for (const redirect of redirects) {
        const outcome = await putRedirect(ctx, transaction, {
          locale: redirect.locale,
          source: redirect.source,
          target: redirect.target,
          permanent: redirect.permanent,
          origin: "import",
        });
        if ("refused" in outcome) refused.set(redirect, outcome.refused);
      }
      throw undo;
    });
  } catch (error) {
    if (error !== undo) throw error;
  }
  return refused;
}

/** The types an import reads: those holding the group, or every readable one. */
async function sourceTypes(
  ctx: PluginContext,
  readable: readonly string[],
  source: ImportSource
): Promise<string[]> {
  if (source.kind !== "group") return [...readable];
  const types = (await typeFields(ctx, readable))
    .filter(type =>
      groupsOf(ctx, [type], []).some(group => group.field === source.field)
    )
    .map(type => type.slug);
  if (types.length === 0) {
    throw NextlyError.invalidInput({
      message: `No content type you can read holds a group named ${source.field}.`,
      logContext: { reason: "seo-import-no-such-group", field: source.field },
    });
  }
  return types;
}

/** What a template is filled in with, from the site's settings. */
function templatesOf(rules: SiteRules): TemplateValues {
  return {
    separator: separatorOf(rules),
    ...(rules.siteName === undefined ? {} : { siteName: rules.siteName }),
    ...(rules.description === undefined
      ? {}
      : { siteDescription: rules.description }),
  };
}

/** The image addresses the records name, to look up in the media library. */
function imageUrls(records: readonly ImportedRecord[]): string[] {
  return records.flatMap(record => {
    const image: ImageRef | undefined = record.values.image;
    return image !== undefined && "url" in image ? [image.url] : [];
  });
}

/** The records an import passes over, by why. */
interface Skipped {
  unmatched: string[];
  ambiguous: string[];
  repeated: string[];
  redirectsWithoutAddress: number;
}

/** Every record matched and decided: the pages' changes and the redirects. */
interface Matched {
  planned: PlannedPage[];
  redirects: AskedRedirect[];
  skipped: Skipped;
}

/**
 * A record's redirect, where it asks for one that can be added: from an
 * address no page here holds. Where it cannot, why is counted.
 */
function redirectOf(
  record: ImportedRecord,
  skipped: Skipped
): AskedRedirect | undefined {
  if (record.redirect === undefined) return undefined;
  const { source } = record.redirect;
  if (source === undefined) {
    skipped.redirectsWithoutAddress++;
    return undefined;
  }
  const { address } = record.redirect;
  return {
    source,
    ...(address === undefined ? {} : { address }),
    target: record.redirect.target,
    permanent: record.redirect.permanent,
  };
}

/** A version and what was decided for it, as the plan keeps it. */
function plannedOf(version: ReadVersion, decision: Decision): PlannedPage {
  return {
    type: version.type,
    id: version.id,
    label: version.label,
    ...(version.rev === undefined ? {} : { rev: version.rev }),
    key: version.key,
    ...(version.locale === undefined ? {} : { locale: version.locale }),
    ...(version.language === undefined ? {} : { language: version.language }),
    form: version.form,
    write: version.write,
    inTransaction: version.inTransaction,
    ...(version.leftOut === undefined ? {} : { leftOut: version.leftOut }),
    writes: decision.writes,
    seo: version.stored,
    places: decision.places,
    same: decision.same,
    kept: decision.kept,
    neverServed: decision.neverServed,
    values: decision.values,
  };
}

/** Match each record to its versions and decide each one's changes. */
function matchRecords(
  records: readonly ImportedRecord[],
  find: (record: ImportedRecord) => Found,
  decideFor: (record: ImportedRecord, version: ReadVersion) => Decision
): Matched {
  const skipped: Skipped = {
    unmatched: [],
    ambiguous: [],
    repeated: [],
    redirectsWithoutAddress: 0,
  };
  const planned = new Map<string, PlannedPage>();
  const redirects: AskedRedirect[] = [];
  for (const record of records) {
    const found = find(record);
    // A redirect from the record's own address is tried by the redirect
    // rules, which refuse one from an address a published page holds; the
    // record's values still go to the page it matched, wherever that is now.
    const redirect = redirectOf(record, skipped);
    if (redirect !== undefined) redirects.push(redirect);
    if (found === undefined) {
      if (record.match.page === undefined && redirect === undefined) {
        skipped.unmatched.push(record.label);
      }
    } else if (found === "ambiguous") skipped.ambiguous.push(record.label);
    else if (found.some(version => planned.has(version.key))) {
      skipped.repeated.push(record.label);
    } else {
      // Each version keeps values of its own, so each is decided on its own.
      for (const version of found) {
        planned.set(
          version.key,
          plannedOf(version, decideFor(record, version))
        );
      }
    }
  }
  return { planned: [...planned.values()], redirects, skipped };
}

/** `one` or `many`, by `n`. */
const either = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** What the person should know about what the import passes over. */
function warningsOf(skipped: Skipped, tally: Tally): string[] {
  const lines: [number, (n: number) => string][] = [
    [
      skipped.unmatched.length,
      n =>
        `${count(n, "page")} in the file ${either(n, "isn't", "aren't")} on this site, so ${either(n, "it is", "they are")} skipped: ${someOf(skipped.unmatched)}.`,
    ],
    [
      skipped.ambiguous.length,
      n =>
        `${count(n, "page")} in the file match more than one page here, so ${either(n, "it is", "they are")} skipped: ${someOf(skipped.ambiguous)}.`,
    ],
    [
      skipped.repeated.length,
      n =>
        `${count(n, "page")} appear in the file more than once; the first is used: ${someOf(skipped.repeated)}.`,
    ],
    [
      tally.unfilled,
      n =>
        `${count(n, "value")} use a variable Nextly can't fill in, so ${either(n, "it is", "they are")} left out. Separators and the site name are filled in from SEO settings.`,
    ],
    [
      tally.missingImages,
      n =>
        `${count(n, "share image")} ${either(n, "isn't", "aren't")} in the media library, so ${either(n, "it is", "they are")} left out. Upload ${either(n, "it", "them")} first to bring ${either(n, "it", "them")} across.`,
    ],
    [
      tally.elsewhere,
      n =>
        `${count(n, "official address", "official addresses")} (canonical) ${either(n, "is", "are")} on another site, so ${either(n, "its page is", "those pages are")} marked as first appearing there, and search engines are sent to ${either(n, "it", "them")}.`,
    ],
    [
      tally.unusableCanonicals,
      n =>
        `${count(n, "official address", "official addresses")} (canonical) ${either(n, "isn't an address", "aren't addresses")} a page can name, so ${either(n, "it is", "they are")} left out.`,
    ],
    [
      skipped.redirectsWithoutAddress,
      n =>
        `${count(n, "redirect")} in the file ${either(n, "has", "have")} no address to start from, so ${either(n, "it is", "they are")} left out. Add ${either(n, "it", "them")} in Redirects.`,
    ],
  ];
  return lines.filter(([n]) => n > 0).map(([n, say]) => say(n));
}

/** How many pages `versions` are of, each counted once whatever its versions. */
function pagesIn(versions: readonly PlannedPage[]): number {
  return new Set(versions.map(pageKey)).size;
}

/** Each place the import fills, from where, and on how many pages. */
function linesOf(
  changing: readonly PlannedPage[],
  from: ParsedSource["from"]
): DryRunBody["lines"] {
  return (Object.keys(STORED) as (keyof typeof STORED)[])
    .map(target => ({
      target: target as ImportTarget,
      from: from[target] ?? [],
      pages: pagesIn(changing.filter(page => page.places.includes(target))),
    }))
    .filter(line => line.pages > 0 || line.from.length > 0);
}

/**
 * The versions of `changing` the caller may change the SEO of, and those
 * they may not, which the import leaves out: asked of each type in each
 * language, since a rule may answer one language and not another.
 */
async function writableOf(
  engine: ImportEngine,
  changing: readonly PlannedPage[]
): Promise<{ writable: PlannedPage[]; refused: PlannedPage[] }> {
  const where = (page: PlannedPage) => `${page.type}|${page.locale ?? ""}`;
  const allowed = new Set<string>();
  const asked = new Map<string, PlannedPage[]>();
  for (const page of changing) {
    asked.set(where(page), [...(asked.get(where(page)) ?? []), page]);
  }
  for (const [at, pages] of asked) {
    const [first] = pages;
    if (first === undefined) continue;
    const ids = [...new Set(pages.map(page => page.id))];
    for (const id of await engine.actor.writable(
      first.type,
      ids,
      first.locale
    )) {
      allowed.add(`${at}|${id}`);
    }
  }
  const may = (page: PlannedPage) => allowed.has(`${where(page)}|${page.id}`);
  return {
    writable: changing.filter(may),
    refused: changing.filter(page => !may(page)),
  };
}

/** Why a record or a version is passed over, in the report's words. */
const SKIPPED = {
  unmatched: "Not on this site.",
  ambiguous: "Matches more than one page here.",
  repeated: "Named more than once; the first is used.",
  refused: "You may not change this page's SEO.",
  withDraft:
    "Its draft gets these values, and takes them live when it's published: writing this version now would publish the draft.",
  untilDraftDone:
    "A draft waits beside it, and writing this version now would publish the draft. Import again once the draft is published or discarded.",
  draftInLanguage:
    "A draft in a language other than the default can't take imported values yet. Import again once the draft is published or discarded.",
  empty: "The source holds no value for this page.",
  neverServed:
    "Never served: the page's own code sets these values, so they never reached it.",
} as const;

/**
 * What the import does to each version it read, and each record it passed
 * over: what it sets, what is the same as automatic, what a person already
 * typed and keeps, what goes live with a draft, and why one is skipped.
 */
function reportOf(
  planned: readonly PlannedPage[],
  skipped: Skipped,
  left: { refused: readonly PlannedPage[]; waiting: readonly PlannedPage[] }
): ImportReportEntry[] {
  const refused = new Set(left.refused);
  const waiting = new Set(left.waiting);
  const leftAs = (page: PlannedPage) =>
    page.leftOut === "withDraft"
      ? { withDraft: [...page.places] }
      : { waiting: [...page.places] };
  const entry = (
    page: PlannedPage,
    outcome: ImportReportEntry["outcome"],
    reason?: string
  ): ImportReportEntry => ({
    type: page.type,
    id: page.id,
    label: page.label,
    ...(page.locale === undefined ? {} : { locale: page.locale }),
    ...(page.language === undefined ? {} : { language: page.language }),
    version: page.form,
    outcome,
    set: outcome === "set" ? [...page.places] : [],
    same: [...page.same],
    kept: [...page.kept],
    neverServed: [...page.neverServed],
    ...(waiting.has(page) ? leftAs(page) : {}),
    values: { ...page.values },
    ...(reason === undefined ? {} : { reason }),
  });
  // A page's versions side by side, in the order its first one was read.
  const first = new Map<string, number>();
  for (const [at, page] of planned.entries()) {
    if (!first.has(pageKey(page))) first.set(pageKey(page), at);
  }
  const byPage = [...planned].sort(
    (a, b) => (first.get(pageKey(a)) ?? 0) - (first.get(pageKey(b)) ?? 0)
  );
  const pages = byPage.map(page => {
    if (refused.has(page)) return entry(page, "skipped", SKIPPED.refused);
    if (waiting.has(page) && page.leftOut !== undefined) {
      return entry(page, "skipped", SKIPPED[page.leftOut]);
    }
    if (page.places.length > 0) return entry(page, "set");
    if (page.kept.length > 0) return entry(page, "kept");
    if (page.same.length > 0) return entry(page, "same");
    if (page.neverServed.length > 0) {
      return entry(page, "skipped", SKIPPED.neverServed);
    }
    return entry(page, "skipped", SKIPPED.empty);
  });
  const passed = (labels: readonly string[], reason: string) =>
    labels.map(
      (label): ImportReportEntry => ({
        label,
        outcome: "skipped",
        set: [],
        same: [],
        kept: [],
        neverServed: [],
        values: {},
        reason,
      })
    );
  return [
    ...pages,
    ...passed(skipped.unmatched, SKIPPED.unmatched),
    ...passed(skipped.ambiguous, SKIPPED.ambiguous),
    ...passed(skipped.repeated, SKIPPED.repeated),
  ];
}

/** Whether a stored value fills its place. */
function filledValue(value: unknown): boolean {
  if (value === null || value === undefined || value === false) return false;
  return typeof value !== "string" || value.trim() !== "";
}

/**
 * A version's `seo` fields that hold a value its reader was not shown: its
 * group as the site stores it, beside the reader's own read, so where a
 * field rule hides a value, the place is known to be filled without the
 * value itself being read into the dry run.
 */
function unreadableOf(version: ReadVersion): Set<string> {
  return new Set(
    Object.keys(version.stored).filter(
      name => filledValue(version.stored[name]) && !(name in version.seo)
    )
  );
}

/** The origin a path from the root is read on where the site names none. */
const SITE_ORIGIN = "https://site.invalid";

/**
 * Each redirect placed in the language its From address is in, both its
 * addresses kept as the redirect rules keep them, without the language's
 * own prefix or domain: read as a visitor's address on the site, the way
 * the redirects screen's import reads them. One sending a visitor to
 * another language is left out and said so.
 */
async function placeRedirects(
  ctx: PluginContext,
  asked: readonly AskedRedirect[],
  origin: string,
  defaultLanguage: string
): Promise<{ redirects: PlannedRedirect[]; warnings: string[] }> {
  const redirects: PlannedRedirect[] = [];
  const warnings: string[] = [];
  for (const redirect of asked) {
    // An address in full on one of the site's language domains is read in
    // that language; one on another site (the old one) by its path.
    const written = redirect.address ?? redirect.source;
    const onDomain = await keptFrom(ctx, written, origin);
    const from =
      onDomain.locale !== undefined
        ? onDomain
        : await keptFrom(ctx, redirect.source, origin);
    const beside = onDomain.locale !== undefined ? written : redirect.source;
    const to = await keptFrom(
      ctx,
      redirect.target,
      originBeside(beside, origin)
    );
    if (
      from.locale !== undefined &&
      to.locale !== undefined &&
      to.locale !== from.locale
    ) {
      warnings.push(
        `The redirect from ${redirect.source} is left out: it sends a visitor to another language.`
      );
      continue;
    }
    redirects.push({
      locale: from.locale ?? defaultLanguage,
      source: from.path,
      target: to.locale === undefined ? redirect.target : to.path,
      permanent: redirect.permanent,
    });
  }
  return { redirects, warnings };
}

/**
 * Where each of a field group's fields goes: as asked, else as the source
 * says, else where each field's name says it goes, as the import panel
 * suggests. Nothing for an export file, which says where its values go.
 */
async function mappingOf(
  ctx: PluginContext,
  args: PlanImportArgs,
  types: readonly string[],
  pages: readonly ReadPage[]
): Promise<Readonly<Record<string, ImportTarget>>> {
  const { source } = args;
  if (source.kind !== "group") return {};
  if (args.mapping !== undefined) return args.mapping;
  if (source.map !== undefined) return source.map;
  const group = groupsOf(ctx, await typeFields(ctx, types), pages).find(
    each => each.field === source.field
  );
  return Object.fromEntries(
    (group?.fields ?? []).map(field => [field.name, field.suggested])
  );
}

/** What the person should know about versions the import leaves out. */
function leftOutWarnings(
  notYours: readonly PlannedPage[],
  waiting: readonly PlannedPage[]
): string[] {
  const warnings: string[] = [];
  if (notYours.length > 0) {
    const n = pagesIn(notYours);
    warnings.push(
      `${count(n, "page")} would change, but you may not change ${either(n, "its", "their")} SEO, so ${either(n, "it is", "they are")} left out: ${someOf([...new Set(notYours.map(page => page.label))])}.`
    );
  }
  const labels = (pages: readonly PlannedPage[]) =>
    someOf([...new Set(pages.map(page => page.label))]);
  const withDraft = waiting.filter(page => page.leftOut === "withDraft");
  if (withDraft.length > 0) {
    const n = pagesIn(withDraft);
    warnings.push(
      `${count(n, "page")} ${either(n, "has a draft", "have drafts")} waiting beside what is published. The ${either(n, "draft gets", "drafts get")} the values, which go live when ${either(n, "it is", "they are")} published: ${labels(withDraft)}.`
    );
  }
  const later = waiting.filter(page => page.leftOut !== "withDraft");
  if (later.length > 0) {
    const n = pagesIn(later);
    warnings.push(
      `${count(n, "page")} ${either(n, "has a draft", "have drafts")} waiting in a language other than the default, so ${either(n, "its", "their")} values there are left as they are: ${labels(later)}. Import again once the ${either(n, "draft is", "drafts are")} published or discarded.`
    );
  }
  return warnings;
}

/**
 * The import `args` asks for, worked out and changing nothing: what each
 * version of each page would be set to, what each is left as and why, and
 * the redirects it adds. `applyImport` writes exactly this.
 */
export async function planImport(
  engine: ImportEngine,
  args: PlanImportArgs
): Promise<ImportPlan> {
  const { ctx, actor, setup } = engine;
  const locale = args.locale;
  const rules = await setup.readRules(ctx, locale);
  const { source } = args;
  const types = await sourceTypes(
    ctx,
    await readableTypes(engine, args.types),
    source
  );
  // Every language of every page, published and waiting as a draft.
  const versions = await everyVersion(ctx, actor, types, language =>
    setup.readRules(ctx, language)
  );
  const defaultLanguage =
    locale ?? (await ctx.publicAddresses.defaultLanguage());
  const mapping = await mappingOf(ctx, args, types, versions);
  const parsed = parsedSource(source, mapping, versions, defaultLanguage);
  const own = source.kind === "group" && source.field === SEO_GROUP;
  const templates = templatesOf(rules);
  // A template is filled in with the matched version's own language's rules.
  const templatesBy = new Map<string | undefined, TemplateValues>();
  for (const language of new Set(versions.map(each => each.locale))) {
    templatesBy.set(
      language,
      language === undefined
        ? templates
        : templatesOf(await setup.readRules(ctx, language))
    );
  }
  const origins = productionAddressesOf(rules.productionAddresses);
  // Images are looked for only by someone who may read the media library,
  // so the import says nothing about files they may not see.
  const urls = imageUrls(parsed.records);
  const mayReadMedia = actor.mayReadMedia;
  const images = mayReadMedia
    ? await mediaIds(ctx, urls)
    : new Map<string, string>();
  const tally: Tally = {
    same: 0,
    kept: 0,
    unfilled: 0,
    missingImages: 0,
    elsewhere: 0,
    unusableCanonicals: 0,
  };
  const matched = matchRecords(
    parsed.records,
    matcher(versions, await ctx.publicAddresses.defaultLanguage()),
    (record, version) =>
      own
        ? tidyOwn(version, tally)
        : decide(
            record,
            version,
            templatesBy.get(version.locale) ?? templates,
            images,
            tally,
            origins,
            unreadableOf(version),
            args.includeNeverServed === true
          )
  );
  const wanting = matched.planned.filter(page => page.places.length > 0);
  const waiting = wanting.filter(page => page.leftOut !== undefined);
  const { writable: changing, refused: notYours } = await writableOf(
    engine,
    wanting.filter(page => page.leftOut === undefined)
  );
  // Not looked for, so not said to be missing from the library either.
  if (!mayReadMedia) tally.missingImages = 0;
  const warnings = [...parsed.warnings, ...warningsOf(matched.skipped, tally)];
  if (!mayReadMedia && urls.length > 0) {
    warnings.push(
      "You may not read the media library, so the share images in the file can't be matched to it."
    );
  }
  warnings.push(...leftOutWarnings(notYours, waiting));
  const placed = await placeRedirects(
    ctx,
    matched.redirects,
    origins[0] ?? SITE_ORIGIN,
    defaultLanguage
  );
  warnings.push(...placed.warnings);
  const refused = await refusedRedirects(ctx, placed.redirects);
  for (const [redirect, why] of refused) {
    warnings.push(`The redirect from ${redirect.source} is left out: ${why}`);
  }
  const kept = placed.redirects.filter(redirect => !refused.has(redirect));
  return {
    pages: changing,
    redirects: kept,
    locale: defaultLanguage,
    engine,
    args,
    body: {
      checked:
        source.kind === "group"
          ? new Set(versions.map(pageKey)).size
          : parsed.records.length,
      fromFile: source.kind !== "group",
      held: parsed.records.filter(
        record => Object.keys(record.values).length > 0
      ).length,
      lines: linesOf(changing, parsed.from),
      pages: pagesIn(changing),
      versions: changing.length,
      same: tally.same,
      kept: tally.kept,
      // Counted from the versions' own decisions, the list the report shows.
      neverServed: matched.planned.reduce(
        (sum, page) => sum + page.neverServed.length,
        0
      ),
      redirects: kept.length,
      left: parsed.left,
      warnings,
      documents: reportOf(matched.planned, matched.skipped, {
        refused: notYours,
        waiting,
      }),
      plan: planDigest(locale, changing, kept),
    },
  };
}

/** A refusal for the whole import, about the redirect that refused it. */
function redirectRefusal(redirect: PlannedRedirect, why: string): NextlyError {
  return NextlyError.conflict({
    reason: "state",
    message: `The redirect from ${redirect.source} can't be added: ${why} Nothing was imported.`,
  });
}

/** The revision each page was last written at, in each language, as an apply goes. */
type Revs = Map<string, string | undefined>;

/** Where a page's revision is kept in `Revs`. */
const revKey = (page: PlannedPage) =>
  `${page.type}|${page.id}|${page.locale ?? ""}`;

/** The revision a version's write names: the last one written, else the one read. */
function revFor(revs: Revs, page: PlannedPage): string | undefined {
  return revs.has(revKey(page)) ? revs.get(revKey(page)) : page.rev;
}

/** The version's data a write sends, with `seo` its group. */
function versionData(
  page: PlannedPage,
  seo: Record<string, unknown>,
  rev: string | undefined
): Record<string, unknown> {
  return {
    [SEO_GROUP]: seo,
    // A published page of a type keeping drafts is written naming its state,
    // or the write would be held as a new draft.
    ...(page.write === "live" ? { status: "published" } : {}),
    ...(rev === undefined ? { _overwrite: true } : { _rev: rev }),
  };
}

/** Each page's published version before its draft, so the draft is written last. */
function inOrder(pages: readonly PlannedPage[]): PlannedPage[] {
  return [...pages].sort(
    (a, b) => Number(a.write === "held") - Number(b.write === "held")
  );
}

/**
 * Write every version's changes that go on `transaction` (a collection's,
 * in the default language) and add every redirect. Any refusal is thrown,
 * which undoes everything written before it.
 */
async function writeAll(
  transaction: Transaction,
  plan: ImportPlan,
  revs: Revs
): Promise<void> {
  const { ctx, actor } = plan.engine;
  for (const page of inOrder(plan.pages.filter(each => each.inTransaction))) {
    // Written as the actor, in the version's language.
    const as = {
      ...actor.as,
      ...(page.locale === undefined ? {} : { locale: page.locale }),
    };
    try {
      // Over the group as stored, every value the person may not read
      // kept as it was.
      const saved = await ctx.services.collections.updateEntryInTransaction(
        transaction,
        page.type,
        page.id,
        versionData(page, seoWith(page.seo, page.writes), revFor(revs, page)),
        as
      );
      revs.set(
        revKey(page),
        typeof saved._rev === "string" ? saved._rev : undefined
      );
      if (page.write === "held") {
        // A held save's draft can't be read on the transaction, so its
        // answer is judged: a value it doesn't show can't be checked, and
        // is refused rather than reported as imported.
        refuseDroppedValues(saved, page.writes, page.id);
      } else {
        await refuseIfNotStored(
          ctx,
          transaction,
          { type: page.type, id: page.id, locale: page.locale ?? plan.locale },
          page.writes
        );
      }
    } catch (error) {
      throw refusalAbout(error, page.label);
    }
  }
  for (const redirect of plan.redirects) {
    const outcome = await putRedirect(ctx, transaction, {
      locale: redirect.locale,
      source: redirect.source,
      target: redirect.target,
      permanent: redirect.permanent,
      origin: "import",
      addedBy: actor.userId,
    });
    if ("refused" in outcome) throw redirectRefusal(redirect, outcome.refused);
  }
}

/** The Direct API a version written as a step of its own reads back with. */
interface StepReads {
  findByID(args: Record<string, unknown>): Promise<unknown>;
  findSingle(args: Record<string, unknown>): Promise<unknown>;
}

/**
 * Whether a working draft waits beside a published version now: a write of
 * its live row outside the transaction would publish it.
 */
async function draftWaitsNow(page: PlannedPage): Promise<boolean> {
  const api = (await getCachedNextly()) as unknown as StepReads;
  const type = pageTypeOf(page.type);
  const read = {
    ...SINGLE_AS_STORED,
    status: "all",
    depth: 0,
    draft: true,
    ...(page.locale === undefined ? {} : { locale: page.locale }),
  };
  const document: unknown =
    type.kind === "single"
      ? await api.findSingle({
          slug: type.slug,
          createIfMissing: false,
          ...read,
        })
      : await api.findByID({ collection: type.slug, id: page.id, ...read });
  return isRecord(document) && document._isWorkingDraft === true;
}

/** A version as the site stores it, in its own language and form. */
async function storedVersion(page: PlannedPage): Promise<unknown> {
  const api = (await getCachedNextly()) as unknown as StepReads;
  const type = pageTypeOf(page.type);
  const read = {
    ...SINGLE_AS_STORED,
    status: "all",
    depth: 0,
    ...(page.write === "held" ? { draft: true } : {}),
    ...(page.locale === undefined
      ? {}
      : { locale: page.locale, fallbackLocale: false }),
  };
  return type.kind === "single"
    ? api.findSingle({ slug: type.slug, createIfMissing: false, ...read })
    : api.findByID({ collection: type.slug, id: page.id, ...read });
}

/**
 * Write one version with `seo` as its group, as `who` (the actor, or the
 * site putting it back), outside the transaction: a Single's page, or a
 * collection's page in a language other than the default. Answers the
 * revision it was written at.
 */
async function writeVersion(
  plan: ImportPlan,
  page: PlannedPage,
  seo: Record<string, unknown>,
  rev: string | undefined,
  who: "actor" | "site"
): Promise<string | undefined> {
  const { ctx, actor } = plan.engine;
  const type = pageTypeOf(page.type);
  if (type.kind === "single") {
    const access: SingleAccess =
      who === "actor" ? actor.single : SINGLE_AS_STORED;
    return writeSingleSeo(
      type.slug,
      access,
      page.locale,
      seo,
      rev,
      page.write === "live" ? { status: "published" } : {}
    );
  }
  const as = who === "actor" ? actor.as : { as: "system" as const };
  const saved = await ctx.services.collections.updateEntry(
    page.type,
    page.id,
    versionData(page, seo, rev),
    { ...as, ...(page.locale === undefined ? {} : { locale: page.locale }) }
  );
  const next = (saved.item as { _rev?: unknown } | undefined)?._rev;
  return typeof next === "string" ? next : undefined;
}

/** A value as two stored values compare: an image by its id. */
function comparable(value: unknown): string {
  const id = idText(isRecord(value) ? value.id : value);
  return id ?? JSON.stringify(value ?? null);
}

/**
 * The group a step put back writes: the group as stored now, each place
 * that still holds what the import wrote set back to what it held before.
 * A place someone changed since, or the write left out, is left as it is,
 * so a save made since is never undone. None where no place holds the
 * import's value.
 */
export function undoneGroup(
  stored: unknown,
  page: PlannedPage
): Record<string, unknown> | undefined {
  const now =
    isRecord(stored) && isRecord(stored[SEO_GROUP]) ? stored[SEO_GROUP] : {};
  const back: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(page.writes)) {
    if (comparable(now[name]) === comparable(value)) {
      back[name] = page.seo[name] ?? null;
    }
  }
  return Object.keys(back).length === 0 ? undefined : seoWith(now, back);
}

/**
 * What an import refused part-way throws once its steps were put back:
 * the refusal itself where every one was, else one saying part of it may be
 * in place, the refusal as its cause.
 */
export function refusalAfterUndo(error: unknown, restored: boolean): unknown {
  if (restored) return error;
  return new NextlyError({
    code: IMPORT_PARTLY_APPLIED,
    statusCode: 500,
    publicMessage:
      "The import stopped part-way, and a page it had written could not be put back.",
    logContext: { reason: "seo-import-steps-not-restored" },
    ...(error instanceof Error ? { cause: error } : {}),
  });
}

/** Refusals a save answers before it stores anything. */
const BEFORE_STORING = [
  "STALE_VERSION",
  "VERSION_REQUIRED",
  "CONFLICT",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "INVALID_INPUT",
] as const;

/** Whether `error` is a save's refusal made before it stored anything. */
export function refusedBeforeStoring(error: unknown): boolean {
  return BEFORE_STORING.some(code => NextlyError.isCode(error, code));
}

/** A version written as a step of its own, which a later refusal puts back. */
type Written = PlannedPage[];

/**
 * Write a version outside the transaction as the actor, then read it back
 * as stored and refuse where a value sent was left out. It is noted as
 * written before it is judged, so a refusal puts it back too.
 */
async function writeStep(
  plan: ImportPlan,
  page: PlannedPage,
  revs: Revs,
  written: Written
): Promise<void> {
  // A draft made since the dry run would be published by this write.
  if (page.write === "live" && (await draftWaitsNow(page))) {
    throw NextlyError.conflict({
      reason: "state",
      message: `A draft of “${page.label}” was saved after the dry run, and importing into its published version now would publish it. Nothing was imported. Do the dry run again.`,
    });
  }
  // Noted before it is made: a save can be stored and still be refused as
  // its answer is drawn, and putting back undoes only what is there. A
  // refusal made before anything is stored takes the note back, so a value
  // someone else saved meanwhile is never undone as if it were the import's.
  written.push(page);
  let rev: string | undefined;
  try {
    rev = await writeVersion(
      plan,
      page,
      seoWith(page.seo, page.writes),
      revFor(revs, page),
      "actor"
    );
  } catch (error) {
    if (refusedBeforeStoring(error)) written.pop();
    throw refusalAbout(error, page.label);
  }
  revs.set(revKey(page), rev);
  refuseDroppedValues(await storedVersion(page), page.writes, page.id);
}

/**
 * Put each version written as a step back as it was stored, newest first,
 * as the site, at the revision the import left it at.
 */
async function putBack(plan: ImportPlan, written: Written): Promise<boolean> {
  let restored = true;
  for (const page of [...written].reverse()) {
    try {
      // Read again, as stored: put back at the revision it is at now, and
      // only while it still holds what the import wrote, so a save someone
      // made since is never undone.
      // A draft made since waits beside it: putting its live row back would
      // publish the draft, so it is left, and said to be left.
      if (page.write === "live" && (await draftWaitsNow(page))) {
        plan.engine.ctx.logger.warn(
          "An imported version has a draft waiting now, so it is not put back",
          { type: page.type, id: page.id, locale: page.locale }
        );
        restored = false;
        continue;
      }
      const now = await storedVersion(page);
      // A draft published or discarded since is no draft to put back: a
      // save now would make a new one.
      if (
        page.write === "held" &&
        !(isRecord(now) && now._isWorkingDraft === true)
      ) {
        plan.engine.ctx.logger.warn(
          "An imported draft is no longer a draft, so it is not put back",
          { type: page.type, id: page.id, locale: page.locale }
        );
        restored = false;
        continue;
      }
      const rev = isRecord(now) ? now._rev : undefined;
      const back = undoneGroup(now, page);
      // Nothing of the import's is there any more: someone changed every
      // place since, or the write kept none of it.
      if (back === undefined) continue;
      await writeVersion(
        plan,
        page,
        back,
        typeof rev === "string" ? rev : undefined,
        "site"
      );
    } catch (error) {
      // Logged, and answered as not put back, so the refusal says part of
      // the import may be in place rather than that nothing was written.
      plan.engine.ctx.logger.error(
        "An imported version could not be put back",
        {
          error,
          type: page.type,
          id: page.id,
          locale: page.locale,
          form: page.form,
        }
      );
      restored = false;
    }
  }
  return restored;
}

/**
 * Notes that an import was applied, which the Overview's checklist reads.
 * The import is already committed, so a store that is missing (a run with
 * no plugin settings) or refuses the note leaves it as it is.
 */
async function recordImport(ctx: PluginContext): Promise<void> {
  if (ctx.settings === undefined) return;
  try {
    await writeConnections(ctx, { importedAt: new Date().toISOString() });
  } catch (error) {
    ctx.logger.warn("The SEO import ran, but could not be noted.", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Write what `plan` worked out, in full or not at all: every version of a
 * collection's page in the default language, and every redirect, in one
 * transaction; each Single's page, each page in another language and the
 * working draft of a type that is not translated as a step of its own
 * before it, read back as stored and put back as it was where any later
 * write is refused.
 * Each write names the revision its page was read at, so a page changed
 * since the plan is refused rather than written over. Applied again, a plan worked out again sets nothing: every place it
 * filled is filled.
 */
export async function applyImport(
  plan: ImportPlan
): Promise<{ pages: number; redirects: number }> {
  const { ctx, setup } = plan.engine;
  for (const type of new Set(
    plan.pages.filter(page => page.inTransaction).map(page => page.type)
  )) {
    await ctx.services.collections.warmLocalizedReadiness(type);
  }
  const revs: Revs = new Map();
  const written: Written = [];
  try {
    for (const page of inOrder(
      plan.pages.filter(each => !each.inTransaction)
    )) {
      await writeStep(plan, page, revs, written);
    }
    // A conflict retries the transaction's work from the start, so each
    // attempt starts from the revisions the steps left.
    const before = new Map(revs);
    await ctx.services.collections.withTransaction(transaction =>
      writeAll(transaction, plan, new Map(before))
    );
  } catch (error) {
    throw refusalAfterUndo(error, await putBack(plan, written));
  }
  // Committed: each changed page is checked again for the problem list.
  const pages = new Map(plan.pages.map(page => [pageKey(page), page]));
  for (const page of pages.values()) {
    recheckSaved(ctx, setup.checks, page.type, page.id);
  }
  await recordImport(ctx);
  return { pages: pages.size, redirects: plan.redirects.length };
}
