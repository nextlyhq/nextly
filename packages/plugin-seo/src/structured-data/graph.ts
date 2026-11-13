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
  languageAddressOf,
  type PageMetadataAnswer,
  type PageMetadataImage,
  type PageMetadataInput,
  type PageStructuredDataHints,
  type PluginContext,
} from "@nextlyhq/plugin-sdk";

import { addressHolders } from "../address-record/participant";
import { codePagesSlug } from "../code-pages/collection";
import { nameOfAddress, readCodePage } from "../code-pages/store";
import { originOf } from "../origin";
import { TITLE_FIELDS } from "../settings/patterns";

import {
  DETAIL_LABELS,
  isStructuredDataTypeKey,
  REVIEWED_ITEM_TYPES,
  STRUCTURED_DATA_TYPES,
  structuredDataTypesFor,
  type StructuredDataDetail,
  type StructuredDataTypeKey,
} from "./catalog";
import type {
  DetailMapping,
  StructuredDataDefaultAuthor,
  StructuredDataPerson,
  StructuredDataRules,
} from "./rules";
import {
  dateOf,
  heldUnread,
  isRecord,
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
   * names, as at `depth: 0`), or in the SEO settings (`settings`, the site's
   * address).
   */
  fix: "content" | "mapping" | "route" | "settings";
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

