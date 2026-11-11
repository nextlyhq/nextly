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
 *
 * @module import/plan
 */
import { createHash } from "node:crypto";

import {
  NextlyError,
  type ParticipantTransaction,
  type PluginContext,
  type PluginRouteContext,
  type ServiceOpts,
} from "@nextlyhq/plugin-sdk";

import {
  keepsDrafts,
  readEveryPage,
  typeNamesOf,
  type ReadPage,
} from "../bulk/pages";
import {
  asStored,
  refusalAbout,
  refuseDroppedValues,
  seoWith,
  storedPages,
  writablePages,
} from "../bulk/route";
import { productionAddressesOf, typedCanonical } from "../canonical";
import { isRecord } from "../plain-values";
import { recheckSaved, type ProblemChecks } from "../problems/check";
import { putRedirect } from "../redirects/store";
import { resolveOrder } from "../resolver/order";
import type { SiteRules } from "../resolver/page-levels";
import type { ReadRules } from "../resolver/provider";
import { SEPARATORS } from "../settings/patterns";
import { SEO_GROUP, typedPageLevel } from "../tab/typed";

import type {
  DryRunBody,
  ImportGroup,
  ImportRequest,
  ImportTarget,
} from "./contract";
import { readRankMathCsv } from "./csv";
import { groupsOf, OWN_FIELDS, readGroup } from "./group";
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
  /** The collections the plugin adds SEO to. */
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
}

/** One redirect the import adds. */
export interface PlannedRedirect {
  source: string;
  target: string;
  permanent: boolean;
}

/** An import worked out. */
export interface ImportPlan {
  body: DryRunBody;
  pages: PlannedPage[];
  redirects: PlannedRedirect[];
  locale: string;
}

/** The pages of the types SEO is added to that the caller may read. */
async function readableTypes(
  ctx: PluginRouteContext,
  targets: readonly string[]
): Promise<string[]> {
  const caller = ctx.caller;
  if (caller === null) throw NextlyError.authRequired();
  const readable: string[] = [];
  for (const slug of targets) {
    if (await caller.can("read", slug)) readable.push(slug);
  }
  return readable;
}

/** Every page of `types`, read as `as` in `locale`. */
async function everyPage(
  ctx: PluginContext,
  types: readonly string[],
  as: ServiceOpts,
  locale: string | undefined,
  rules: SiteRules
): Promise<ReadPage[]> {
  const pages: ReadPage[] = [];
  for (const slug of types) {
    pages.push(
      ...(await readEveryPage(ctx, slug, {
        as,
        ...(locale === undefined ? {} : { locale }),
        rules,
      }))
    );
  }
  return pages;
}

/** Each type's declared fields, read from its stored definition. */
async function typeFields(
  ctx: PluginContext,
  types: readonly string[]
): Promise<{ slug: string; label: string; fields: unknown }[]> {
  const answer: { slug: string; label: string; fields: unknown }[] = [];
  for (const slug of types) {
    const collection = await ctx.services.collections.getCollection(slug, {});
    answer.push({
      slug,
      label: typeNamesOf(ctx, slug).label,
      fields: collection.schemaDefinition.fields,
    });
  }
  return answer;
}

/** The groups the caller's readable types hold, for the import panel. */
export async function importGroups(
  ctx: PluginRouteContext,
  setup: ImportSetup,
  as: ServiceOpts,
  locale: string | undefined
): Promise<ImportGroup[]> {
  const types = await readableTypes(ctx, setup.targets);
  const rules = await setup.readRules(ctx, locale);
  const pages = await everyPage(ctx, types, as, locale, rules);
  return groupsOf(ctx, await typeFields(ctx, types), pages);
}

/** The separator the site's titles use, from its default title pattern. */
function separatorOf(rules: SiteRules): string {
  const pattern = rules.defaultPatterns?.title ?? "";
  return SEPARATORS.find(each => pattern.includes(` ${each} `)) ?? "|";
}

