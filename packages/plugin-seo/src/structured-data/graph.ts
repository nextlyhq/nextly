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
import type {
  PageMetadataAnswer,
  PageMetadataImage,
  PageMetadataInput,
  PluginContext,
} from "@nextlyhq/plugin-sdk";

import {
  DETAIL_LABELS,
  isStructuredDataTypeKey,
  REVIEWED_ITEM_TYPES,
  STRUCTURED_DATA_TYPES,
  structuredDataTypesFor,
  type StructuredDataDetail,
  type StructuredDataTypeKey,
} from "./catalog";
import type { DetailMapping, StructuredDataRules } from "./rules";
import {
  dateOf,
  heldUnread,
  isRecord,
  namedOf,
  numberOf,
  pictureOf,
  readDetail,
  textOf,
  type DetailRead,
  type Named,
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

/** An http(s) origin, such as `https://example.com`; nothing otherwise. */
function originOf(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.origin
      : undefined;
  } catch {
    return undefined;
  }
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

/** A person, as an author or the subject of a profile. */
function personNode(person: Named): StructuredDataNode {
  return node({ "@type": "Person", name: person.name, url: person.url });
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
  const text = textOf(value);
  return text === undefined
    ? undefined
    : {
        "@type": "Place",
        name: text,
        address: { "@type": "PostalAddress", streetAddress: text },
      };
}

/** Opening hours as text (`Mo-Fr 09:00-17:00`), one or several. */
function openingHoursOf(value: unknown): Json | undefined {
  if (Array.isArray(value)) {
    const hours = value.map(textOf).filter(each => each !== undefined);
    return hours.length > 0 ? hours : undefined;
  }
  return textOf(value);
}

/** A file's address: text, or a media document's `url`. */
function fileOf(value: unknown, origin: string): string | undefined {
  const url = isRecord(value) ? textOf(value.url) : textOf(value);
  return url === undefined ? undefined : absolute(url, origin);
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

/** A detail read as a value of one kind, from the field's value alone. */
const valueRead =
  (of: (value: unknown) => DetailValue): DetailReader =>
  (_, read) =>
    of(read.value);

/** How each detail is read, as the kind of fact it is. */
const DETAIL_READERS: Readonly<Record<StructuredDataDetail, DetailReader>> = {
  author: personRead,
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
  startDate: valueRead(dateOf),
  uploadDate: valueRead(dateOf),
  price: valueRead(numberOf),
  rating: valueRead(numberOf),
  ratingCount: valueRead(countOf),
  currency: valueRead(currencyOf),
  availability: valueRead(availabilityOf),
  location: valueRead(placeOf),
  streetAddress: valueRead(postalAddressOf),
  openingHours: valueRead(openingHoursOf),
  videoFile: (facts, read) => fileOf(read.value, facts.origin),
  itemType: valueRead(itemTypeOf),
  operatingSystem: valueRead(textOf),
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
  const { needs, uses } = STRUCTURED_DATA_TYPES[type] as {
    needs: readonly StructuredDataDetail[];
    uses: readonly StructuredDataDetail[];
  };
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
 * The type a page is described as when nobody chose one: an article where
 * the page has an author and a date it was published, else a web page.
 */
function automaticType(
  document: Readonly<Record<string, unknown>>,
  hidden: boolean
): StructuredDataTypeKey {
  if (hidden) return "webPage";
  const author = readDetail(document, "author", undefined).value;
  const published = readDetail(document, "datePublished", undefined).value;
  return author !== undefined && dateOf(published) !== undefined
    ? "article"
    : "webPage";
}

/** The main subject of a page, as its chosen type describes it. */
function subjectNode(
  type: StructuredDataTypeKey,
  details: Partial<Record<StructuredDataDetail, Json>>,
  page: { url: string; title?: string; description?: string },
  links: { organization?: string; language?: string; modified?: string }
): StructuredDataNode {
  const { schemaType } = STRUCTURED_DATA_TYPES[type];
  const base = {
    "@type": schemaType,
    "@id": `${page.url}#${type}`,
    mainEntityOfPage: { "@id": page.url },
  };
  const offer = () =>
    node({
      "@type": "Offer",
      price: details.price,
      priceCurrency: details.currency,
      availability: details.availability,
      url: page.url,
    });
  switch (type) {
    case "article":
    case "blogPosting":
      return node({
        ...base,
        headline: page.title,
        description: page.description,
        image: details.image,
        datePublished: details.datePublished,
        dateModified: links.modified,
        author: details.author,
        publisher: ref(links.organization),
        inLanguage: links.language,
      });
    case "product":
      return node({
        ...base,
        name: page.title,
        description: page.description,
        image: details.image,
        offers: offer(),
      });
    case "softwareApplication":
      return node({
        ...base,
        name: page.title,
        description: page.description,
        image: details.image,
        operatingSystem: details.operatingSystem,
        offers: offer(),
        aggregateRating: {
          "@type": "AggregateRating",
          ratingValue: details.rating ?? null,
          ratingCount: details.ratingCount ?? null,
        },
      });
    case "event":
      return node({
        ...base,
        name: page.title,
        description: page.description,
        image: details.image,
        startDate: details.startDate,
        location: details.location,
      });
    case "videoObject":
      return node({
        ...base,
        name: page.title,
        description: page.description,
        thumbnailUrl: isRecord(details.image) ? details.image.url : undefined,
        uploadDate: details.uploadDate,
        contentUrl: details.videoFile,
      });
    case "review":
      return node({
        ...base,
        name: page.title,
        reviewBody: page.description,
        author: details.author,
        itemReviewed: {
          "@type": details.itemType ?? null,
          name: details.itemReviewed ?? null,
        },
        reviewRating: {
          "@type": "Rating",
          ratingValue: details.rating ?? null,
        },
      });
    case "localBusiness":
      return node({
        ...base,
        name: page.title,
        description: page.description,
        image: details.image,
        url: page.url,
        address: details.streetAddress,
        openingHours: details.openingHours,
      });
    case "webPage":
    case "collectionPage":
    case "profilePage":
      return node(base);
  }
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

/** The organisation that owns the site, from the brand facts. */
function organizationNode(
  rules: StructuredDataRules,
  name: string,
  id: string,
  origin: string
): StructuredDataNode {
  const { brand } = rules;
  // Only official accounts at an address are named.
  const profiles = (brand.profiles ?? [])
    .map(profile => profile.url)
    .filter(url => originOf(url) !== undefined);
  const otherNames = [...(brand.otherNames ?? [])];
  return node({
    "@type": "Organization",
    "@id": id,
    name,
    alternateName: otherNames.length > 0 ? otherNames : undefined,
    url: `${origin}/`,
    logo: imageNode(brand.logo, origin),
    sameAs: profiles.length > 0 ? profiles : undefined,
  });
}

/**
 * The organisation and the website, each where the site has a name for it:
 * the brand's name for the organisation, the site's for the website.
 */
function siteNodesOf(
  rules: StructuredDataRules,
  answer: PageMetadataAnswer,
  origin: string,
  language: string | undefined
): SiteNodes {
  const siteName = answer.social?.siteName ?? rules.brand.name;
  const brandName = rules.brand.name ?? siteName;
  const home = `${origin}/`;
  const site: SiteNodes = { nodes: [] };
  if (brandName !== undefined) {
    site.organizationId = `${home}#organization`;
    site.nodes.push(
      organizationNode(rules, brandName, site.organizationId, origin)
    );
  }
  if (siteName !== undefined) {
    site.siteName = siteName;
    site.websiteId = `${home}#website`;
    site.nodes.push(
      node({
        "@type": "WebSite",
        "@id": site.websiteId,
        url: home,
        name: siteName,
        publisher: ref(site.organizationId),
        inLanguage: language,
      })
    );
  }
  return site;
}

/** The page being described: its address, text and language. */
interface DescribedPage {
  url: string;
  title?: string;
  description?: string;
  language?: string;
}

/**
 * The trail from the site's home, named by the site's name, to the page: a
 * site with no name, a page with no title, or the home page itself has none.
 */
function breadcrumbOf(
  page: DescribedPage,
  site: SiteNodes,
  origin: string
): StructuredDataNode | undefined {
  if (page.title === undefined || site.siteName === undefined) return undefined;
  if (new URL(page.url).pathname === "/") return undefined;
  return {
    "@type": "BreadcrumbList",
    "@id": `${page.url}#breadcrumb`,
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: site.siteName,
        item: `${origin}/`,
      },
      { "@type": "ListItem", position: 2, name: page.title },
    ],
  };
}

/** What is described about the page, as its chosen type has it. */
interface Description {
  type: StructuredDataTypeKey;
  values: Partial<Record<StructuredDataDetail, Json>>;
  /** Whether the type has every detail it needs. */
  described: boolean;
}

/**
 * The page's nodes: the page, as its own kind where it is described as one
 * and has what it needs, else a web page; its trail; and its subject, where
 * it is described as a thing and has what that needs.
 */
function pageNodesOf(
  page: DescribedPage,
  description: Description,
  site: SiteNodes,
  facts: Pick<PageFacts, "answer" | "document" | "origin">
): StructuredDataNode[] {
  const { type, values, described } = description;
  const definition = STRUCTURED_DATA_TYPES[type];
  const breadcrumb = breadcrumbOf(page, site, facts.origin);
  const pageNode = node({
    "@type": definition.page && described ? definition.schemaType : "WebPage",
    "@id": page.url,
    url: page.url,
    name: page.title,
    description: page.description,
    isPartOf: ref(site.websiteId),
    primaryImageOfPage: imageNode(facts.answer.social?.image, facts.origin),
    breadcrumb: ref(breadcrumb?.["@id"] as string | undefined),
    mainEntity: type === "profilePage" && described ? values.person : undefined,
    inLanguage: page.language,
  });
  const nodes = breadcrumb === undefined ? [pageNode] : [pageNode, breadcrumb];
  if (definition.page || !described) return nodes;
  const modified = dateOf(facts.document.updatedAt);
  return [
    ...nodes,
    subjectNode(type, values, page, {
      ...(site.organizationId === undefined
        ? {}
        : { organization: site.organizationId }),
      ...(page.language === undefined ? {} : { language: page.language }),
      ...(modified === undefined ? {} : { modified }),
    }),
  ];
}

/** The details a type is missing, the title a described thing needs first. */
async function describe(
  facts: PageFacts,
  type: StructuredDataTypeKey
): Promise<Description & { missing: StructuredDataProblem[] }> {
  const { values, missing } = await detailsOf(facts, type);
  // A described thing is named by the page's title, as the head names it.
  if (!STRUCTURED_DATA_TYPES[type].page && facts.answer.title === undefined) {
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

/**
 * The page's structured data, worked out from its answer and its fields: the
 * organisation and website from the brand facts, the page, a breadcrumb trail
 * from the site's home, and the page's subject as its chosen type describes
 * it. A type missing a detail it needs is left out, and listed as a problem.
 */
export async function buildStructuredData(
  ctx: PluginContext,
  input: PageMetadataInput,
  answer: PageMetadataAnswer,
  rules: StructuredDataRules
): Promise<PageStructuredData> {
  const { key, document } = pageOf(input);
  const hidden = answer.robots?.index === false;
  const offered = structuredDataTypesFor({ hidden });
  const rule = rules.types[key];
  const { type, chosen } = chosenType(
    { document },
    rule,
    offered,
    automaticType(document, hidden)
  );
  const decided = { type, chosen, offered };
  // The site's address decides every absolute address; a language served on
  // its own domain gives its own in the page's canonical.
  const origin = originOf(rules.origin) ?? originOf(answer.canonical);
  if (origin === undefined) {
    return { ...decided, nodes: [], problems: [noSiteAddress(type)] };
  }
  const facts: PageFacts = {
    ctx,
    input,
    answer,
    document,
    origin,
    mapping: rule?.details?.[type] ?? {},
  };
  const { missing, ...description } = await describe(facts, type);
  const site = siteNodesOf(rules, answer, origin, input.locale);
  // The page's address is its canonical as its answer gives it, by the one
  // rule every output follows for a valid canonical. A page with none, such
  // as one whose type declares no address, is given no guessed one: only the
  // site is described.
  const url =
    answer.canonical === undefined
      ? undefined
      : absolute(answer.canonical, origin);
  if (url === undefined) {
    return { ...decided, nodes: site.nodes, problems: [] };
  }
  const page: DescribedPage = {
    url,
    ...(answer.title === undefined ? {} : { title: answer.title }),
    ...(answer.description === undefined
      ? {}
      : { description: answer.description }),
    ...(input.locale === undefined ? {} : { language: input.locale }),
  };
  return {
    ...decided,
    nodes: [...site.nodes, ...pageNodesOf(page, description, site, facts)],
    problems: missing,
  };
}
