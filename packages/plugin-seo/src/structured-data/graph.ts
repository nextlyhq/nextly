/**
 * A page's structured data: the linked description of the site, the page and
 * what the page is about, worked out from the page's answer and its own
 * fields, with the problems that keep a chosen type out.
 *
 * Built from the answer the page's head is built from, so its title,
 * description, address and image are the head's. Every node names the others
 * by `@id`, so search engines read one connected description: the page is
 * part of the website, the website is published by the organisation, and the
 * article, product or event is the page's main subject.
 *
 * @module structured-data/graph
 */
import {
  addressOfRequest,
  entryDateFieldNames,
  languageAddressOf,
  NextlyError,
  type PageArticle,
  type PageMetadataAnswer,
  type PageMetadataImage,
  type PageMetadataInput,
  type PageStructuredDataHints,
  type PluginContext,
} from "@nextlyhq/plugin-sdk";

import { addressHolders } from "../address-record/participant";
import { codePagesSlug } from "../code-pages/collection";
import { nameOfAddress, readCodePage } from "../code-pages/store";
import { contentDateOf, lastChangedOf } from "../content-dates/last-changed";
import { originOf } from "../origin";
import { singleKey } from "../problems/page-types";
import { pageNameOf, titleSourcesOf } from "../resolver/own-name";
import { typeOf } from "../resolver/page-levels";

import {
  DETAIL_LABELS,
  ENTRY_DATE_DETAILS,
  isSaveStamp,
  isStructuredDataTypeKey,
  REVIEWED_ITEM_TYPES,
  STRUCTURED_DATA_TYPES,
  structuredDataTypesFor,
  type StructuredDataDetail,
  type StructuredDataTypeKey,
} from "./catalog";
import { absolute, linksOf, node } from "./node-parts";
import { peopleOf, personEntryNode, type People } from "./people";
import type {
  DetailMapping,
  StructuredDataDefaultAuthor,
  StructuredDataRules,
  StructuredDataTypeRule,
} from "./rules";
import {
  dateOf,
  heldUnread,
  isRecord,
  declaredFields,
  keepsDayAlone,
  namedOf,
  namesOf,
  numberOf,
  pictureOf,
  plainTextOf,
  questionsOf,
  readDetail,
  textOf,
  wordCountOf,
  type DetailRead,
  type Named,
  type Question,
} from "./values";

/** A JSON value, as a node holds it. */
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** One node of the page's graph. */
export type StructuredDataNode = { [key: string]: Json };

/** A detail a chosen type is missing, which keeps its markup out. */
export interface StructuredDataProblem {
  /** The type whose markup is left out. */
  type: StructuredDataTypeKey;
  /**
   * The detail it needs, the page's title every described thing is named
   * by, or the site's address every node needs.
   */
  detail: StructuredDataDetail | "title" | "siteAddress";
  /** What the problem list shows, such as `Missing: author.` */
  message: string;
  /**
   * Where it is fixed: on the page (`content`, the field is empty), in the
   * content type's mapping (`mapping`, no field holds it), by the route
   * (`route`, it reads the relationship holding it without the entry it
   * names, as at `depth: 0`), in the SEO settings (`settings`, the site's
   * address), or by saving or publishing the page (`save`, the field is one
   * of the entry's own dates, which Nextly sets and nobody types).
   */
  fix: "content" | "mapping" | "route" | "settings" | "save";
  /** The page's field the detail is read from, where one is. */
  field?: string;
}

/** How the type a page is described as was decided. */
export type StructuredDataChoice = "page" | "type" | "automatic";

/** A page's structured data, and what keeps any of it out. */
export interface PageStructuredData {
  /** The type the page is described as. */
  type: StructuredDataTypeKey;
  /** Whether the page chose it, its content type did, or it is automatic. */
  chosen: StructuredDataChoice;
  /** The types the page may choose from. */
  offered: readonly StructuredDataTypeKey[];
  nodes: StructuredDataNode[];
  problems: StructuredDataProblem[];
  /**
   * An article's details as its social card states them, derived from the
   * article's own markup: only where the page is described as an article
   * of any kind, with every detail it needs.
   */
  article?: PageArticle;
}

/** The document a page was resolved to, and its content type's key. */
function pageOf(input: PageMetadataInput): {
  key: string;
  document: Readonly<Record<string, unknown>>;
} {
  const { source } = input;
  return source.kind === "entry"
    ? { key: source.collection, document: source.entry }
    : { key: `single:${source.slug}`, document: source.document };
}

/** An image as structured data states it, at an absolute address. */
function imageNode(
  image: PageMetadataImage | undefined,
  origin: string
): StructuredDataNode | undefined {
  const url = image === undefined ? undefined : absolute(image.url, origin);
  if (url === undefined || image === undefined) return undefined;
  return node({
    "@type": "ImageObject",
    url,
    width: image.width,
    height: image.height,
    caption: image.alt,
  });
}

/**
 * A person, as an author or the subject of a profile: named by their own
 * page where they have one, so every page that names them names one person.
 */
function personNode(person: Named): StructuredDataNode {
  return node({
    "@type": "Person",
    "@id": person.url === undefined ? undefined : `${person.url}#person`,
    name: person.name,
    url: person.url,
    jobTitle: person.jobTitle,
  });
}

/** The kinds of stock a product's availability may name. */
const AVAILABILITY = [
  "InStock",
  "OutOfStock",
  "PreOrder",
  "PreSale",
  "BackOrder",
  "Discontinued",
  "LimitedAvailability",
  "OnlineOnly",
  "InStoreOnly",
  "SoldOut",
  "MadeToOrder",
  "Reserved",
] as const;