/** The source's records, read from the request. */
function parsedSource(
  request: ImportRequest,
  pages: readonly ReadPage[],
  language: string
): ParsedSource {
  const { source } = request;
  switch (source.kind) {
    case "group":
      return readGroup(
        pages,
        source.field,
        source.field === SEO_GROUP ? OWN_FIELDS : source.map
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
  request: ImportRequest,
  pages: readonly PlannedPage[],
  redirects: readonly PlannedRedirect[]
): string {
  const hash = createHash("sha256");
  hash.update(JSON.stringify({ locale: request.locale ?? null }));
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

/** One page's writes, and the places they fill. */
interface Decision {
  writes: Record<string, unknown>;
  places: ImportTarget[];
}

/** What deciding one record's values needs about its page. */
interface Deciding {
  /** The site's own origins, a canonical on which names the page itself. */
  origins: readonly string[];
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

/** Write `value` into `place`, unless it is typed already or is automatic. */
function decideText(at: Deciding, place: (typeof TEXT_PLACES)[number]): void {
  const raw = at.record.values[place];
  if (raw === undefined) return;
  const value = fillTemplate(raw, at.record.variables, {
    ...at.templates,
    title: at.record.sourceTitle ?? at.page.label,
  });
  if (value === undefined) {
    at.tally.unfilled++;
    return;
  }
  const current = textValue(at.page.seo[STORED[place]]);
  if (current !== undefined) {
    if (!same(current, value)) at.tally.kept++;
    return;
  }
  const automatic =
    place === "canonical"
      ? ownAddress(value, at.page, at.origins)
      : same(value, automaticFor(place, at.page, at.decision.writes));
  if (automatic) {
    at.tally.same++;
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
  const current = chosenImage(at.page.seo[STORED.image]);
  if (current !== undefined) {
    if (current !== id) at.tally.kept++;
    return;
  }
  at.decision.writes[STORED.image] = id;
  at.decision.places.push("image");
}

/** Hide the page where the source hid it; a page a person hid stays hidden. */
function decideHidden(at: Deciding): void {
  const hidden = at.record.values.hidden;
  const current = at.page.seo[STORED.hidden] === true;
  if (hidden === true && !current) {
    at.decision.writes[STORED.hidden] = true;
    at.decision.places.push("hidden");
  } else if (hidden === false && current) {
    at.tally.kept++;
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
  origins: readonly string[]
): Decision {
  const at: Deciding = {
    origins,
    record,
    page,
    templates,
    tally,
    decision: { writes: {}, places: [] },
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
  const writes: Record<string, unknown> = {};
  const places: ImportTarget[] = [];
  for (const place of ["title", "description"] as const) {
    const current = textValue(page.seo[STORED[place]]);
    if (current !== undefined && same(current, page.auto[place])) {
      writes[STORED[place]] = "";
      places.push(place);
      tally.same++;
    }
  }
  return { writes, places };
}

/**
 * The redirects the redirect rules would refuse, each with why: tried in
 * turn on a transaction that is then undone, so trying changes nothing.
 */
async function refusedRedirects(
  ctx: PluginContext,
  locale: string,
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
          locale,
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
  source: ImportRequest["source"]
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
  redirectsFromPages: number;
  redirectsWithoutAddress: number;
}

/** Every record matched and decided: the pages' changes and the redirects. */
interface Matched {
  planned: PlannedPage[];
  redirects: PlannedRedirect[];
  skipped: Skipped;
}

/**
 * A record's redirect, where it asks for one that can be added: from an
 * address no page here holds. Where it cannot, why is counted.
 */
function redirectOf(
  record: ImportedRecord,
  page: ReadPage | "ambiguous" | undefined,
  skipped: Skipped
): PlannedRedirect | undefined {
  if (record.redirect === undefined) return undefined;
  if (page !== undefined) {
    skipped.redirectsFromPages++;
    return undefined;
  }
  if (record.match.path === undefined) {
    skipped.redirectsWithoutAddress++;
    return undefined;
  }
  return {
    source: record.match.path,
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
    redirectsFromPages: 0,
    redirectsWithoutAddress: 0,
  };
  const planned = new Map<string, PlannedPage>();
  const redirects: PlannedRedirect[] = [];
  for (const record of records) {
    const page = find(record);
    const redirect = redirectOf(record, page, skipped);
    if (redirect !== undefined) redirects.push(redirect);
    else if (page === undefined) {
      if (record.match.page === undefined) skipped.unmatched.push(record.label);
    } else if (page === "ambiguous") skipped.ambiguous.push(record.label);
    else if (planned.has(`${page.type}|${page.id}`)) {
      skipped.repeated.push(record.label);
    } else {
      const { writes, places } = decideFor(record, page);
      planned.set(`${page.type}|${page.id}`, {
        type: page.type,
        id: page.id,
        label: page.label,
        ...(page.rev === undefined ? {} : { rev: page.rev }),
        writes,
        seo: page.seo,
        places,
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
      skipped.redirectsFromPages,
      n =>
        `${count(n, "redirect")} start at a page that is on this site, so ${either(n, "it is", "they are")} left out.`,
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
  ctx: PluginRouteContext,
  changing: readonly PlannedPage[],
  options: { locale: string | undefined; pagePermissions: boolean }
): Promise<{ writable: PlannedPage[]; refused: string[]; drafted: string[] }> {
  const allowed = new Set<string>();
  const drafting = new Set(
    changing.map(page => page.type).filter(type => keepsDrafts(ctx, type))
  );
  for (const type of new Set(changing.map(page => page.type))) {
    const ids = changing
      .filter(page => page.type === type)
      .map(page => page.id);
    for (const id of await writablePages(ctx, type, ids, options)) {
      allowed.add(`${type}|${id}`);
    }
  }
  const may = (page: PlannedPage) => allowed.has(`${page.type}|${page.id}`);
  const left = changing.filter(page => !may(page));
  return {
    writable: changing.filter(may),
    refused: left
      .filter(page => !drafting.has(page.type))
      .map(page => page.label),
    drafted: left
      .filter(page => drafting.has(page.type))
      .map(page => page.label),
  };
}

/** The import worked out, changing nothing. */
export async function planImport(
  ctx: PluginRouteContext,
  setup: ImportSetup,
  request: ImportRequest,
  as: ServiceOpts
): Promise<ImportPlan> {
  const locale = request.locale ?? undefined;
  const rules = await setup.readRules(ctx, locale);
  const { source } = request;
  const types = await sourceTypes(
    ctx,
    await readableTypes(ctx, setup.targets),
    source
  );
  const pages = await everyPage(ctx, types, as, locale, rules);
  const defaultLanguage =
    locale ?? (await ctx.publicAddresses.defaultLanguage());
  const parsed = parsedSource(request, pages, defaultLanguage);
  const own = source.kind === "group" && source.field === SEO_GROUP;
  const templates = templatesOf(rules);
  const origins = productionAddressesOf(rules.productionAddresses);
  const images = await mediaIds(ctx, imageUrls(parsed.records));
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
        : decide(record, page, templates, images, tally, origins)
  );
  const {
    writable: changing,
    refused: notYours,
    drafted,
  } = await writableOf(
    ctx,
    matched.planned.filter(page => page.places.length > 0),
    { locale, pagePermissions: setup.pagePermissions }
  );
  const warnings = [...parsed.warnings, ...warningsOf(matched.skipped, tally)];
  if (notYours.length > 0) {
    warnings.push(
      `${count(notYours.length, "page")} would change, but you may not change ${either(notYours.length, "its", "their")} SEO, so ${either(notYours.length, "it is", "they are")} left out: ${someOf(notYours)}.`
    );
  }
  if (drafted.length > 0) {
    warnings.push(
      `${count(drafted.length, "page")} would change, but ${either(drafted.length, "its type keeps", "their types keep")} drafts, so ${either(drafted.length, "its", "their")} SEO is changed in ${either(drafted.length, "its", "each page's")} own editor and ${either(drafted.length, "it is", "they are")} left out: ${someOf(drafted)}.`
    );
  }
  const refused = await refusedRedirects(
    ctx,
    defaultLanguage,
    matched.redirects
  );
  for (const [redirect, why] of refused) {
    warnings.push(`The redirect from ${redirect.source} is left out: ${why}`);
  }
  const kept = matched.redirects.filter(redirect => !refused.has(redirect));
  return {
    pages: changing,
    redirects: kept,
    locale: defaultLanguage,
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
      plan: planDigest(request, changing, kept),
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
  ctx: PluginRouteContext,
  transaction: Transaction,
  plan: ImportPlan,
  as: ServiceOpts
): Promise<void> {
  const stored = new Map<string, Record<string, unknown>>();
  for (const type of new Set(plan.pages.map(page => page.type))) {
    const ids = plan.pages
      .filter(page => page.type === type)
      .map(page => page.id);
    const read = await storedPages(
      ctx,
      transaction,
      type,
      ids,
      asStored(plan.locale)
    );
    for (const [id, entry] of read) stored.set(`${type}|${id}`, entry);
  }
  for (const page of plan.pages) {
    // Written over the group as stored, every value the person may not
    // read kept as it was.
    const group = stored.get(`${page.type}|${page.id}`)?.[SEO_GROUP];
    try {
      const saved = await ctx.services.collections.updateEntryInTransaction(
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
      refuseDroppedValues(saved, page.writes, page.label);
    } catch (error) {
      throw refusalAbout(error, page.label);
    }
  }
  for (const redirect of plan.redirects) {
    const outcome = await putRedirect(ctx, transaction, {
      locale: plan.locale,
      source: redirect.source,
      target: redirect.target,
      permanent: redirect.permanent,
      origin: "import",
      addedBy: ctx.user?.id ?? null,
    });
    if ("refused" in outcome) throw redirectRefusal(redirect, outcome.refused);
  }
}

/**
 * Apply the import the dry run `digest` showed: in one transaction, in full
 * or not at all. Refused, with nothing changed, where the import worked out
 * now is not that one.
 */
export async function applyImport(
  ctx: PluginRouteContext,
  setup: ImportSetup,
  request: ImportRequest,
  digest: string,
  as: ServiceOpts
): Promise<{ pages: number; redirects: number }> {
  const plan = await planImport(ctx, setup, request, as);
  if (plan.body.plan !== digest) {
    throw NextlyError.conflict({
      reason: "state",
      message:
        "Pages have changed since the dry run, so it no longer shows what would happen. Nothing was imported. Do the dry run again.",
    });
  }
  for (const type of new Set(plan.pages.map(page => page.type))) {
    await ctx.services.collections.warmLocalizedReadiness(type);
  }
  await ctx.services.collections.withTransaction(transaction =>
    writeAll(ctx, transaction, plan, as)
  );
  // Committed: each changed page is checked again for the problem list.
  for (const page of plan.pages) {
    recheckSaved(ctx, setup.checks, page.type, page.id);
  }
  return { pages: plan.pages.length, redirects: plan.redirects.length };
}
