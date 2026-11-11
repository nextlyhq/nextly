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
   * content type's mapping (`mapping`, no field holds it), or in the SEO
   * settings (`settings`, the site's address).
   */
  fix: "content" | "mapping" | "settings";
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
async function detailValue(
  facts: PageFacts,
  detail: StructuredDataDetail,
  read: DetailRead
): Promise<DetailValue> {
  const { ctx, input, answer, origin } = facts;
  switch (detail) {
    case "author":
    case "person": {
      const named = await namedOf(ctx, input, read, origin);
      return named === undefined ? undefined : personNode(named);
    }
    case "itemReviewed": {
      const named = await namedOf(ctx, input, read, origin);
      return named?.name;
    }
    case "image": {
      // The page's own share image, from the order of who wins, unless the
      // content type maps another field.
      const picture =
        facts.mapping.image === undefined
          ? answer.social?.image
          : await pictureOf(ctx, read);
      return imageNode(picture, origin);
    }
    case "datePublished":
    case "startDate":
    case "uploadDate":
      return dateOf(read.value);
    case "price":
    case "rating":
      return numberOf(read.value);
    case "ratingCount":
      return countOf(read.value);
    case "currency":
      return currencyOf(read.value);
    case "availability":
      return availabilityOf(read.value);
    case "location":
      return placeOf(read.value);
    case "streetAddress":
      return postalAddressOf(read.value);
    case "openingHours":
      return openingHoursOf(read.value);
    case "videoFile":
      return fileOf(read.value, origin);
    case "itemType":
      return itemTypeOf(read.value);
    case "operatingSystem":
      return textOf(read.value);
  }
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
    const value = await detailValue(facts, detail, read);
    if (value !== undefined) {
      values[detail] = value;
      continue;
    }
    if (!needs.includes(detail)) continue;
    // A field to fill in on the page, or none mapped to read it from. The
    // share image is the page's own, so it is filled in on the page.
    const onPage = read.field !== undefined || detail === "image";
    missing.push({
      type,
      detail,
      message: `Missing: ${DETAIL_LABELS[detail]}.`,
      fix: onPage ? "content" : "mapping",
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
        publisher:
          links.organization === undefined
            ? undefined
            : { "@id": links.organization },
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
  // The site's address decides every absolute address; a language served on
  // its own domain gives its own in the page's canonical.
  const origin = originOf(rules.origin) ?? originOf(answer.canonical);
  const { type, chosen } = chosenType(
    { document },
    rule,
    offered,
    automaticType(document, hidden)
  );
  if (origin === undefined) {
    return {
      type,
      chosen,
      offered,
      nodes: [],
      problems: [
        {
          type,
          detail: "siteAddress",
          message: "Missing: the site's address.",
          fix: "settings",
        },
      ],
    };
  }
  const facts: PageFacts = {
    ctx,
    input,
    answer,
    document,
    origin,
    mapping: rule?.details?.[type] ?? {},
  };
  const { values, missing } = await detailsOf(facts, type);
  // A described thing is named by the page's title, as the head names it.
  if (!STRUCTURED_DATA_TYPES[type].page && answer.title === undefined) {
    missing.unshift({
      type,
      detail: "title",
      message: "Missing: title.",
      fix: "content",
    });
  }
  const described = missing.length === 0;
  const definition = STRUCTURED_DATA_TYPES[type];

  const siteName = answer.social?.siteName ?? rules.brand.name;
  const brandName = rules.brand.name ?? siteName;
  const home = `${origin}/`;
  const organizationId =
    brandName === undefined ? undefined : `${home}#organization`;
  const websiteId = siteName === undefined ? undefined : `${home}#website`;
  const language = input.locale;
  const updated = dateOf(document.updatedAt);

  const nodes: StructuredDataNode[] = [];
  if (organizationId !== undefined && brandName !== undefined) {
    const profiles = (rules.brand.profiles ?? [])
      .map(profile => originOf(profile.url) && profile.url)
      .filter((profile): profile is string => typeof profile === "string");
    nodes.push(
      node({
        "@type": "Organization",
        "@id": organizationId,
        name: brandName,
        alternateName:
          (rules.brand.otherNames ?? []).length > 0
            ? [...(rules.brand.otherNames ?? [])]
            : undefined,
        url: home,
        logo: imageNode(rules.brand.logo, origin),
        sameAs: profiles.length > 0 ? profiles : undefined,
      })
    );
  }
  if (websiteId !== undefined && siteName !== undefined) {
    nodes.push(
      node({
        "@type": "WebSite",
        "@id": websiteId,
        url: home,
        name: siteName,
        publisher:
          organizationId === undefined ? undefined : { "@id": organizationId },
        inLanguage: language,
      })
    );
  }
  // The page's address is its canonical as its answer gives it, by the one
  // rule every output follows for a valid canonical. A page with none, such
  // as one whose type declares no address, is given no guessed one: only the
  // site is described.
  const url =
    answer.canonical === undefined
      ? undefined
      : absolute(answer.canonical, origin);
  if (url === undefined) return { type, chosen, offered, nodes, problems: [] };
  const pagePath = new URL(url).pathname;
  // A trail from the site's home, named by the site's name, to the page: a
  // site with no name, or the home page itself, has none to show.
  const breadcrumbId =
    pagePath !== "/" && answer.title !== undefined && siteName !== undefined
      ? `${url}#breadcrumb`
      : undefined;
  // The page node: its own kind where the page is described as one and has
  // what it needs, else a web page.
  const pageType =
    definition.page && described ? definition.schemaType : "WebPage";
  const image = imageNode(answer.social?.image, origin);
  nodes.push(
    node({
      "@type": pageType,
      "@id": url,
      url,
      name: answer.title,
      description: answer.description,
      isPartOf: websiteId === undefined ? undefined : { "@id": websiteId },
      primaryImageOfPage: image,
      breadcrumb:
        breadcrumbId === undefined ? undefined : { "@id": breadcrumbId },
      mainEntity:
        type === "profilePage" && described ? values.person : undefined,
      inLanguage: language,
    })
  );
  if (
    breadcrumbId !== undefined &&
    answer.title !== undefined &&
    siteName !== undefined
  ) {
    nodes.push({
      "@type": "BreadcrumbList",
      "@id": breadcrumbId,
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: siteName,
          item: home,
        },
        { "@type": "ListItem", position: 2, name: answer.title },
      ],
    });
  }
  if (!definition.page && described) {
    nodes.push(
      subjectNode(
        type,
        values,
        {
          url,
          ...(answer.title === undefined ? {} : { title: answer.title }),
          ...(answer.description === undefined
            ? {}
            : { description: answer.description }),
        },
        {
          ...(organizationId === undefined
            ? {}
            : { organization: organizationId }),
          ...(language === undefined ? {} : { language }),
          ...(updated === undefined ? {} : { modified: updated }),
        }
      )
    );
  }
  return { type, chosen, offered, nodes, problems: missing };
}