/** A product's availability as schema.org names it, from a field's value. */
function availabilityOf(value: unknown): string | undefined {
  if (typeof value === "boolean") {
    return `https://schema.org/${value ? "InStock" : "OutOfStock"}`;
  }
  const text = textOf(value)?.replace(/^https?:\/\/schema\.org\//, "");
  const key = text?.toLowerCase().replace(/[^a-z]/g, "");
  const known = AVAILABILITY.find(each => each.toLowerCase() === key);
  return known === undefined ? undefined : `https://schema.org/${known}`;
}

/** A street address as structured data states it, from text or a group. */
function postalAddressOf(value: unknown): StructuredDataNode | undefined {
  if (isRecord(value)) {
    const parts = node({
      "@type": "PostalAddress",
      streetAddress: textOf(value.streetAddress) ?? textOf(value.street),
      addressLocality: textOf(value.addressLocality) ?? textOf(value.city),
      addressRegion: textOf(value.addressRegion) ?? textOf(value.region),
      postalCode: textOf(value.postalCode),
      addressCountry: textOf(value.addressCountry) ?? textOf(value.country),
    });
    return parts.streetAddress === undefined ? undefined : parts;
  }
  const street = textOf(value);
  return street === undefined
    ? undefined
    : { "@type": "PostalAddress", streetAddress: street };
}

/** Where an event is held: a place's name and street address. */
function placeOf(value: unknown): StructuredDataNode | undefined {
  if (isRecord(value)) {
    const name = textOf(value.name) ?? textOf(value.title);
    const address = postalAddressOf(value.address ?? value);
    return name === undefined || address === undefined
      ? undefined
      : { "@type": "Place", name, address };
  }
  // Text alone is a name or an address, never both: a venue is stated only
  // where the page gives its name and its address apart.
  return undefined;
}

/** Opening hours as text (`Mo-Fr 09:00-17:00`), one or several. */
function openingHoursOf(value: unknown): Json | undefined {
  if (Array.isArray(value)) {
    const hours = value.map(textOf).filter(each => each !== undefined);
    return hours.length > 0 ? hours : undefined;
  }
  return textOf(value);
}

/**
 * A file's address: a media document's `url`, or text written as an address,
 * from the site's root or absolute. Other text, such as an upload read as its
 * id, addresses no file.
 */
function fileOf(value: unknown, origin: string): string | undefined {
  const url = isRecord(value) ? textOf(value.url) : textOf(value);
  if (url === undefined) return undefined;
  if (!isRecord(value) && !/^(\/|https?:\/\/)/i.test(url)) return undefined;
  return absolute(url, origin);
}

/** The top of the scale a page's ratings are given on: 5 unless it says. */
function scaleOf(facts: PageFacts): number {
  const read = readDetail(
    facts.document,
    "bestRating",
    facts.mapping.bestRating
  );
  return bestRatingOf(read.value) ?? 5;
}

/** The top of a rating scale: a number above 1. */
function bestRatingOf(value: unknown): number | undefined {
  const best = numberOf(value);
  return best !== undefined && best > 1 ? best : undefined;
}

/**
 * A rating on the page's scale, from 1 to its top: one off it would be read
 * as a different rating, since a rating with no scale is read out of 5.
 */
function ratingOf(facts: PageFacts, value: unknown): number | undefined {
  const rating = numberOf(value);
  return rating !== undefined && rating >= 1 && rating <= scaleOf(facts)
    ? rating
    : undefined;
}

/** A three-letter currency code, such as `USD`. */
function currencyOf(value: unknown): string | undefined {
  const code = textOf(value)?.toUpperCase();
  return code !== undefined && /^[A-Z]{3}$/.test(code) ? code : undefined;
}

/** A count of ratings: a whole number from 1. */
function countOf(value: unknown): number | undefined {
  const count = numberOf(value);
  return count !== undefined && Number.isInteger(count) && count >= 1
    ? count
    : undefined;
}

/** The kind of thing a review is about, as Google accepts it. */
function itemTypeOf(value: unknown): string | undefined {
  const key = textOf(value)
    ?.toLowerCase()
    .replace(/[^a-z]/g, "");
  return REVIEWED_ITEM_TYPES.find(each => each.toLowerCase() === key);
}

/** What one page's graph is worked out from. */
interface PageFacts {
  ctx: PluginContext;
  input: PageMetadataInput;
  answer: PageMetadataAnswer;
  document: Readonly<Record<string, unknown>>;
  origin: string;
  mapping: DetailMapping;
  /** The page's content type's rule, where the site gives one. */
  rule: StructuredDataTypeRule | undefined;
  rules: StructuredDataRules;
  /** What the route says about the page, where it says anything. */
  hints: PageStructuredDataHints;
  /**
   * When the page's published content last changed in its language, where a
   * date is kept (`content-dates/last-changed`): read once, and only where a
   * date would be described from the row's own save stamp.
   */
  contentDate: () => Promise<string | undefined>;
  /** The fields the page's content type declares: read once, when asked. */
  declared: () => Promise<unknown>;
  /** The site's People, each one node with one `@id`. */
  people: People;
  /**
   * Whoever runs the site, as every page names it: the organisation's `@id`,
   * or on a person's site, the person's.
   */
  ownerId: string | undefined;
  /**
   * The nodes of the People entries the page names, by `@id`: each written
   * once, beside the page's own, and named by reference wherever it appears.
   */
  named: Map<string, StructuredDataNode>;
  /**
   * Set where the page is a profile only because it is the own page of the
   * person who runs a person's site (`ownersProfile`): it is about them.
   */
  ownersPage?: true;
}

/**
 * A date the page holds in one of its fields, as ISO 8601: the day alone
 * where the field keeps a day with no time (`keepsDayAlone`).
 */
async function pageDateOf(
  facts: PageFacts,
  read: DetailRead
): Promise<string | undefined> {
  if (dateOf(read.value) === undefined) return undefined;
  const dayOnly = keepsDayAlone(await facts.declared(), read.field);
  return dateOf(read.value, { dayOnly });
}

/** A detail's value as the fact it is, or nothing where the page lacks it. */
type DetailValue = Json | undefined;

/** Reads one detail of the page as the kind of fact it is. */
type DetailReader = (
  facts: PageFacts,
  read: DetailRead
) => DetailValue | Promise<DetailValue>;

/**
 * A person the page names, as structured data states them: the entry of the
 * site's People they are, matched by their page's address or their name, by
 * reference to its one node, which the page's graph writes once; else a
 * person described by what the page holds.
 */
function namedValue(facts: PageFacts, named: Named): Json {
  const entry = facts.people.match(named);
  if (entry === undefined) return personNode(named);
  const described = personEntryNode(entry, ref(organizationIdIn(facts)));
  if (described !== undefined && !facts.named.has(entry.id)) {
    facts.named.set(entry.id, described);
  }
  return { "@id": entry.id };
}

/** The site's organisation `@id`, where an organisation runs the site. */
function organizationIdIn(facts: PageFacts): string | undefined {
  return facts.people.owner === undefined ? facts.ownerId : undefined;
}

/** A person the page names, as an author or the subject of a profile. */
const personRead: DetailReader = async (facts, read) => {
  const named = await namedOf(facts.ctx, facts.input, read, facts.origin);
  return named === undefined ? undefined : namedValue(facts, named);
};

/**
 * The person a profile page is about: the one the page names, whose own page
 * it is where nothing else gives them one, so they go by the `@id` a post
 * naming them by their entry gives them; or on a person's site, where the
 * page names nobody or is the person's own page, the person who runs it.
 */
const profileSubjectRead: DetailReader = async (facts, read) => {
  if (aboutTheOwner(facts)) return ref(facts.people.owner?.id);
  const named = await namedOf(facts.ctx, facts.input, read, facts.origin);
  if (named !== undefined) return namedValue(facts, atThisPage(facts, named));
  if (!empty(read.value)) return undefined;
  return ref(facts.people.owner?.id);
};

/**
 * Whether a profile page is about the person who runs a person's site: their
 * own page made a profile is, unless its content type maps whom it is about.
 * A field named like a person only by chance, such as a page's own `name`,
 * is not read as one there.
 */
const aboutTheOwner = (
  facts: Pick<PageFacts, "ownersPage" | "mapping">
): boolean => facts.ownersPage === true && facts.mapping.person === undefined;

/**
 * A profile's subject given the page's own address where nothing else gives
 * them one, so they go by the `@id` a post naming them by their entry gives.
 */
function atThisPage(facts: PageFacts, named: Named): Named {
  if (named.url !== undefined || facts.answer.canonical === undefined) {
    return named;
  }
  const page = absolute(facts.answer.canonical, facts.origin);
  return page === undefined ? named : { ...named, url: page };
}

/** Whether a value holds nothing at all: absent, blank or an empty list. */
function empty(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  return typeof value === "string"
    ? value.trim() === ""
    : value === undefined || value === null;
}

/**
 * Who the site credits an article to where its page names nobody: whoever
 * runs the site, or the person it names, who is the entry of its People of
 * that name or page where there is one.
 */
function defaultAuthorNode(
  facts: PageFacts,
  author: StructuredDataDefaultAuthor
): Json | undefined {
  if (author === "organization") return ref(facts.ownerId);
  const url =
    author.url === undefined ? undefined : absolute(author.url, facts.origin);
  return namedValue(facts, {
    name: author.name,
    ...(url === undefined ? {} : { url }),
    ...(author.jobTitle === undefined ? {} : { jobTitle: author.jobTitle }),
  });
}

/**
 * The page's author: the person it names, or, where it names nobody at all,
 * whom the site credits instead. A page naming an author the route read
 * without its entry is not credited to anyone else: that is the route's to
 * fix, and the problem says so.
 */
const authorRead: DetailReader = async (facts, read) => {
  const named = await personRead(facts, read);
  if (named !== undefined || facts.rules.defaultAuthor === undefined) {
    return named;
  }
  if (!empty(read.value)) return undefined;
  return defaultAuthorNode(facts, facts.rules.defaultAuthor);
};

/** A detail read as a value of one kind, from the field's value alone. */
const valueRead =
  (of: (value: unknown) => DetailValue): DetailReader =>
  (_, read) =>
    of(read.value);

/** The fields a page's body is read from, to count its words. */
const BODY_FIELDS = ["content", "body"] as const;

/**
 * How many words the page has: the field that holds a count, or else the
 * words of its body, as a reader sees them.
 */
const wordCountRead: DetailReader = (facts, read) => {
  if (read.field !== undefined || read.value !== undefined) {
    return countOf(read.value);
  }
  for (const field of BODY_FIELDS) {
    const count = wordCountOf(plainTextOf(facts.document[field]));
    if (count > 0) return count;
  }
  return undefined;
};

/** Questions and answers as structured data states them. */
function questionNodes(questions: readonly Question[]): StructuredDataNode[] {
  return questions.map(each => ({
    "@type": "Question",
    name: each.question,
    acceptedAnswer: { "@type": "Answer", text: each.answer },
  }));
}

/**
 * The questions the page answers: the ones its route gives, or else the
 * ones a field holds. Only what the page shows, so none are made up.
 */
function questionsFor(facts: PageFacts, read: DetailRead): Question[] {
  const fromRoute = (facts.hints.questions ?? []).filter(
    each => each.question.trim() !== "" && each.answer.trim() !== ""
  );
  return fromRoute.length > 0 ? [...fromRoute] : questionsOf(read.value);
}

/**
 * The page's FAQ section, where its route or its content type declares one:
 * its questions as an `FAQPage` that is a part of the page (`<address>#faq`),
 * so a page of any kind can carry the questions it shows without changing
 * what kind of page it is. Its questions are read as a Questions and answers
 * page reads them (`questionsValue`), by that type's mapping, so the two
 * cannot read a page differently. None where nobody declared one, where the
 * page shows no questions, and on a Questions and answers page, whose
 * questions are already its own subject.
 */
function faqSectionOf(
  facts: PageFacts,
  page: DescribedPage,
  type: StructuredDataTypeKey
): StructuredDataNode | undefined {
  const declared =
    facts.hints.faqSection === true || facts.rule?.faqSection === true;
  if (!declared || type === "faqPage") return undefined;
  const source = facts.rule?.details?.faqPage?.questions;
  const read = readDetail(facts.document, "questions", source);
  const questions = questionsValue(facts, read);
  if (questions === undefined) return undefined;
  return node({
    "@type": "FAQPage",
    "@id": `${page.url}#faq`,
    isPartOf: ref(page.id),
    mainEntity: questions,
    inLanguage: page.language,
  });
}

/** The page's questions as structured data states them; nothing for none. */
function questionsValue(
  facts: PageFacts,
  read: DetailRead
): StructuredDataNode[] | undefined {
  const questions = questionsFor(facts, read);
  return questions.length > 0 ? questionNodes(questions) : undefined;
}

/** An absolute http(s) address, as text; nothing for anything else. */
function linkOf(value: unknown): string | undefined {
  const text = textOf(value);
  return text !== undefined && originOf(text) !== undefined ? text : undefined;
}

/** The names a detail lists, as one comma-separated text. */
const listedNames: DetailReader = async (facts, read) => {
  const names = await namesOf(facts.ctx, facts.input, read);
  return names.length > 0 ? names.join(", ") : undefined;
};

/**
 * The names the page lists in a field, as a list: an article's keywords are
 * kept one by one, so its card can carry one tag each, and joined only where
 * its markup states them (`joinedNames`).
 */
const namesList: DetailReader = async (facts, read) => {
  const names = await namesOf(facts.ctx, facts.input, read);
  return names.length > 0 ? names : undefined;
};

/** A list of names as structured data states keywords: in one line. */
function joinedNames(names: Json | undefined): Json | undefined {
  return Array.isArray(names)
    ? names.filter(name => typeof name === "string").join(", ")
    : names;
}

/** How each detail is read, as the kind of fact it is. */
const DETAIL_READERS: Readonly<Record<StructuredDataDetail, DetailReader>> = {
  author: authorRead,
  person: profileSubjectRead,
  itemReviewed: async (facts, read) =>
    (await namedOf(facts.ctx, facts.input, read, facts.origin))?.name,
  // The page's own share image, from the order of who wins, unless the
  // content type maps another field.
  image: async (facts, read) =>
    imageNode(
      facts.mapping.image === undefined
        ? facts.answer.social?.image
        : await pictureOf(facts.ctx, read),
      facts.origin
    ),
  datePublished: pageDateOf,
  dateModified: (facts, read) => modifiedOf(facts, read),
  startDate: pageDateOf,
  uploadDate: pageDateOf,
  price: valueRead(numberOf),
  rating: (facts, read) => ratingOf(facts, read.value),
  bestRating: valueRead(bestRatingOf),
  ratingCount: valueRead(countOf),
  currency: valueRead(currencyOf),
  availability: valueRead(availabilityOf),
  location: valueRead(placeOf),
  streetAddress: valueRead(postalAddressOf),
  openingHours: valueRead(openingHoursOf),
  videoFile: (facts, read) => fileOf(read.value, facts.origin),
  itemType: valueRead(itemTypeOf),
  operatingSystem: valueRead(textOf),
  applicationCategory: valueRead(textOf),
  keywords: namesList,
  // An article is filed under one section: the first the page names.
  articleSection: async (facts, read) =>
    (await namesOf(facts.ctx, facts.input, read))[0],
  wordCount: wordCountRead,
  codeRepository: valueRead(linkOf),
  programmingLanguage: listedNames,
  license: valueRead(textOf),
  questions: (facts, read) => questionsValue(facts, read),
};

/**
 * Where a missing detail is fixed: the page's field to fill in, the route
 * where the page holds it in a relationship the route did not read, or the
 * mapping where no field holds it. The share image is the page's own, so it
 * is filled in on the page.
 */
async function fixFor(
  facts: PageFacts,
  detail: StructuredDataDetail,
  read: DetailRead
): Promise<StructuredDataProblem["fix"]> {
  if (read.field === undefined)
    return detail === "image" ? "content" : "mapping";
  const ownDate = await entryDateFix(facts, detail, read.field, read.value);
  if (ownDate !== undefined) return ownDate;
  return (await heldUnread(facts.ctx, facts.input, read)) ? "route" : "content";
}

/**
 * Where a detail read from one of the names core gives an entry's own dates
 * (`entryDateFieldNames`) is fixed; nothing for any other field. Saving or
 * publishing fills such a date, so it fixes a detail an entry date stands
 * for (`ENTRY_DATE_DETAILS`) while the date is unset. Every other case is a
 * mapping to change: a detail no date supplies, such as a price, or the first
 * publication on a type without the Draft/Published lifecycle, which never
 * sets it. The lifecycle is read only for such a name.
 */
async function entryDateFix(
  facts: PageFacts,
  detail: StructuredDataDetail,
  field: string,
  value: unknown
): Promise<StructuredDataProblem["fix"] | undefined> {
  const entity = facts.input.source.kind === "entry" ? "collection" : "single";
  if (!entryDateFieldNames(entity, { statusLifecycle: true }).includes(field)) {
    return undefined;
  }
  const held = entryDateFieldNames(entity, {
    statusLifecycle: await hasStatusLifecycle(facts),
  }).includes(field);
  const unset = value === undefined || value === null;
  return held && unset && ENTRY_DATE_DETAILS.has(detail) ? "save" : "mapping";
}

/**
 * Whether the page's type has the Draft/Published lifecycle (`status: true`),
 * as the sitemap reads it. Asked only while a missing detail is classified,
 * so a page whose details are all present reads nothing more. A type that is
 * gone has none.
 */
async function hasStatusLifecycle(facts: PageFacts): Promise<boolean> {
  const { source } = facts.input;
  try {
    if (source.kind === "entry") {
      const collection: unknown =
        await facts.ctx.services.collections.getCollection(
          source.collection,
          {}
        );
      return isRecord(collection) && collection.status === true;
    }
    const singles = await facts.ctx.services.singles.list({
      slugAllowlist: [source.slug],
    });
    const single: unknown = singles.data.find(
      each => each.slug === source.slug
    );
    return isRecord(single) && single.status === true;
  } catch (error) {
    if (NextlyError.isCode(error, "NOT_FOUND")) return false;
    throw error;
  }
}

/**
 * What a problem says of a missing detail: that it is missing, or, for one
 * of the entry's own dates, when Nextly sets it, since nothing on the page
 * can be filled in.
 */
function missingMessage(
  detail: StructuredDataDetail,
  fix: StructuredDataProblem["fix"],
  field: string | undefined
): string {
  if (fix !== "save") return `Missing: ${DETAIL_LABELS[detail]}.`;
  const when = field === "firstPublishedAt" ? "first published" : "first saved";
  return `The ${DETAIL_LABELS[detail]} is set when the page is ${when}.`;
}

/** The details a type is described with, and the ones it is missing. */
async function detailsOf(
  facts: PageFacts,
  type: StructuredDataTypeKey
): Promise<{
  values: Partial<Record<StructuredDataDetail, Json>>;
  missing: StructuredDataProblem[];
}> {
  const { needs, uses } = STRUCTURED_DATA_TYPES[type];
  const values: Partial<Record<StructuredDataDetail, Json>> = {};
  const missing: StructuredDataProblem[] = [];
  for (const detail of [...needs, ...uses]) {
    const source = facts.mapping[detail];
    const read = readDetail(facts.document, detail, source);
    const value = await DETAIL_READERS[detail](facts, read);
    if (value !== undefined) {
      values[detail] = value;
      continue;
    }
    if (!needs.includes(detail)) continue;
    const fix = await fixFor(facts, detail, read);
    missing.push({
      type,
      detail,
      message: missingMessage(detail, fix, read.field),
      fix,
      ...(read.field === undefined ? {} : { field: read.field }),
    });
  }
  return { values, missing };
}

/**
 * The date a page is described as last changed: a field that says so (a
 * correction or review date, or the one the content type maps) where it
 * holds a date, else when the page's content last changed, by the rule its
 * sitemap entry is dated by (`lastChangedOf`): its kept content date, else
 * its own last save. So an SEO-only save, which moves the row's save stamp,
 * moves neither, and a correction date left empty, as it is on every page
 * never corrected, says nothing rather than leaving the date out.
 */
async function modifiedOf(
  facts: PageFacts,
  read: DetailRead
): Promise<string | undefined> {
  const stamp =
    read.field === undefined
      ? read.value === undefined
      : isSaveStamp(read.field);
  const stated = stamp ? undefined : await pageDateOf(facts, read);
  if (stated !== undefined) return stated;
  // Derived from the sitemap's own rule, so the two never give a page
  // different dates.
  return lastChangedOf(await facts.contentDate(), facts.document);
}

/** The page's own dates: when it was published, and last changed. */
async function datesOf(
  facts: PageFacts
): Promise<{ published?: string; modified?: string }> {
  const read = (detail: "datePublished" | "dateModified") =>
    readDetail(facts.document, detail, facts.mapping[detail]);
  const published = await pageDateOf(facts, read("datePublished"));
  const modified = await modifiedOf(facts, read("dateModified"));
  return {
    ...(published === undefined ? {} : { published }),
    ...(modified === undefined ? {} : { modified }),
  };
}

/** The type a page is described as, and how that was decided. */
function chosenType(
  facts: Pick<PageFacts, "document">,
  rule: StructuredDataRules["types"][string] | undefined,
  offered: readonly StructuredDataTypeKey[],
  automatic: StructuredDataTypeKey
): { type: StructuredDataTypeKey; chosen: StructuredDataChoice } {
  const seo = isRecord(facts.document.seo) ? facts.document.seo : {};
  const own = seo.structuredDataType;
  // A choice that is not offered here, such as one made before the page was
  // hidden, gives way to the next, as an empty one does.
  if (isStructuredDataTypeKey(own) && offered.includes(own)) {
    return { type: own, chosen: "page" };
  }
  const ofType = rule?.type;
  if (ofType !== undefined && offered.includes(ofType)) {
    return { type: ofType, chosen: "type" };
  }
  return { type: automatic, chosen: "automatic" };
}

/**
 * The type a page is described as when nobody chose one: the kind its route
 * says it is; a collection page where its route lists entries; an article
 * where the page has an author and a date it was published; else a web page.
 */
function automaticType(
  document: Readonly<Record<string, unknown>>,
  hints: PageStructuredDataHints,
  offered: readonly StructuredDataTypeKey[]
): StructuredDataTypeKey {
  const fromRoute = hints.type;
  if (isStructuredDataTypeKey(fromRoute) && offered.includes(fromRoute)) {
    return fromRoute;
  }
  if ((hints.items ?? []).length > 0) return "collectionPage";
  if (!offered.includes("article")) return "webPage";
  const author = readDetail(document, "author", undefined).value;
  const published = readDetail(document, "datePublished", undefined).value;
  return author !== undefined && dateOf(published) !== undefined
    ? "article"
    : "webPage";
}

/** A rating's scale, where the page gives one other than out of 5. */
function scaleOfRating(details: Partial<Record<StructuredDataDetail, Json>>): {
  bestRating?: Json;
  worstRating?: Json;
} {
  return details.bestRating === undefined
    ? {}
    : { bestRating: details.bestRating, worstRating: 1 };
}

/** The page being described: its address, names and language. */
interface DescribedPage {
  /** Its canonical address. */
  url: string;
  /** Its node's `@id`: the address, as a web page. */
  id: string;
  /** Its own name, as its heading shows it. */
  name?: string;
  /**
   * The name of what it describes, such as an article's headline or an
   * app's name: its own name, but on the home page, the brand's.
   */
  subjectName?: string;
  description?: string;
  language?: string;
  published?: string;
  modified?: string;
}

/** What a subject links to beyond the page. */
interface SubjectLinks {
  /** Whoever publishes the site: its organisation, or its person. */
  publisher: string | undefined;
}

/** The details a subject is described with. */
type Details = Partial<Record<StructuredDataDetail, Json>>;

/** A subject's own properties, beyond what every subject states. */
type SubjectFields = (
  details: Details,
  page: DescribedPage,
  links: SubjectLinks
) => Record<string, Json | undefined>;

/** An offer for the page's thing, at its price. */
function offerOf(details: Details, page: DescribedPage): StructuredDataNode {
  return node({
    "@type": "Offer",
    price: details.price,
    priceCurrency: details.currency,
    availability: details.availability,
    url: page.url,
  });
}

/** Ratings a thing has, only where the page gives a rating and its count. */
function aggregateRatingOf(details: Details): Json | undefined {
  if (details.rating === undefined || details.ratingCount === undefined) {
    return undefined;
  }
  return {
    "@type": "AggregateRating",
    ratingValue: details.rating,
    ratingCount: details.ratingCount,
    ...scaleOfRating(details),
  };
}

/** An article of any kind, headed by the page's own name. */
const articleFields: SubjectFields = (details, page, links) => ({
  headline: page.subjectName,
  description: page.description,
  url: page.url,
  image: details.image,
  datePublished: details.datePublished ?? page.published,
  dateModified: details.dateModified ?? page.modified,
  author: details.author,
  publisher: ref(links.publisher),
  keywords: joinedNames(details.keywords),
  articleSection: details.articleSection,
  wordCount: details.wordCount,
  inLanguage: page.language,
});

/** How each kind of subject states what it is, beyond its name. */
const SUBJECT_FIELDS: Partial<Record<StructuredDataTypeKey, SubjectFields>> = {
  article: articleFields,
  blogPosting: articleFields,
  techArticle: articleFields,
  product: (details, page) => ({
    name: page.subjectName,
    description: page.description,
    image: details.image,
    offers: offerOf(details, page),
  }),
  // Described with what the page holds: a price and a rating only where it
  // gives them, since a rating is never made up to earn a result.
  softwareApplication: (details, page, links) => ({
    name: page.subjectName,
    description: page.description,
    url: page.url,
    image: details.image,
    applicationCategory: details.applicationCategory,
    operatingSystem: details.operatingSystem,
    offers: details.price === undefined ? undefined : offerOf(details, page),
    aggregateRating: aggregateRatingOf(details),
    publisher: ref(links.publisher),
  }),
  softwareSourceCode: (details, page, links) => ({
    name: page.subjectName,
    description: page.description,
    url: page.url,
    codeRepository: details.codeRepository,
    programmingLanguage: details.programmingLanguage,
    license: details.license,
    publisher: ref(links.publisher),
  }),
  event: (details, page) => ({
    name: page.subjectName,
    description: page.description,
    image: details.image,
    startDate: details.startDate,
    location: details.location,
  }),
  videoObject: (details, page) => ({
    name: page.subjectName,
    description: page.description,
    thumbnailUrl: isRecord(details.image) ? details.image.url : undefined,
    uploadDate: details.uploadDate,
    contentUrl: details.videoFile,
  }),
  review: (details, page) => ({
    name: page.subjectName,
    reviewBody: page.description,
    author: details.author,
    itemReviewed: {
      "@type": details.itemType ?? null,
      name: details.itemReviewed ?? null,
    },
    reviewRating: {
      "@type": "Rating",
      ratingValue: details.rating ?? null,
      ...scaleOfRating(details),
    },
  }),
  localBusiness: (details, page) => ({
    name: page.subjectName,
    description: page.description,
    image: details.image,
    url: page.url,
    address: details.streetAddress,
    openingHours: details.openingHours,
  }),
};

/** The main subject of a page, as its chosen type describes it. */
function subjectNode(
  type: StructuredDataTypeKey,
  details: Details,
  page: DescribedPage,
  links: SubjectLinks
): StructuredDataNode {
  return node({
    "@type": STRUCTURED_DATA_TYPES[type].schemaType,
    "@id": `${page.url}#${type}`,
    mainEntityOfPage: { "@id": page.id },
    ...SUBJECT_FIELDS[type]?.(details, page, links),
  });
}

/** A reference to the node `id` names, or nothing where there is none. */
function ref(id: string | undefined): { "@id": string } | undefined {
  return id === undefined ? undefined : { "@id": id };
}

/** The site's own nodes, and the ids and name the page's nodes link to. */
interface SiteNodes {
  nodes: StructuredDataNode[];
  /**
   * Whoever runs the site: its organisation, or on a person's site, the
   * person, who publishes it and whom its About page is about.
   */
  ownerId?: string;
  websiteId?: string;
  siteName?: string;
}

/** The site's home page, as every node addresses it. */
const homeOf = (origin: string): string => `${origin}/`;

/** The name the organisation goes by: the brand's, else the site's. */
function brandNameOf(
  rules: StructuredDataRules,
  answer: PageMetadataAnswer
): string | undefined {
  return rules.brand.name ?? answer.social?.siteName;
}

/** References to the founders described beside the organisation. */
function founderRefs(people: People): Json[] | undefined {
  const refs = people.founders.map(founder => ({ "@id": founder.id }));
  return refs.length > 0 ? refs : undefined;
}

/** The organisation that owns the site, from the brand facts. */
function organizationNode(
  rules: StructuredDataRules,
  name: string,
  id: string,
  origin: string,
  people: People
): StructuredDataNode {
  const { brand } = rules;
  const otherNames = [...(brand.otherNames ?? [])];
  const parent = brand.parentOrganization;
  return node({
    "@type": "Organization",
    "@id": id,
    name,
    alternateName: otherNames.length > 0 ? otherNames : undefined,
    url: homeOf(origin),
    logo: imageNode(brand.logo, origin),
    description: brand.description,
    email: brand.email,
    telephone: brand.telephone,
    contactPoint:
      brand.contactPoints === undefined || brand.contactPoints.length === 0
        ? undefined
        : brand.contactPoints.map(point =>
            node({
              "@type": "ContactPoint",
              contactType: point.contactType,
              email: point.email,
              telephone: point.telephone,
              url: point.url,
              availableLanguage:
                point.availableLanguage === undefined
                  ? undefined
                  : [...point.availableLanguage],
            })
          ),
    foundingDate: brand.foundingDate,
    founder: founderRefs(people),
    parentOrganization:
      parent === undefined
        ? undefined
        : node({
            "@type": "Organization",
            name: parent.name,
            url: parent.url,
            description: parent.description,
            foundingDate: parent.foundingDate,
            sameAs: linksOf(parent.sameAs),
          }),
    // Only official accounts at an address are named.
    sameAs: linksOf((brand.profiles ?? []).map(profile => profile.url)),
  });
}

/**
 * Whoever runs the site and the website, each where the site has a name for
 * it: the brand's name for the organisation, the site's for the website.
 * Both are addressed at the site's home, spelled as every page's address is.
 * The organisation names its founders, each described beside it, on every
 * page. On a person's site the person runs it instead: described as their
 * People entry and the brand's facts, publishing the website, with no
 * organisation.
 */
function siteNodesOf(
  rules: StructuredDataRules,
  answer: PageMetadataAnswer,
  origin: string,
  language: string | undefined,
  people: People
): SiteNodes {
  const siteName = answer.social?.siteName ?? rules.brand.name;
  const brandName = brandNameOf(rules, answer);
  const site = ownerNodesOf(rules, brandName, origin, people);
  if (siteName !== undefined) {
    site.siteName = siteName;
    site.websiteId = `${homeOf(origin)}#website`;
    site.nodes.push(
      websiteNodeOf(rules, { siteName, brandName, origin, language }, site)
    );
  }
  return site;
}

/**
 * Whoever runs the site, described: the person who runs a person's site,
 * else the brand's organisation with its founders beside it, else nobody.
 */
function ownerNodesOf(
  rules: StructuredDataRules,
  brandName: string | undefined,
  origin: string,
  people: People
): SiteNodes {
  const { owner } = people;
  if (owner !== undefined) {
    const described = personEntryNode(owner, undefined, contactOf(rules.brand));
    return {
      ownerId: owner.id,
      nodes: described === undefined ? [] : [described],
    };
  }
  if (brandName === undefined) return { nodes: [] };
  const ownerId = `${homeOf(origin)}#organization`;
  const organization = ref(ownerId);
  const founders = people.founders
    .map(founder => personEntryNode(founder, organization))
    .filter(
      (described): described is StructuredDataNode => described !== undefined
    );
  return {
    ownerId,
    nodes: [
      organizationNode(rules, brandName, ownerId, origin, people),
      ...founders,
    ],
  };
}

/** The brand's email and telephone, where it gives them. */
function contactOf(brand: StructuredDataRules["brand"]): {
  email?: string;
  telephone?: string;
} {
  return {
    ...(brand.email === undefined ? {} : { email: brand.email }),
    ...(brand.telephone === undefined ? {} : { telephone: brand.telephone }),
  };
}

/** The website, published by whoever runs the site. */
function websiteNodeOf(
  rules: StructuredDataRules,
  named: {
    siteName: string;
    brandName: string | undefined;
    origin: string;
    language: string | undefined;
  },
  site: SiteNodes
): StructuredDataNode {
  const { siteName, brandName, origin, language } = named;
  // The brand's other names are the site's too where the site is named
  // for the brand, which is what Google reads a site's name from.
  const otherNames =
    brandName?.toLowerCase() === siteName.toLowerCase()
      ? [...(rules.brand.otherNames ?? [])]
      : [];
  return node({
    "@type": "WebSite",
    "@id": site.websiteId,
    url: homeOf(origin),
    name: siteName,
    alternateName: otherNames.length > 0 ? otherNames : undefined,
    description: rules.brand.description,
    publisher: ref(site.ownerId),
    inLanguage: language,
  });
}

/** Where a page is kept: its path from the site's root and its language. */
interface KeptPage {
  path: string;
  locale: string | undefined;
}

/**
 * Where the page at `url` is kept, by the site's language rule; nothing
 * where it is not one of the site's own pages, such as a canonical naming
 * the site an article first appeared on.
 */
async function keptPageOf(
  url: URL,
  origin: string,
  locale: string | undefined
): Promise<KeptPage | undefined> {
  const kept = await addressOfRequest(url);
  if (kept !== undefined) {
    const formed = await stepAddress(kept.path, kept.locale, origin);
    const bare = (address: string) => address.replace(/\/+$/, "");
    if (
      formed !== undefined &&
      bare(formed) === bare(url.origin + url.pathname)
    ) {
      return { path: kept.path, locale: kept.locale };
    }
  }
  return url.origin === origin ? { path: url.pathname, locale } : undefined;
}

/** The absolute address a path kept in `locale` is opened at. */
async function stepAddress(
  path: string,
  locale: string | undefined,
  origin: string
): Promise<string | undefined> {
  if (locale === undefined) return absolute(path, origin);
  const formed = await languageAddressOf(path, locale);
  if (formed.status !== "resolved") return undefined;
  return absolute(formed.path, formed.origin ?? origin);
}

/**
 * The name of the step at `path` in a trail: the name the site gives the
 * address, else the title of the page that holds it, else the name of a
 * page built in code there. Nothing where no page is known to be there,
 * since a trail leads only through pages a visitor can open.
 */
async function stepName(
  facts: PageFacts,
  path: string,
  locale: string | undefined
): Promise<string | undefined> {
  const named = textOf(facts.rules.breadcrumbs?.names?.[path]);
  if (named !== undefined) return named;
  const [holder] = await addressHolders(facts.ctx, path, locale);
  if (holder !== undefined) return textOf(holder.label) ?? nameOfAddress(path);
  const codePage = await readCodePage(facts.ctx, path);
  return codePage === undefined
    ? undefined
    : (codePage.name ?? nameOfAddress(path));
}

/**
 * The trail from the site's home to the page, one step per part of its
 * address that holds a page, each named by that page, and the page named by
 * its own name. The home page, and a page with no name or not kept on this
 * site, have none.
 */
async function breadcrumbOf(
  facts: PageFacts,
  page: DescribedPage
): Promise<StructuredDataNode | undefined> {
  if (page.name === undefined) return undefined;
  const url = new URL(page.url);
  const kept = await keptPageOf(url, facts.origin, facts.input.locale);
  if (kept === undefined || kept.path === "/") return undefined;
  // A site whose addresses end in a slash has its steps' end in one too.
  const slash =
    url.pathname.length > 1 && url.pathname.endsWith("/") ? "/" : "";
  const segments = kept.path.split("/").filter(segment => segment !== "");
  const home =
    (await stepAddress("/", kept.locale, facts.origin)) ?? homeOf(facts.origin);
  const steps: StructuredDataNode[] = [
    {
      "@type": "ListItem",
      position: 1,
      name: facts.rules.breadcrumbs?.home ?? "Home",
      item: home,
    },
  ];
  for (let at = 1; at < segments.length; at++) {
    const path = `/${segments.slice(0, at).join("/")}`;
    const name = await stepName(facts, path, kept.locale);
    const item = await stepAddress(
      `${path}${slash}`,
      kept.locale,
      facts.origin
    );
    if (name === undefined || item === undefined) continue;
    steps.push({ "@type": "ListItem", position: steps.length + 1, name, item });
  }
  steps.push({
    "@type": "ListItem",
    position: steps.length + 1,
    name: page.name,
  });
  return {
    "@type": "BreadcrumbList",
    "@id": `${page.url}#breadcrumb`,
    itemListElement: steps,
  };
}

/** The entries the page lists, at absolute addresses, as one list. */
function itemListOf(
  page: DescribedPage,
  hints: PageStructuredDataHints,
  origin: string
): StructuredDataNode | undefined {
  const items = (hints.items ?? []).flatMap(item => {
    const name = textOf(item.name);
    const url = absolute(item.url, origin);
    return name === undefined || url === undefined ? [] : [{ name, url }];
  });
  if (items.length === 0) return undefined;
  return {
    "@type": "ItemList",
    "@id": `${page.url}#itemlist`,
    numberOfItems: items.length,
    itemListElement: items.map((item, at) => ({
      "@type": "ListItem",
      position: at + 1,
      name: item.name,
      url: item.url,
    })),
  };
}

/** What is described about the page, as its chosen type has it. */
interface Description {
  type: StructuredDataTypeKey;
  values: Partial<Record<StructuredDataDetail, Json>>;
  /** Whether the type has every detail it needs. */
  described: boolean;
}

/** The kinds of page whose subject is the organisation that owns the site. */
const ABOUT_THE_BRAND: readonly StructuredDataTypeKey[] = [
  "aboutPage",
  "contactPage",
];

/** The `@id` reference to a node, where there is one. */
const refTo = (target: StructuredDataNode | undefined) =>
  ref(target?.["@id"] as string | undefined);

/**
 * What the page is mainly about: the person a profile is of, the questions
 * a questions page answers, the thing it describes, the list it shows, or
 * for an About page, the organisation.
 */
function mainEntityOf(
  description: Description,
  parts: { subject?: StructuredDataNode; itemList?: StructuredDataNode },
  site: SiteNodes
): Json | undefined {
  const { type, values, described } = description;
  if (!described) return refTo(parts.subject) ?? refTo(parts.itemList);
  if (type === "profilePage") return values.person;
  if (type === "faqPage") return values.questions;
  return (
    refTo(parts.subject) ??
    refTo(parts.itemList) ??
    (type === "aboutPage" ? ref(site.ownerId) : undefined)
  );
}

/**
 * The page's nodes: the page, as its own kind where it is described as one
 * and has what it needs, else a web page; its trail; the entries it lists;
 * and its subject, where it is described as a thing and has what that needs.
 * Questions and answers are described as the main subject of a page whose
 * kind someone chose as Questions and answers, or as an FAQ section of a page
 * of another kind where its route or content type declares one: never on a
 * page nobody declared them for, whatever questions its route or fields hold,
 * since markup nobody chose is markup the plugin made up.
 */
async function pageNodesOf(
  facts: PageFacts,
  page: DescribedPage,
  description: Description,
  site: SiteNodes
): Promise<StructuredDataNode[]> {
  const { type, values, described } = description;
  const definition = STRUCTURED_DATA_TYPES[type];
  const breadcrumb = await breadcrumbOf(facts, page);
  const itemList = itemListOf(page, facts.hints, facts.origin);
  const subject =
    definition.page || !described
      ? undefined
      : subjectNode(type, values, page, { publisher: site.ownerId });
  const aboutBrand = ABOUT_THE_BRAND.includes(type) && described;
  const faqSection = faqSectionOf(facts, page, type);
  const pageNode = node({
    "@type": definition.page && described ? definition.schemaType : "WebPage",
    "@id": page.id,
    url: page.url,
    name: page.name,
    description: page.description,
    isPartOf: ref(site.websiteId),
    about: aboutBrand ? ref(site.ownerId) : undefined,
    primaryImageOfPage: imageNode(facts.answer.social?.image, facts.origin),
    breadcrumb: refTo(breadcrumb),
    datePublished: page.published,
    dateModified: page.modified,
    mainEntity: mainEntityOf(description, { subject, itemList }, site),
    hasPart: refTo(faqSection),
    inLanguage: page.language,
  });
  return [pageNode, breadcrumb, itemList, subject, faqSection].filter(
    each => each !== undefined
  );
}

/** The details a type is missing, the name a described thing needs first. */
async function describe(
  facts: PageFacts,
  type: StructuredDataTypeKey,
  name: string | undefined
): Promise<Description & { missing: StructuredDataProblem[] }> {
  const { values, missing } = await detailsOf(facts, type);
  // A described thing is named by the page's own name.
  if (!STRUCTURED_DATA_TYPES[type].page && name === undefined) {
    missing.unshift({
      type,
      detail: "title",
      message: "Missing: title.",
      fix: "content",
    });
  }
  return { type, values, described: missing.length === 0, missing };
}

/** The problem a site with no address has: nothing can be written. */
function noSiteAddress(type: StructuredDataTypeKey): StructuredDataProblem {
  return {
    type,
    detail: "siteAddress",
    message: "Missing: the site's address.",
    fix: "settings",
  };
}

/** The page's own name, and the name of what it describes. */
interface OwnNames {
  page?: string;
  subject?: string;
}

/**
 * The page's own name (`pageNameOf`, the name every output gives it), and
 * what the page describes goes by the same name. On the home page, which
 * is named by its whole title, what it describes, such as the site's app,
 * is named by the brand's name.
 */
function ownNamesOf(
  facts: Pick<
    PageFacts,
    "ctx" | "input" | "answer" | "document" | "hints" | "rules"
  >,
  home: boolean,
  siteName: string | undefined
): OwnNames {
  const { source } = facts.input;
  const { key } = typeOf(facts.input);
  const codePage =
    source.kind === "entry" && source.collection === codePagesSlug(facts.ctx);
  const page = pageNameOf({
    ...(facts.hints.name === undefined ? {} : { hint: facts.hints.name }),
    home,
    document: facts.document,
    fields: titleSourcesOf(facts.ctx, key, facts.rules.titleFields).fields,
    ...(facts.input.code.title === undefined
      ? {}
      : { codeTitle: facts.input.code.title }),
    codePage,
    ...(facts.answer.title === undefined ? {} : { title: facts.answer.title }),
    ...(siteName === undefined ? {} : { siteName }),
  });
  const subject =
    home && textOf(facts.hints.name) === undefined
      ? (textOf(brandNameOf(facts.rules, facts.answer)) ?? page)
      : page;
  return {
    ...(page === undefined ? {} : { page }),
    ...(subject === undefined ? {} : { subject }),
  };
}

/** `value` without its absent keys. */
function present<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, inner]) => inner !== undefined)
  ) as T;
}

