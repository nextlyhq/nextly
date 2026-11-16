/**
 * A page's language versions: which languages it is published in, as the
 * address record holds them, its document as each language serves it, and
 * whether each version stands for itself in search.
 *
 * The record is the one answer to where a page is published: core tells it,
 * on every save, the address a document holds in each language it is
 * published in, and nothing in a language where it is a draft or was never
 * translated into one that publishes on its own. The head's language links
 * and the sitemap read it here.
 *
 * @module languages/versions
 */
import {
  getCachedNextly,
  languageAddressOf,
  NextlyError,
  type PluginContext,
  type PublicAddressType,
} from "@nextlyhq/plugin-sdk";

import { addressesOf } from "../address-record/store";
import { originOf } from "../origin";
import type { SeoAnswer } from "../resolver/order";
import { resolveSeo, type ReadRules } from "../resolver/provider";
import { MAX_LOC_LENGTH, publishedWhere } from "../sitemap";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * `address` resolved against `origin` into an absolute address, or null where
 * it is not a web address at all. Resolution only: whether a canonical is
 * usable is the answer's to say, and it is taken as answered.
 */
export function absolute(address: string, origin: string): string | null {
  try {
    const url = new URL(address, origin);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/**
 * `path` as the language `locale` serves it, root-relative or on that
 * language's own domain; `path` itself on a site with no languages.
 */
export async function servedAt(
  path: string,
  locale: string
): Promise<string | undefined> {
  const served = await languageAddressOf(path, locale);
  return served.status === "resolved"
    ? `${served.origin ?? ""}${served.path}`
    : undefined;
}

/** The paths a page holds, by language. */
export type HeldLanguages = Map<string, Set<string>>;

/**
 * The paths each of `ids` holds in the record, by id and then by language:
 * every language at once, so a page's versions cost one read for a whole
 * batch of pages.
 */
export async function heldLanguages(
  ctx: PluginContext,
  collection: string,
  ids: readonly string[]
): Promise<Map<string, HeldLanguages>> {
  const held = new Map<string, HeldLanguages>();
  for (const row of await addressesOf(ctx, collection, ids)) {
    if (row.holder === null || row.address === null) continue;
    const languages = held.get(row.holder.id) ?? new Map();
    const paths = languages.get(row.address.locale) ?? new Set<string>();
    paths.add(row.address.path);
    languages.set(row.address.locale, paths);
    held.set(row.holder.id, languages);
  }
  return held;
}

/**
 * The languages of `held` other than `defaultLanguage`, in one order: the
 * same for every page, so every output names a page's versions alike.
 */
export function otherLanguages(
  held: Iterable<HeldLanguages>,
  defaultLanguage: string
): string[] {
  const languages = new Set<string>();
  for (const page of held) {
    for (const language of page.keys()) languages.add(language);
  }
  languages.delete(defaultLanguage);
  return [...languages].sort();
}

/**
 * A Single's published document as `locale` serves it, or null where it has
 * none.
 */
export async function singleIn(
  slug: string,
  locale: string | undefined
): Promise<Record<string, unknown> | null> {
  const nextly = await getCachedNextly();
  try {
    const document: unknown = await nextly.findSingle({
      slug,
      createIfMissing: false,
      overrideAccess: true,
      // Published values only, as a visitor is served them: a draft, and a
      // Single a release has withdrawn, are no page.
      status: "published",
      depth: 1,
      ...(locale === undefined ? {} : { locale }),
    });
    return isRecord(document) ? document : null;
  } catch (error) {
    // A Single never published is not found by a read of published values.
    if (NextlyError.isCode(error, "NOT_FOUND")) return null;
    throw error;
  }
}

/**
 * The published documents of `ids`, of one type, as `locale` serves them, by
 * id: one read for them all. A field the language has no translation of is
 * the value a visitor of that language is served instead.
 */
export async function documentsIn(
  ctx: PluginContext,
  type: PublicAddressType,
  ids: readonly string[],
  locale: string
): Promise<Map<string, Record<string, unknown>>> {
  const found = new Map<string, Record<string, unknown>>();
  if (ids.length === 0) return found;
  if (type.kind === "single") {
    const document = await singleIn(type.slug, locale);
    if (document !== null && ids.includes(String(document.id))) {
      found.set(String(document.id), document);
    }
    return found;
  }
  const published = await publishedWhere(ctx.services, type.slug);
  const result = await ctx.services.collections.listEntries(
    type.slug,
    {
      where: {
        and: [{ id: { in: [...ids] } }, ...(published ? [published] : [])],
      },
      // Images populated, so a page's own is read with it, not looked up.
      depth: 1,
      pagination: { limit: ids.length, page: 1 },
    },
    { as: "system", locale }
  );
  const asked = new Set(ids);
  for (const document of (result.data as unknown[]).filter(isRecord)) {
    if (asked.has(String(document.id)))
      found.set(String(document.id), document);
  }
  return found;
}

/** `readRules`, read at most once for each language it is asked in. */
export function onceEach<T = Awaited<ReturnType<ReadRules>>>(
  readRules: (ctx: PluginContext, locale: string | undefined) => Promise<T>
): (ctx: PluginContext, locale: string | undefined) => Promise<T> {
  const read = new Map<string | undefined, Promise<T>>();
  return (ctx, locale) => {
    let rules = read.get(locale);
    if (rules === undefined) {
      rules = readRules(ctx, locale);
      read.set(locale, rules);
    }
    return rules;
  };
}

/**
 * The answer of a page's version in `language`, from its `document` as that
 * language serves it: what its head says, with no route's code or design,
 * since neither decides whether a page is listed or where its canonical is.
 */
export function resolveIn(
  ctx: PluginContext,
  type: PublicAddressType,
  document: Record<string, unknown>,
  language: string,
  readRules: ReadRules | undefined
): Promise<SeoAnswer> {
  return resolveSeo(
    ctx,
    {
      source:
        type.kind === "single"
          ? { kind: "single", slug: type.slug, document }
          : { kind: "entry", collection: type.slug, entry: document },
      code: {},
      derived: {},
      locale: language,
    },
    readRules
  );
}

/**
 * How a version of a page whose own address is `served` stands, from its
 * answer: at its canonical (`href`, as the answer gives it, or made absolute
 * where it is a path on a language's own domain, so a link from another
 * domain reaches it) and made absolute (`loc`), where it is listed and its
 * canonical is its own address; `lost` where it has no canonical, so another
 * page holds its address; null where it is hidden, names another page, or
 * names an address past the protocol's length.
 *
 * A path is read on the origin the version is served on: its language's own
 * domain where it has one, else `origin`.
 */
export function standingOf(
  answer: SeoAnswer,
  origin: string,
  served: string | undefined
): { href: string; loc: string } | "lost" | null {
  if (!answer.robots.value.index) return null;
  if (answer.canonical === undefined) return "lost";
  const domain = originOf(served);
  const base = domain ?? origin;
  const loc = absolute(answer.canonical.value, base);
  // A typed canonical is the page's own where it names the page's address as
  // the page's language serves it.
  const elsewhere =
    answer.canonical.from !== "address" &&
    (served === undefined || loc !== absolute(served, base));
  if (loc === null || elsewhere || loc.length > MAX_LOC_LENGTH) return null;
  const onItsDomain =
    domain !== undefined && originOf(answer.canonical.value) === undefined;
  return { href: onItsDomain ? loc : answer.canonical.value, loc };
}
