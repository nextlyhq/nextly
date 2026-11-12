/**
 * An import worked out and, once confirmed, applied.
 *
 * Working it out reads the source, matches each of its records to a page
 * here, and decides each page's new `seo` values, changing nothing: that is
 * the dry run. A value is written only into an empty place: a value a person
 * already typed here is kept, and one the same as what the page would show
 * automatically is left automatic, so a later change to a pattern still
 * reaches it. The plugin's own group, as an earlier version of the plugin
 * stored it, is the one case that rewrites typed values, and only those the
 * same as the automatic one, which become automatic.
 *
 * Applying works the import out again and refuses unless it is exactly the
 * one the dry run showed (`plan`, a digest of every change and each page's
 * version), then writes every page and adds every redirect in one
 * transaction: in full, or, where anything is refused part-way, not at all.
 * A Single cannot join that transaction, so each Single's page is written
 * first, as a step of its own, and put back as it was where any later step
 * is refused.
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
  NextlyError,
  type ParticipantTransaction,
  type PluginContext,
} from "@nextlyhq/plugin-sdk";

import {
  keepsDrafts,
  readEveryPage,
  typeNamesOf,
  type ReadPage,
} from "../bulk/pages";
import {
  asStored,
  readStored,
  refusalAbout,
  refuseIfNotStored,
  saveSingleSeo,
  seoWith,
} from "../bulk/route";
import { restoreSingleSeo, singleDeclaration } from "../bulk/singles";
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
import type {
  DryRunBody,
  ImportGroup,
  ImportReportEntry,
  ImportSource,
  ImportTarget,
} from "./contract";
import { readRankMathCsv } from "./csv";
import { declaresOtherGroups, groupsOf, OWN_FIELDS, readGroup } from "./group";
import { readPayload } from "./payload";
import {
  count,
  fillTemplate,
  idText,
  pathOfAddress,
  textValue,
  type ImageRef,
  type ImportedRecord,
  type ParsedSource,
  type TemplateValues,
} from "./records";
import { readRankMathExport, readYoast } from "./wordpress";

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

/** One page's change. */
export interface PlannedPage {
  type: string;
  id: string;
  label: string;
  rev?: string;
  /** The values written into its `seo` group. */
  writes: Record<string, unknown>;
  /** Its `seo` group as stored, which the writes go over. */
  seo: Record<string, unknown>;
  /** The places it changes. */
  places: ImportTarget[];
  /** The places whose value is the same as the page's automatic one. */
  same: ImportTarget[];
  /** The places a person already filled, which keep their value. */
  kept: ImportTarget[];
}

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
  /** The language the values are imported into: the site's default one. */
  locale?: string;
}

/** An import worked out, ready for `applyImport`. */
export interface ImportPlan {
  /** What a dry run shows, its per-page report and its digest included. */
  body: DryRunBody;
  /** The pages it changes, each with its writes. */
  pages: PlannedPage[];
  redirects: PlannedRedirect[];
  /** The language it writes in. */
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
    case "yoast":
      return readYoast(source.text);
    case "rankMath":
      return source.text.trimStart().startsWith("<")
        ? readRankMathExport(source.text)
        : readRankMathCsv(source.text);
    case "payload":
      return readPayload(source.text, language);
  }
}