/** `address` as an absolute address on `origin`, where it is not already. */
function absolute(address: string, origin: string): string | undefined {
  try {
    const url = new URL(address, `${origin}/`);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

/** `value` without its absent keys, as a node. */
function node(value: Record<string, Json | undefined>): StructuredDataNode {
  return Object.fromEntries(
    Object.entries(value).filter(([, inner]) => inner !== undefined)
  ) as StructuredDataNode;
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
  rules: StructuredDataRules;
  /** What the route says about the page, where it says anything. */
  hints: PageStructuredDataHints;
}

/** A detail's value as the fact it is, or nothing where the page lacks it. */
type DetailValue = Json | undefined;

/** Reads one detail of the page as the kind of fact it is. */
type DetailReader = (
  facts: PageFacts,
  read: DetailRead
) => DetailValue | Promise<DetailValue>;

/** A person the page names, as an author or the subject of a profile. */
const personRead: DetailReader = async (facts, read) => {
  const named = await namedOf(facts.ctx, facts.input, read, facts.origin);
  return named === undefined ? undefined : personNode(named);
};

/** Whether a value holds nothing at all: absent, blank or an empty list. */
function empty(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  return typeof value === "string"
    ? value.trim() === ""
    : value === undefined || value === null;
}

/** Who the site credits an article to where its page names nobody. */
function defaultAuthorNode(
  author: StructuredDataDefaultAuthor,
  organization: string | undefined,
  origin: string
): StructuredDataNode | undefined {
  if (author === "organization") return ref(organization);
  const url =
    author.url === undefined ? undefined : absolute(author.url, origin);
  return personNode({
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
  return defaultAuthorNode(
    facts.rules.defaultAuthor,
    organizationIdOf(facts.rules, facts.answer, facts.origin),
    facts.origin
  );
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

/** How each detail is read, as the kind of fact it is. */
const DETAIL_READERS: Readonly<Record<StructuredDataDetail, DetailReader>> = {
  author: authorRead,
  person: personRead,
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
  datePublished: valueRead(dateOf),
  dateModified: valueRead(dateOf),
  startDate: valueRead(dateOf),
  uploadDate: valueRead(dateOf),
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
  keywords: listedNames,
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
  return (await heldUnread(facts.ctx, facts.input, read)) ? "route" : "content";
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
    missing.push({
      type,
      detail,
      message: `Missing: ${DETAIL_LABELS[detail]}.`,
      fix: await fixFor(facts, detail, read),
      ...(read.field === undefined ? {} : { field: read.field }),
    });
  }
  return { values, missing };
}

/** The page's own dates: when it was published, and last changed. */
function datesOf(facts: PageFacts): { published?: string; modified?: string } {
  const at = (detail: "datePublished" | "dateModified") =>
    dateOf(readDetail(facts.document, detail, facts.mapping[detail]).value);
  const published = at("datePublished");
  const modified = at("dateModified");
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
  organization: string | undefined;
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
  publisher: ref(links.organization),
  keywords: details.keywords,
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
    publisher: ref(links.organization),
  }),
  softwareSourceCode: (details, page, links) => ({
    name: page.subjectName,
    description: page.description,
    url: page.url,
    codeRepository: details.codeRepository,
    programmingLanguage: details.programmingLanguage,
    license: details.license,
    publisher: ref(links.organization),
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
  organizationId?: string;
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

/** The organisation's `@id`, where the site has a name for it. */
function organizationIdOf(
  rules: StructuredDataRules,
  answer: PageMetadataAnswer,
  origin: string
): string | undefined {
  return brandNameOf(rules, answer) === undefined
    ? undefined
    : `${homeOf(origin)}#organization`;
}

/** Absolute addresses only: an official account is always one. */
function linksOf(urls: readonly string[] | undefined): string[] | undefined {
  const links = (urls ?? []).filter(url => originOf(url) !== undefined);
  return links.length > 0 ? links : undefined;
}

/** The brand's founders, each as a person with an `@id` of their own. */
function founderNodes(
  founders: readonly StructuredDataPerson[],
  origin: string,
  organization: string | undefined
): StructuredDataNode[] {
  return founders.map((founder, at) =>
    node({
      "@type": "Person",
      "@id": `${homeOf(origin)}#founder${at === 0 ? "" : `-${at + 1}`}`,
      name: founder.name,
      url:
        founder.url === undefined ? undefined : absolute(founder.url, origin),
      jobTitle: founder.jobTitle,
      description: founder.description,
      image:
        founder.image === undefined
          ? undefined
          : absolute(founder.image, origin),
      sameAs: linksOf(founder.sameAs),
      knowsAbout:
        founder.knowsAbout === undefined ? undefined : [...founder.knowsAbout],
      worksFor: ref(organization),
    })
  );
}

/** References to the founders described beside the organisation. */
function founderRefs(
  founders: readonly StructuredDataNode[]
): Json[] | undefined {
  const refs = founders.flatMap(founder => {
    const id = founder["@id"];
    return typeof id === "string" ? [{ "@id": id }] : [];
  });
  return refs.length > 0 ? refs : undefined;
}

/** The organisation that owns the site, from the brand facts. */
function organizationNode(
  rules: StructuredDataRules,
  name: string,
  id: string,
  origin: string,
  founders: readonly StructuredDataNode[]
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
    founder: founderRefs(founders),
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
 * The organisation and the website, each where the site has a name for it:
 * the brand's name for the organisation, the site's for the website. Both
 * are addressed at the site's home, spelled as every page's address is.
 */
function siteNodesOf(
  rules: StructuredDataRules,
  answer: PageMetadataAnswer,
  origin: string,
  language: string | undefined,
  founders: readonly StructuredDataNode[]
): SiteNodes {
  const siteName = answer.social?.siteName ?? rules.brand.name;
  const brandName = brandNameOf(rules, answer);
  const home = homeOf(origin);
  const site: SiteNodes = { nodes: [] };
  if (brandName !== undefined) {
    site.organizationId = `${home}#organization`;
    site.nodes.push(
      organizationNode(rules, brandName, site.organizationId, origin, founders)
    );
  }
  if (siteName !== undefined) {
    site.siteName = siteName;
    site.websiteId = `${home}#website`;
    // The brand's other names are the site's too where the site is named
    // for the brand, which is what Google reads a site's name from.
    const otherNames =
      brandName?.toLowerCase() === siteName.toLowerCase()
        ? [...(rules.brand.otherNames ?? [])]
        : [];
    site.nodes.push(
      node({
        "@type": "WebSite",
        "@id": site.websiteId,
        url: home,
        name: siteName,
        alternateName: otherNames.length > 0 ? otherNames : undefined,
        description: rules.brand.description,
        publisher: ref(site.organizationId),
        inLanguage: language,
      })
    );
  }
  return site;
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

/**
 * The questions a page of another kind shows, described beside it; nothing
 * on a questions page, whose questions are its own main subject.
 */
function questionsBeside(
  facts: PageFacts,
  page: DescribedPage,
  type: StructuredDataTypeKey
): StructuredDataNode | undefined {
  if (type === "faqPage") return undefined;
  const read = readDetail(facts.document, "questions", facts.mapping.questions);
  const questions = questionsValue(facts, read);
  return questions === undefined
    ? undefined
    : { "@type": "FAQPage", "@id": `${page.url}#faq`, mainEntity: questions };
}

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
    (type === "aboutPage" ? ref(site.organizationId) : undefined)
  );
}

/**
 * The page's nodes: the page, as its own kind where it is described as one
 * and has what it needs, else a web page; its trail; the entries it lists;
 * its questions; and its subject, where it is described as a thing and has
 * what that needs.
 */
async function pageNodesOf(
  facts: PageFacts,
  page: DescribedPage,
  description: Description,
  site: SiteNodes,
  founders: readonly StructuredDataNode[]
): Promise<StructuredDataNode[]> {
  const { type, values, described } = description;
  const definition = STRUCTURED_DATA_TYPES[type];
  const breadcrumb = await breadcrumbOf(facts, page);
  const itemList = itemListOf(page, facts.hints, facts.origin);
  const subject =
    definition.page || !described
      ? undefined
      : subjectNode(type, values, page, { organization: site.organizationId });
  const aboutBrand = ABOUT_THE_BRAND.includes(type) && described;
  const pageNode = node({
    "@type": definition.page && described ? definition.schemaType : "WebPage",
    "@id": page.id,
    url: page.url,
    name: page.name,
    description: page.description,
    isPartOf: ref(site.websiteId),
    about: aboutBrand ? ref(site.organizationId) : undefined,
    primaryImageOfPage: imageNode(facts.answer.social?.image, facts.origin),
    breadcrumb: refTo(breadcrumb),
    datePublished: page.published,
    dateModified: page.modified,
    mainEntity: mainEntityOf(description, { subject, itemList }, site),
    inLanguage: page.language,
  });
  // The brand's founders are described where the site says who it is: the
  // founders are given only for a described About page.
  return [
    pageNode,
    breadcrumb,
    itemList,
    questionsBeside(facts, page, type),
    subject,
    ...founders,
  ].filter(each => each !== undefined);
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

/** A separator between a title and the site's name after it. */
const BEFORE_SITE_NAME = /\s*[|—–·:-]\s*$/;

/**
 * `title` without the site's name its pattern put after it, so
 * "Pricing | Acme" names the page "Pricing". A title that only ends with
 * the name, with no separator before it ("Why we chose Acme"), is kept.
 */
function withoutSiteName(
  title: string | undefined,
  siteName: string | undefined
): string | undefined {
  const text = textOf(title);
  if (text === undefined || siteName === undefined) return text;
  const name = siteName.trim().toLowerCase();
  if (name === "" || !text.toLowerCase().endsWith(name)) return text;
  const before = text.slice(0, text.length - name.length);
  if (!BEFORE_SITE_NAME.test(before)) return text;
  return textOf(before.replace(BEFORE_SITE_NAME, "")) ?? text;
}

/** The page's own name, and the name of what it describes. */
interface OwnNames {
  page?: string;
  subject?: string;
}

/**
 * The page's own name, as its heading shows it, which its title's pattern
 * fills `{Title}` from: what its route says, else its own title field, else
 * the route's title or the page's title without the site's name. What the
 * page describes goes by the same name.
 *
 * The home page is the exception: it is named by its whole title, which is
 * the site's own, and what it describes, such as the site's app, by the
 * brand's name, since a home page's title field is usually just "Home".
 */
function ownNamesOf(
  facts: Pick<
    PageFacts,
    "ctx" | "input" | "answer" | "document" | "hints" | "rules"
  >,
  home: boolean,
  siteName: string | undefined
): OwnNames {
  const fromRoute = textOf(facts.hints.name);
  const defined = (page: string | undefined, subject: string | undefined) => ({
    ...(page === undefined ? {} : { page }),
    ...(subject === undefined ? {} : { subject }),
  });
  if (fromRoute !== undefined) return defined(fromRoute, fromRoute);
  if (home) {
    const title = textOf(facts.answer.title);
    return defined(
      title,
      textOf(brandNameOf(facts.rules, facts.answer)) ?? title
    );
  }
  const fromCode = withoutSiteName(facts.input.code.title, siteName);
  const { source } = facts.input;
  const codePage =
    source.kind === "entry" && source.collection === codePagesSlug(facts.ctx);
  const name =
    ownTitleOf(facts.document, codePage ? fromCode : undefined) ??
    fromCode ??
    withoutSiteName(facts.answer.title, siteName);
  return defined(name, name);
}

/**
 * The page's own title field, where it has one. A page built in code is
 * named from its address (`/pricing` is "Pricing") only where its route
 * gives no name, so there `fromCode`, its route's own title, is the better
 * name; it is given for a page built in code only.
 */
function ownTitleOf(
  document: Readonly<Record<string, unknown>>,
  fromCode: string | undefined
): string | undefined {
  const own = TITLE_FIELDS.map(field => textOf(document[field])).find(
    title => title !== undefined
  );
  const path = textOf(document.path);
  const fromAddress =
    path !== undefined && own === nameOfAddress(path) && fromCode !== undefined;
  return fromAddress ? undefined : own;
}

/** `value` without its absent keys. */
function present<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, inner]) => inner !== undefined)
  ) as T;
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
  const offered = structuredDataTypesFor({ hidden: false });
  const automatic = automaticType(document, {}, offered);
  const { type } = chosenType({ document }, rule, offered, automatic);
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
  facts: PageFacts,
  decided: Pick<PageStructuredData, "type" | "chosen" | "offered">
): Promise<PageStructuredData> {
  const { ctx, input, answer, rules, origin } = facts;
  const { type } = decided;
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
  const founders =
    type === "aboutPage" && description.described
      ? founderNodes(
          rules.brand.founders ?? [],
          origin,
          organizationIdOf(rules, answer, origin)
        )
      : [];
  const site = siteNodesOf(rules, answer, origin, language, founders);
  if (url === undefined) {
    return { ...decided, nodes: site.nodes, problems: [] };
  }
  const { published, modified } = datesOf(facts);
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
  const nodes = await pageNodesOf(facts, page, description, site, founders);
  return { ...decided, nodes: [...site.nodes, ...nodes], problems: missing };
}

/**
 * The page's structured data, worked out from its answer, its fields and
 * what its route says about it: the organisation and website from the brand
 * facts, the page, a breadcrumb trail from the site's home, the entries it
 * lists and the questions it answers, and the page's subject as its chosen
 * type describes it. A type missing a detail it needs is left out, and
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
  return graphOf(
    {
      ctx,
      input,
      answer,
      document,
      origin,
      mapping: rule?.details?.[decided.type] ?? {},
      rules,
      hints,
    },
    decided
  );
}
