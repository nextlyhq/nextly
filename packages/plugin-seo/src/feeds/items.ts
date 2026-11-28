/**
 * What a feed holds: the newest pages of its collections the public may read,
 * and the items its code sources give, newest first, as many as it holds.
 *
 * A collection's pages are the ones the sitemap lists, read from the one
 * listing (published, not hidden from search, their own canonical, holding
 * their address), in the site's own language, and of those only the ones a
 * visitor with no session may read, read as that visitor reads them, so no
 * item holds a word the public may not read. Each is named and described as
 * llms.txt names and describes it: by its own name, and its head's
 * description.
 *
 * @module feeds/items
 */
import type { PageMetadataInput, PluginContext } from "@nextlyhq/plugin-sdk";

import { onceEach } from "../languages/versions";
import {
  listedName,
  publicDocuments,
  publicHeads,
  readingKey,
} from "../outputs/ai-outputs";
import { listPages, type ListedPage } from "../outputs/listing";
import type { ReadRules } from "../resolver/provider";
import type {
  DetailMapping,
  ReadStructuredDataRules,
  StructuredDataTypeRule,
} from "../structured-data/rules";
import {
  dateOf,
  namedOf,
  namesOf,
  readDetail,
} from "../structured-data/values";

import type { CheckedFeed, FeedItem } from "./options";
import type { RssItem } from "./rss";

/** What a feed's items are read with. */
export interface FeedReading {
  /** The site's origin, every address made whole against it. */
  origin: string;
  readRules: ReadRules;
  /** Structured data's rules, for the fields a type names its dates, author and tags in. */
  readStructuredDataRules?: ReadStructuredDataRules;
}

/** An item as the feed holds it, with when it last changed. */
export interface HeldItem extends RssItem {
  /** When it last changed, where that is known: its content's last change, or what its source says. */
  updated?: Date;
}

/** One page of a collection the feed may hold, before it is named. */
interface EntryCandidate {
  kind: "entry";
  page: ListedPage;
  document: Record<string, unknown>;
  published?: Date;
  updated?: Date;
}

/** One item a code source gave, checked. */
interface CodeCandidate {
  kind: "code";
  item: HeldItem;
  published?: Date;
}

type Candidate = EntryCandidate | CodeCandidate;

/** A value as a date, where it is one. */
function asDate(value: unknown): Date | undefined {
  const text = value instanceof Date ? value.toISOString() : dateOf(value);
  if (text === undefined) return undefined;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * The fields a content type's structured data reads each detail from: the
 * mapping for the type its pages are described as, else the first it
 * names, else none, so each detail is read from the field named like it.
 */
function mappingOf(rule: StructuredDataTypeRule | undefined): DetailMapping {
  const details = rule?.details ?? {};
  const chosen = rule?.type === undefined ? undefined : details[rule.type];
  return chosen ?? Object.values(details)[0] ?? {};
}

/**
 * When a page was published: the field its type names for it, or the first
 * named like it (`publishedAt`), else when it was first published, else
 * when it was made.
 */
function publishedOf(
  document: Readonly<Record<string, unknown>>,
  mapping: DetailMapping
): Date | undefined {
  return (
    asDate(
      readDetail(document, "datePublished", mapping.datePublished).value
    ) ??
    asDate(document.firstPublishedAt) ??
    asDate(document.createdAt)
  );
}

/** Text that reads as an email address, which a feed never names anyone by. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A page's address as the site serves it, whole, where it is an http(s) one. */
function wholeAddress(url: string, origin: string): string | undefined {
  try {
    const address = new URL(url, `${origin}/`);
    return address.protocol === "http:" || address.protocol === "https:"
      ? address.href
      : undefined;
  } catch {
    return undefined;
  }
}

/** The text of a value, trimmed, where it holds any. */
const textIn = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

/**
 * One item a code source gave, as the feed holds it; none where it lacks an
 * id, a title, an address or a date it was published, which is logged.
 */
function codeItemOf(
  ctx: PluginContext,
  feed: CheckedFeed,
  item: FeedItem,
  origin: string
): CodeCandidate | undefined {
  const id = textIn(item.id);
  const title = textIn(item.title);
  const link =
    typeof item.url === "string" ? wholeAddress(item.url, origin) : undefined;
  const published = asDate(item.published);
  if (
    id === undefined ||
    title === undefined ||
    link === undefined ||
    published === undefined
  ) {
    ctx.logger.warn(
      "A feed's code source gave an item without an id, a title, an address or a date it was published; it is left out",
      { feed: feed.name, id: item.id }
    );
    return undefined;
  }
  const updated = asDate(item.updated);
  const description = textIn(item.description);
  const author = textIn(item.author);
  const categories = (item.categories ?? []).flatMap(category => {
    const name = textIn(category);
    return name === undefined ? [] : [name];
  });
  return {
    kind: "code",
    published,
    item: {
      title,
      link,
      // The site's origin and the source's own id: the same item keeps it
      // whatever its address becomes.
      guid: `${origin}#${id}`,
      published,
      ...(updated === undefined ? {} : { updated }),
      ...(description === undefined ? {} : { description }),
      ...(author === undefined || EMAIL.test(author) ? {} : { author }),
      ...(categories.length === 0
        ? {}
        : { categories: [...new Set(categories)] }),
    },
  };
}

/** The items every code source of `feed` gives; a source that fails is logged, and gives none. */
async function codeCandidates(
  ctx: PluginContext,
  feed: CheckedFeed,
  origin: string
): Promise<CodeCandidate[]> {
  const found: CodeCandidate[] = [];
  for (const source of feed.code) {
    let items: readonly FeedItem[];
    try {
      items = await source({ origin });
    } catch (error) {
      ctx.logger.warn("A feed's code source failed; its items are left out", {
        feed: feed.name,
        error,
      });
      continue;
    }
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const checked = codeItemOf(ctx, feed, item, origin);
      if (checked !== undefined) found.push(checked);
    }
  }
  return found;
}