/** The pages each record could be, by address and by slug. */
function matcher(pages: readonly ReadPage[]) {
  const byKey = new Map<string, ReadPage>();
  const byPath = new Map<string, ReadPage[]>();
  const bySlug = new Map<string, ReadPage[]>();
  for (const page of pages) {
    byKey.set(`${page.type}|${page.id}`, page);
    // Read as a file's address is, decoded and without a trailing slash,
    // so `/blog/caf%C3%A9` here meets `/blog/café/` there.
    const path = pathOfAddress(page.path);
    if (path !== undefined) {
      byPath.set(path, [...(byPath.get(path) ?? []), page]);
    }
    if (page.slug !== undefined) {
      bySlug.set(page.slug, [...(bySlug.get(page.slug) ?? []), page]);
    }
  }
  return (record: ImportedRecord): ReadPage | "ambiguous" | undefined => {
    const { match } = record;
    if (match.page !== undefined) {
      return byKey.get(`${match.page.type}|${match.page.id}`);
    }
    const atPath =
      match.path === undefined ? [] : (byPath.get(match.path) ?? []);
    if (atPath.length === 1) return atPath[0];
    if (atPath.length > 1) return "ambiguous";
    const withSlug =
      match.slug === undefined ? [] : (bySlug.get(match.slug) ?? []);
    if (withSlug.length === 1) return withSlug[0];
    return withSlug.length > 1 ? "ambiguous" : undefined;
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
  page: ReadPage,
  origins: readonly string[]
): boolean {
  if (page.path === undefined) return false;
  let url: URL;
  try {
    url = new URL(canonical, "https://relative.invalid");
  } catch {
    return false;
  }
  if (url.search !== "" || url.hash !== "") return false;
  const onSite =
    url.origin === "https://relative.invalid" || origins.includes(url.origin);
  const trim = (path: string) => path.replace(/\/+$/, "") || "/";
  return onSite && trim(url.pathname) === trim(page.path);
}

/** The digest an apply is held to: every change, and each page's version. */
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
        page.type,
        page.id,
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
}

/** A decision that changes nothing yet. */
const undecided = (): Decision => ({
  writes: {},
  places: [],
  same: [],
  kept: [],
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
  page: ReadPage;
  templates: TemplateValues;
  tally: Tally;
  decision: Decision;
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
  if (at.unreadable.has(STORED[place])) {
    keep(at, place);
    return;
  }
  const current = textValue(at.page.seo[STORED[place]]);
  if (current !== undefined) {
    // Typed already: kept, and said so where the source holds another value.
    if (same(current, value)) at.decision.same.push(place);
    else keep(at, place);
    return;
  }
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
    if (current === id) at.decision.same.push("image");
    else keep(at, "image");
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
  } else if (hidden === false && current) {
    keep(at, "hidden");
  } else if (hidden !== undefined) {
    at.decision.same.push("hidden");
  }
}

/**
 * The values one record writes into its page: each into an empty place, a
 * value the same as the automatic one left automatic, a typed one kept.
 */