/**
 * The type a listed page is described as, outside its route's render: the
 * page's own choice, else its content type's, else the automatic one from
 * the page's fields, with the types a page not hidden from search is
 * offered (a listed page is never hidden). A route's own choice
 * (`structuredDataHints.type`) reaches the plugin only while the route
 * renders, so it is not read here.
 */
export function listedPageTypeOf(
  document: Readonly<Record<string, unknown>>,
  rule: StructuredDataRules["types"][string] | undefined
): StructuredDataTypeKey {
  const offered = structuredDataTypesFor({ hidden: false });
  const automatic = automaticType(document, {}, offered);
  return chosenType({ document }, rule, offered, automatic).type;
}

/**
 * The image a listed page's structured data reads from a field its content
 * type maps, such as a post's cover under a name no share-image guess reads;
 * none where the type maps no image field. The field mapped for the type the
 * page is described as, where the page or its content type chooses one; a
 * route's own choice (`structuredDataHints.type`) reaches the plugin only
 * while the route renders, so where the decided type maps no image, the
 * field the content type maps an image from for any of its types is read.
 */
export async function mappedImageOf(
  ctx: PluginContext,
  key: string,
  document: Readonly<Record<string, unknown>>,
  rules: StructuredDataRules
): Promise<PageMetadataImage | undefined> {
  const rule = rules.types[key];
  if (rule?.details === undefined) return undefined;
  const type = listedPageTypeOf(document, rule);
  const source =
    rule.details[type]?.image ??
    Object.values(rule.details).find(mapping => mapping?.image !== undefined)
      ?.image;
  if (source === undefined) return undefined;
  return pictureOf(ctx, readDetail(document, "image", source));
}