/**
 * The pages of `feed`'s collections the public may read, in the site's own
 * language, each with the published document a visitor reads and its dates.
 */
async function entryCandidates(
  ctx: PluginContext,
  feed: CheckedFeed,
  reading: FeedReading & { readRules: ReadRules }
): Promise<{
  candidates: EntryCandidate[];
  readable: Map<string, Record<string, unknown>>;
}> {
  if (feed.collections.length === 0) {
    return { candidates: [], readable: new Map() };
  }
  const language = await ctx.publicAddresses.defaultLanguage();
  const { pages } = await listPages(ctx, {
    origin: reading.origin,
    readRules: reading.readRules,
    collections: feed.collections,
  });
  // The listing lists every Single and every language too: only the
  // feed's collections, in the site's own language, so a translated page
  // is one item.
  const own = pages.filter(
    page =>
      feed.collections.includes(page.holder.collection) &&
      page.language === language
  );
  const readable = await publicDocuments(own);
  const rules = await reading.readStructuredDataRules?.(ctx, language);
  const candidates: EntryCandidate[] = [];
  for (const page of own) {
    const document = readable.get(readingKey(page));
    // A page the public may not read is no item: a feed is read by anyone.
    if (document === undefined) continue;
    const published = publishedOf(
      document,
      mappingOf(rules?.types[page.holder.collection])
    );
    const updated = asDate(page.lastModified);
    candidates.push({
      kind: "entry",
      page,
      document,
      ...(published === undefined ? {} : { published }),
      ...(updated === undefined ? {} : { updated }),
    });
  }
  return { candidates, readable };
}

/** Newest first; one with no date after every dated one; the same date by address. */
function newestFirst(a: Candidate, b: Candidate): number {
  const at = (candidate: Candidate) =>
    candidate.published?.getTime() ?? -Infinity;
  const order = at(b) - at(a);
  if (order !== 0 && !Number.isNaN(order)) return order;
  const link = (candidate: Candidate) =>
    candidate.kind === "entry" ? candidate.page.loc : candidate.item.link;
  return link(a).localeCompare(link(b));
}

/** The author and the categories a page names, by name, as structured data reads them. */
async function creditsOf(
  ctx: PluginContext,
  candidate: EntryCandidate,
  mapping: DetailMapping,
  origin: string
): Promise<{ author?: string; categories: string[] }> {
  const { page, document } = candidate;
  const input: PageMetadataInput = {
    source: {
      kind: "entry",
      collection: page.holder.collection,
      entry: document,
    },
    locale: page.language,
    code: {},
    derived: {},
  };
  const named = await namedOf(
    ctx,
    input,
    readDetail(document, "author", mapping.author),
    origin
  );
  const sections = await namesOf(
    ctx,
    input,
    readDetail(document, "articleSection", mapping.articleSection)
  );
  const tags = await namesOf(
    ctx,
    input,
    readDetail(document, "keywords", mapping.keywords)
  );
  const author = named?.name;
  return {
    ...(author === undefined || EMAIL.test(author) ? {} : { author }),
    categories: [...new Set([...sections, ...tags])],
  };
}

/**
 * The items `feed` holds, newest first, at most its limit: its collections'
 * pages and its code sources' items together, so the newest of all of them
 * are the ones held. Only the pages held are named, so a long collection is
 * read once and named no further than the feed goes.
 */
export async function feedItemsOf(
  ctx: PluginContext,
  feed: CheckedFeed,
  reading: FeedReading
): Promise<HeldItem[]> {
  // The site's rules read once per language for the whole feed.
  const readRules = onceEach(reading.readRules);
  const { origin } = reading;
  const entries = await entryCandidates(ctx, feed, { ...reading, readRules });
  const all: Candidate[] = [
    ...entries.candidates,
    ...(await codeCandidates(ctx, feed, origin)),
  ];
  const held = all.sort(newestFirst).slice(0, feed.limit);
  const pages = held.flatMap(candidate =>
    candidate.kind === "entry" ? [candidate.page] : []
  );
  const heads = await publicHeads(ctx, pages, entries.readable, readRules);
  const language = await ctx.publicAddresses.defaultLanguage();
  const rules = await reading.readStructuredDataRules?.(ctx, language);
  const items: HeldItem[] = [];
  let at = 0;
  for (const candidate of held) {
    if (candidate.kind === "code") {
      items.push(candidate.item);
      continue;
    }
    const { page } = candidate;
    const head = heads.get(at) ?? {};
    at += 1;
    const credits = await creditsOf(
      ctx,
      candidate,
      mappingOf(rules?.types[page.holder.collection]),
      origin
    );
    items.push({
      title: listedName(head) ?? page.path,
      link: page.loc,
      // The site's origin, the collection and the entry's id: the same page
      // keeps it after its slug changes, so readers never show it twice.
      guid: `${origin}#${page.holder.collection}:${page.holder.id}`,
      ...(candidate.published === undefined
        ? {}
        : { published: candidate.published }),
      ...(candidate.updated === undefined
        ? {}
        : { updated: candidate.updated }),
      ...(head.description === undefined
        ? {}
        : { description: head.description }),
      ...(credits.author === undefined ? {} : { author: credits.author }),
      ...(credits.categories.length === 0
        ? {}
        : { categories: credits.categories }),
    });
  }
  return items;
}