function decide(
  record: ImportedRecord,
  page: ReadPage,
  templates: TemplateValues,
  images: ReadonlyMap<string, string>,
  tally: Tally,
  origins: readonly string[],
  unreadable: ReadonlySet<string>
): Decision {
  const at: Deciding = {
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

/** Match each record to its page and decide its changes. */
function matchRecords(
  records: readonly ImportedRecord[],
  find: ReturnType<typeof matcher>,
  decideFor: (record: ImportedRecord, page: ReadPage) => Decision
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
    const page = find(record);
    // A redirect from the record's own address is tried by the redirect
    // rules, which refuse one from an address a published page holds; the
    // record's values still go to the page it matched, wherever that is now.
    const redirect = redirectOf(record, skipped);
    if (redirect !== undefined) redirects.push(redirect);
    if (page === undefined) {
      if (record.match.page === undefined && redirect === undefined) {
        skipped.unmatched.push(record.label);
      }
    } else if (page === "ambiguous") skipped.ambiguous.push(record.label);
    else if (planned.has(`${page.type}|${page.id}`)) {
      skipped.repeated.push(record.label);
    } else {
      const decision = decideFor(record, page);
      planned.set(`${page.type}|${page.id}`, {
        type: page.type,
        id: page.id,
        label: page.label,
        ...(page.rev === undefined ? {} : { rev: page.rev }),
        writes: decision.writes,
        seo: page.seo,
        places: decision.places,
        same: decision.same,
        kept: decision.kept,
      });
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

/** Each place the import fills, from where, and on how many pages. */
function linesOf(
  changing: readonly PlannedPage[],
  from: ParsedSource["from"]
): DryRunBody["lines"] {
  return (Object.keys(STORED) as (keyof typeof STORED)[])
    .map(target => ({
      target: target as ImportTarget,
      from: from[target] ?? [],
      pages: changing.filter(page => page.places.includes(target)).length,
    }))
    .filter(line => line.pages > 0 || line.from.length > 0);
}

/**
 * The pages of `changing` the caller may change the SEO of, and the names of
 * those they may not, which the import leaves out.
 */
async function writableOf(
  engine: ImportEngine,
  changing: readonly PlannedPage[],
  locale: string | undefined
): Promise<{
  writable: PlannedPage[];
  refused: PlannedPage[];
  drafted: PlannedPage[];
}> {
  const allowed = new Set<string>();
  const drafting = new Set<string>();
  for (const type of new Set(changing.map(page => page.type))) {
    if (await keepsDrafts(engine.ctx, type)) drafting.add(type);
  }
  for (const type of new Set(changing.map(page => page.type))) {
    const ids = changing
      .filter(page => page.type === type)
      .map(page => page.id);
    for (const id of await engine.actor.writable(type, ids, locale)) {
      allowed.add(`${type}|${id}`);
    }
  }
  const may = (page: PlannedPage) => allowed.has(`${page.type}|${page.id}`);
  const left = changing.filter(page => !may(page));
  return {
    writable: changing.filter(may),
    refused: left.filter(page => !drafting.has(page.type)),
    drafted: left.filter(page => drafting.has(page.type)),
  };
}

/** Why a record or a page is passed over, in the report's words. */
const SKIPPED = {
  unmatched: "Not on this site.",
  ambiguous: "Matches more than one page here.",
  repeated: "Named more than once; the first is used.",
  refused: "You may not change this page's SEO.",
  drafted: "Its type keeps drafts: change its SEO in its own editor.",
  empty: "The source holds no value for this page.",
} as const;

/**
 * What the import does to each page it read, and each record it passed
 * over: what it sets, what is the same as automatic, what a person already
 * typed and keeps, and why one is skipped.
 */
function reportOf(
  planned: readonly PlannedPage[],
  skipped: Skipped,
  left: { refused: readonly PlannedPage[]; drafted: readonly PlannedPage[] }
): ImportReportEntry[] {
  const refused = new Set(left.refused);
  const drafted = new Set(left.drafted);
  const entry = (
    page: PlannedPage,
    outcome: ImportReportEntry["outcome"],
    reason?: string
  ): ImportReportEntry => ({
    type: page.type,
    id: page.id,
    label: page.label,
    outcome,
    set: outcome === "set" ? [...page.places] : [],
    same: [...page.same],
    kept: [...page.kept],
    ...(reason === undefined ? {} : { reason }),
  });
  const pages = planned.map(page => {
    if (refused.has(page)) return entry(page, "skipped", SKIPPED.refused);
    if (drafted.has(page)) return entry(page, "skipped", SKIPPED.drafted);
    if (page.places.length > 0) return entry(page, "set");
    if (page.kept.length > 0) return entry(page, "kept");
    if (page.same.length > 0) return entry(page, "same");
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
 * Each page's `seo` fields that hold a value its reader was not shown: read
 * as stored, and compared with the reader's own read, so where a field rule
 * hides a value, the place is known to be filled without the value itself
 * being read into the dry run.
 */
async function unreadableFields(
  ctx: PluginContext,
  pages: readonly ReadPage[],
  locale: string | undefined
): Promise<Map<string, Set<string>>> {
  const found = new Map<string, Set<string>>();
  for (const type of new Set(pages.map(page => page.type))) {
    const ofType = pages.filter(page => page.type === type);
    const stored = await readStored(
      ctx,
      type,
      ofType.map(page => page.id),
      asStored(locale)
    );
    for (const page of ofType) {
      const group = stored.get(page.id)?.[SEO_GROUP];
      if (!isRecord(group)) continue;
      const hidden = Object.keys(group).filter(
        name => filledValue(group[name]) && !(name in page.seo)
      );
      if (hidden.length > 0) found.set(`${type}|${page.id}`, new Set(hidden));
    }
  }
  return found;
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

/**
 * The import `args` asks for, worked out and changing nothing: what each
 * page would be set to, what each is left as and why, and the redirects it
 * adds. `applyImport` writes exactly this.
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
  const pages = await everyPage(engine, types, locale, rules);
  const defaultLanguage =
    locale ?? (await ctx.publicAddresses.defaultLanguage());
  const mapping = await mappingOf(ctx, args, types, pages);
  const parsed = parsedSource(source, mapping, pages, defaultLanguage);
  const unreadable = await unreadableFields(ctx, pages, locale);
  const own = source.kind === "group" && source.field === SEO_GROUP;
  const templates = templatesOf(rules);
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
    matcher(pages),
    (record, page) =>
      own
        ? tidyOwn(page, tally)
        : decide(
            record,
            page,
            templates,
            images,
            tally,
            origins,
            unreadable.get(`${page.type}|${page.id}`) ?? new Set()
          )
  );
  const {
    writable: changing,
    refused: notYours,
    drafted,
  } = await writableOf(
    engine,
    matched.planned.filter(page => page.places.length > 0),
    locale
  );
  // Not looked for, so not said to be missing from the library either.
  if (!mayReadMedia) tally.missingImages = 0;
  const warnings = [...parsed.warnings, ...warningsOf(matched.skipped, tally)];
  if (!mayReadMedia && urls.length > 0) {
    warnings.push(
      "You may not read the media library, so the share images in the file can't be matched to it."
    );
  }
  if (notYours.length > 0) {
    warnings.push(
      `${count(notYours.length, "page")} would change, but you may not change ${either(notYours.length, "its", "their")} SEO, so ${either(notYours.length, "it is", "they are")} left out: ${someOf(notYours.map(page => page.label))}.`
    );
  }
  if (drafted.length > 0) {
    warnings.push(
      `${count(drafted.length, "page")} would change, but ${either(drafted.length, "its type keeps", "their types keep")} drafts, so ${either(drafted.length, "its", "their")} SEO is changed in ${either(drafted.length, "its", "each page's")} own editor and ${either(drafted.length, "it is", "they are")} left out: ${someOf(drafted.map(page => page.label))}.`
    );
  }
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
      checked: source.kind === "group" ? pages.length : parsed.records.length,
      fromFile: source.kind !== "group",
      lines: linesOf(changing, parsed.from),
      pages: changing.length,
      same: tally.same,
      kept: tally.kept,
      redirects: kept.length,
      left: parsed.left,
      warnings,
      documents: reportOf(matched.planned, matched.skipped, {
        refused: notYours,
        drafted,
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

/**
 * Write every page's changes and add every redirect on `transaction`. Any
 * refusal is thrown, which undoes everything written before it.
 */
async function writeAll(
  transaction: Transaction,
  plan: ImportPlan,
  stored: ReadonlyMap<string, Record<string, unknown>>
): Promise<void> {
  const { ctx, actor } = plan.engine;
  // Written as the actor, in the language the import was asked for.
  const { locale } = plan.args;
  const as = { ...actor.as, ...(locale === undefined ? {} : { locale }) };
  for (const page of plan.pages) {
    // A Single's page is written before the transaction (`writeSingles`).
    if (pageTypeOf(page.type).kind === "single") continue;
    // Written over the group as stored, every value the person may not
    // read kept as it was.
    const group = stored.get(`${page.type}|${page.id}`)?.[SEO_GROUP];
    try {
      await ctx.services.collections.updateEntryInTransaction(
        transaction,
        page.type,
        page.id,
        {
          [SEO_GROUP]: seoWith(group, page.writes),
          ...(page.rev === undefined
            ? { _overwrite: true }
            : { _rev: page.rev }),
        },
        as
      );
      await refuseIfNotStored(
        ctx,
        transaction,
        { type: page.type, id: page.id, locale: plan.locale },
        page.writes
      );
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

/** A Single's page as written, with its group as it was stored before. */
interface WrittenSingle {
  type: string;
  before: unknown;
  rev: string | undefined;
}

/** Put each written Single back as it was, newest first. */
async function restoreSingles(
  ctx: PluginContext,
  written: readonly WrittenSingle[],
  locale: string
): Promise<void> {
  for (const single of [...written].reverse()) {
    try {
      await restoreSingleSeo(
        pageTypeOf(single.type).slug,
        locale,
        single.before,
        single.rev
      );
    } catch (error) {
      // Logged rather than thrown, so the refusal that undid the import is
      // the one the person reads.
      ctx.logger.error("An imported Single could not be put back", {
        error,
        single: single.type,
      });
    }
  }
}

/**
 * Write each Single's page of `plan` as its own step, and answer what was
 * written; where one is refused, those already written are put back and the
 * refusal is thrown.
 */
async function writeSingles(
  plan: ImportPlan,
  stored: ReadonlyMap<string, Record<string, unknown>>
): Promise<WrittenSingle[]> {
  const { ctx, actor } = plan.engine;
  const written: WrittenSingle[] = [];
  for (const page of plan.pages) {
    if (pageTypeOf(page.type).kind !== "single") continue;
    const entry = stored.get(`${page.type}|${page.id}`) ?? {};
    try {
      const rev = await saveSingleSeo(
        actor.single,
        { type: page.type, id: page.id, label: page.label, rev: page.rev },
        entry,
        page.writes,
        plan.locale
      );
      written.push({ type: page.type, before: entry[SEO_GROUP], rev });
    } catch (error) {
      await restoreSingles(ctx, written, plan.locale);
      throw error;
    }
  }
  return written;
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
 * Write what `plan` worked out: in one transaction, in full or not at all,
 * each Single's page a step of its own before it, put back where a later
 * step is refused. Each write names the version its page was read at, so a
 * page changed since the plan is refused rather than written over. Applied
 * again, a plan worked out again sets nothing: every place it filled is
 * filled.
 */
export async function applyImport(
  plan: ImportPlan
): Promise<{ pages: number; redirects: number }> {
  const { ctx, setup } = plan.engine;
  // The groups as stored, read before the transaction so it holds no lock
  // on the rows it then writes; each write sends its page's version, which
  // refuses it where the page changed since.
  const stored = new Map<string, Record<string, unknown>>();
  for (const type of new Set(plan.pages.map(page => page.type))) {
    const ids = plan.pages
      .filter(page => page.type === type)
      .map(page => page.id);
    for (const [id, entry] of await readStored(
      ctx,
      type,
      ids,
      asStored(plan.locale)
    )) {
      stored.set(`${type}|${id}`, entry);
    }
    if (pageTypeOf(type).kind === "collection") {
      await ctx.services.collections.warmLocalizedReadiness(type);
    }
  }
  const singles = await writeSingles(plan, stored);
  try {
    await ctx.services.collections.withTransaction(transaction =>
      writeAll(transaction, plan, stored)
    );
  } catch (error) {
    await restoreSingles(ctx, singles, plan.locale);
    throw error;
  }
  // Committed: each changed page is checked again for the problem list.
  for (const page of plan.pages) {
    recheckSaved(ctx, setup.checks, page.type, page.id);
  }
  await recordImport(ctx);
  return { pages: plan.pages.length, redirects: plan.redirects.length };
}