/** The type a page is described as, how that was decided, and what is offered. */
function decidedType(
  document: Readonly<Record<string, unknown>>,
  hints: PageStructuredDataHints,
  rule: StructuredDataRules["types"][string] | undefined,
  answer: PageMetadataAnswer
): Pick<PageStructuredData, "type" | "chosen" | "offered"> {
  const offered = structuredDataTypesFor({
    hidden: answer.robots?.index === false,
  });
  const automatic = automaticType(document, hints, offered);
  return { ...chosenType({ document }, rule, offered, automatic), offered };
}

/**
 * The graph of a page on a site with an address: the site's nodes, and
 * where the page has a canonical, the page's own.
 */
async function graphOf(
  given: PageFacts,
  chosen: Pick<PageStructuredData, "type" | "chosen" | "offered">
): Promise<PageStructuredData> {
  const { ctx, input, answer, rules, origin } = given;
  // The page's language, or on a site of one language, the site's.
  const language =
    input.locale ?? (await ctx.publicAddresses.defaultLanguage());
  // The page's address is its canonical as its answer gives it, by the one
  // rule every output follows for a valid canonical. A page with none, such
  // as one whose type declares no address, is given no guessed one: only the
  // site is described.
  const url =
    answer.canonical === undefined
      ? undefined
      : absolute(answer.canonical, origin);
  // A language's home (`/de`) is a home page too: judged by where the page
  // is kept, as its trail is.
  const kept =
    url === undefined
      ? undefined
      : await keptPageOf(new URL(url), origin, input.locale);
  const home = kept?.path === "/";
  const decided = ownersProfile(given, chosen, url, home);
  const { type } = decided;
  const facts: PageFacts =
    decided.type === chosen.type
      ? given
      : {
          ...given,
          mapping: given.rule?.details?.[decided.type] ?? {},
          ownersPage: true,
        };
  const names = ownNamesOf(
    facts,
    home,
    answer.social?.siteName ?? rules.brand.name
  );
  const { missing, ...description } = await describe(
    facts,
    type,
    names.subject
  );
  const site = siteNodesOf(rules, answer, origin, language, facts.people);
  if (url === undefined) {
    return { ...decided, nodes: site.nodes, problems: [] };
  }
  const { published, modified } = await datesOf(facts);
  const page: DescribedPage = present({
    url,
    id: `${url}#webpage`,
    name: names.page,
    subjectName: names.subject,
    description: answer.description,
    language,
    published,
    modified,
  });
  const pageNodes = await pageNodesOf(facts, page, description, site);
  // Each node once, by its `@id`: a person the page names who is also a
  // founder, or whoever runs the site, is the node the site already wrote.
  const nodes = uniqueNodes([
    ...site.nodes,
    ...pageNodes,
    ...facts.named.values(),
  ]);
  const article = articleCardOf(description, page, site, nodes);
  return {
    ...decided,
    nodes,
    problems: missing,
    ...(article === undefined ? {} : { article }),
  };
}

/** `nodes` with each `@id` written once: the first node of it kept. */
function uniqueNodes(
  nodes: readonly StructuredDataNode[]
): StructuredDataNode[] {
  const seen = new Set<string>();
  return nodes.filter(each => {
    const id = each["@id"];
    if (typeof id !== "string") return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/**
 * Whether nobody decided what a page is: neither its own choice, its content
 * type's nor its route's (`structuredDataHints.type`) made it the plain web
 * page it is, and a profile page is offered for it.
 */
function leftToDecide(
  facts: Pick<PageFacts, "hints">,
  decided: Pick<PageStructuredData, "type" | "chosen" | "offered">
): boolean {
  return (
    decided.chosen === "automatic" &&
    decided.type === "webPage" &&
    !isStructuredDataTypeKey(facts.hints.type) &&
    decided.offered.includes("profilePage")
  );
}

/**
 * On a person's site, the person's own page is a profile page about them:
 * the home page, or the page their entry names as theirs, where nobody chose
 * what it is and it would otherwise be a plain web page. Any other page, and
 * any choice someone made, its route's included, is left as decided.
 */
function ownersProfile(
  facts: PageFacts,
  decided: Pick<PageStructuredData, "type" | "chosen" | "offered">,
  url: string | undefined,
  home: boolean
): Pick<PageStructuredData, "type" | "chosen" | "offered"> {
  const { owner } = facts.people;
  if (
    owner === undefined ||
    url === undefined ||
    !leftToDecide(facts, decided)
  ) {
    return decided;
  }
  const bare = (address: string) =>
    address.replace(/[?#].*$/, "").replace(/\/+$/, "");
  const own =
    owner.person.url !== undefined && bare(owner.person.url) === bare(url);
  return home || own ? { ...decided, type: "profilePage" } : decided;
}

/**
 * An article's details for its social card, read from the fields its own
 * markup states (`articleFields`), so the card and the markup never give the
 * page different dates, authors or tags. None for a page that is not an
 * article, or an article left out for a missing detail.
 */
function articleCardOf(
  description: Description,
  page: DescribedPage,
  site: SiteNodes,
  nodes: readonly StructuredDataNode[]
): PageArticle | undefined {
  const { type, values, described } = description;
  if (SUBJECT_FIELDS[type] !== articleFields || !described) return undefined;
  const fields = articleFields(values, page, { publisher: site.ownerId });
  const authors = authorsOf(fields.author, nodes);
  const tags = Array.isArray(values.keywords)
    ? values.keywords.filter(tag => typeof tag === "string")
    : [];
  return present({
    publishedTime: textOf(fields.datePublished),
    modifiedTime: textOf(fields.dateModified),
    authors: authors.length === 0 ? undefined : authors,
    tags: tags.length === 0 ? undefined : tags,
  });
}

/**
 * Who an article is by, as its card names each: a person's or the
 * organisation's own page, else their name. A reference to the organisation
 * is read from the site's own nodes.
 */
function authorsOf(
  author: Json | undefined,
  siteNodes: readonly StructuredDataNode[]
): string[] {
  const named = (Array.isArray(author) ? author : [author]).flatMap(each => {
    if (!isRecord(each)) return [];
    const id = each["@id"];
    const held =
      Object.keys(each).length === 1 && typeof id === "string"
        ? siteNodes.find(node => node["@id"] === id)
        : each;
    const name = textOf(held?.url) ?? textOf(held?.name);
    return name === undefined ? [] : [name];
  });
  return [...new Set(named)];
}

/**
 * The page's structured data, worked out from its answer, its fields and
 * what its route says about it: the organisation and website from the brand
 * facts, the page, a breadcrumb trail from the site's home, the entries it
 * lists, and the page's subject as its chosen type describes it, the
 * questions it answers where that type is Questions and answers or where an
 * FAQ section is declared for it. A type missing a detail it needs is left out, and
 * listed as a problem.
 */
export async function buildStructuredData(
  ctx: PluginContext,
  input: PageMetadataInput,
  answer: PageMetadataAnswer,
  rules: StructuredDataRules
): Promise<PageStructuredData> {
  const { key, document } = pageOf(input);
  const hints = input.structuredDataHints ?? {};
  const rule = rules.types[key];
  const decided = decidedType(document, hints, rule, answer);
  // The site's address decides every absolute address; a language served on
  // its own domain gives its own in the page's canonical.
  const origin = originOf(rules.origin) ?? originOf(answer.canonical);
  if (origin === undefined) {
    return { ...decided, nodes: [], problems: [noSiteAddress(decided.type)] };
  }
  // Whoever runs the site, named by the brand's name, else the site's: an
  // organisation, or on a person's site, the person.
  const ownerName = brandNameOf(rules, answer);
  const organizationId =
    rules.brand.kind === "person" || ownerName === undefined
      ? undefined
      : `${homeOf(origin)}#organization`;
  const people = peopleOf(rules, origin, ownerName, organizationId);
  return graphOf(
    {
      ctx,
      input,
      answer,
      document,
      origin,
      mapping: rule?.details?.[decided.type] ?? {},
      rule,
      rules,
      hints,
      contentDate: once(() => contentDateOfPage(ctx, input, document)),
      declared: once(() => declaredFields(ctx, input)),
      people,
      ownerId: people.owner?.id ?? organizationId,
      named: new Map(),
    },
    decided
  );
}

/** `read`, asked once, its answer kept for every later ask. */
function once<T>(read: () => Promise<T>): () => Promise<T> {
  let answer: Promise<T> | undefined;
  return () => (answer ??= read());
}

/**
 * The content date of the page `input` resolved to, in its language
 * (`contentDateOf`): an entry held under its collection, a Single under its
 * key, as the save hooks keep their dates. None where none is kept, or the
 * read fails: the page's head is served whatever the date read does.
 */
async function contentDateOfPage(
  ctx: PluginContext,
  input: PageMetadataInput,
  document: Readonly<Record<string, unknown>>
): Promise<string | undefined> {
  const id = document.id;
  if (typeof id !== "string" && typeof id !== "number") return undefined;
  const { source } = input;
  const holder = {
    collection:
      source.kind === "entry" ? source.collection : singleKey(source.slug),
    id: String(id),
  };
  try {
    const language =
      input.locale ?? (await ctx.publicAddresses.defaultLanguage());
    return await contentDateOf(ctx, holder, language);
  } catch {
    return undefined;
  }
}
