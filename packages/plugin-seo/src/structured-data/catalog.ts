/**
 * The structured data types a page can be described as, and the details each
 * one needs.
 *
 * Only types Google still shows a result for are offered, so a person never
 * picks one that changes nothing. Each type names the details it cannot be
 * described without: where one is missing, the type's markup is left out and
 * the page lists a problem naming the detail, rather than sending Google a
 * description it would reject.
 *
 * @module structured-data/catalog
 */

/** A detail a type is described with, read from a field of the page. */
export type StructuredDataDetail =
  | "author"
  | "datePublished"
  | "image"
  | "person"
  | "operatingSystem"
  | "price"
  | "currency"
  | "availability"
  | "rating"
  | "ratingCount"
  | "startDate"
  | "location"
  | "videoFile"
  | "uploadDate"
  | "itemReviewed"
  | "itemType"
  | "streetAddress"
  | "openingHours";

/** Each detail as a person reads it, in a problem or a mapping. */
export const DETAIL_LABELS: Readonly<Record<StructuredDataDetail, string>> = {
  author: "author",
  datePublished: "date published",
  image: "image",
  person: "person",
  operatingSystem: "operating system",
  price: "price",
  currency: "currency",
  availability: "availability",
  rating: "rating",
  ratingCount: "rating count",
  startDate: "start date",
  location: "location",
  videoFile: "video file",
  uploadDate: "upload date",
  itemReviewed: "item reviewed",
  itemType: "item type",
  streetAddress: "street address",
  openingHours: "opening hours",
};

/**
 * The fields a detail is looked for in, in order, until the content type maps
 * one. Matched by name in any spelling (`publishedAt`, `published_at`).
 */
export const DETAIL_GUESSES: Readonly<
  Record<StructuredDataDetail, readonly string[]>
> = {
  author: ["author", "authors", "writer"],
  datePublished: [
    "publishedAt",
    "datePublished",
    "publishDate",
    "publishedDate",
    "published",
  ],
  // The page's own share image, from the order of who wins, where no field
  // is mapped.
  image: [],
  person: ["name", "fullName"],
  operatingSystem: ["operatingSystem", "platform", "os"],
  price: ["price"],
  currency: ["currency", "priceCurrency"],
  availability: ["availability", "inStock", "stock"],
  rating: ["rating", "ratingValue", "stars", "score"],
  ratingCount: ["ratingCount", "reviewCount", "ratings"],
  startDate: ["startDate", "startsAt", "start", "eventDate"],
  location: ["location", "venue", "place"],
  videoFile: ["video", "videoUrl", "videoFile", "contentUrl"],
  uploadDate: ["uploadDate", "uploadedAt", "publishedAt", "datePublished"],
  itemReviewed: ["itemReviewed", "item", "product", "subject"],
  itemType: ["itemType", "itemReviewedType"],
  streetAddress: ["streetAddress", "address"],
  openingHours: ["openingHours", "hours"],
};

/** One structured data type a page can be described as. */
export interface StructuredDataType {
  /** The type as a person picks it. */
  readonly label: string;
  /** The schema.org type it is written as. */
  readonly schemaType: string;
  /**
   * Whether it describes the page itself (`WebPage` and its kinds) rather
   * than a thing the page is about, which is described beside the page.
   */
  readonly page: boolean;
  /** The details it cannot be described without. */
  readonly needs: readonly StructuredDataDetail[];
  /** The details it is described with where the page has them. */
  readonly uses: readonly StructuredDataDetail[];
}

/** A type's key, as a content type's choice and a page's choice store it. */
export type StructuredDataTypeKey =
  | "article"
  | "blogPosting"
  | "webPage"
  | "collectionPage"
  | "profilePage"
  | "softwareApplication"
  | "product"
  | "event"
  | "videoObject"
  | "review"
  | "localBusiness";

/** Every type offered, by its key. */
export const STRUCTURED_DATA_TYPES: Readonly<
  Record<StructuredDataTypeKey, StructuredDataType>
> = {
  article: {
    label: "Article",
    schemaType: "Article",
    page: false,
    needs: ["author", "datePublished", "image"],
    uses: [],
  },
  blogPosting: {
    label: "Blog post",
    schemaType: "BlogPosting",
    page: false,
    needs: ["author", "datePublished", "image"],
    uses: [],
  },
  webPage: {
    label: "Web page",
    schemaType: "WebPage",
    page: true,
    needs: [],
    uses: [],
  },
  collectionPage: {
    label: "Collection page",
    schemaType: "CollectionPage",
    page: true,
    needs: [],
    uses: [],
  },
  profilePage: {
    label: "Profile page",
    schemaType: "ProfilePage",
    page: true,
    needs: ["person"],
    uses: [],
  },
  softwareApplication: {
    label: "Software app",
    schemaType: "SoftwareApplication",
    page: false,
    // Google shows an app only with its rating, so the rating is needed too.
    needs: ["operatingSystem", "price", "rating", "ratingCount"],
    uses: ["currency", "image"],
  },
  product: {
    label: "Product",
    schemaType: "Product",
    page: false,
    needs: ["price", "availability"],
    uses: ["currency", "image"],
  },
  event: {
    label: "Event",
    schemaType: "Event",
    page: false,
    needs: ["startDate", "location"],
    uses: ["image"],
  },
  videoObject: {
    label: "Video",
    schemaType: "VideoObject",
    page: false,
    // Google needs a thumbnail, which is the page's image.
    needs: ["videoFile", "uploadDate", "image"],
    uses: [],
  },
  review: {
    label: "Review",
    schemaType: "Review",
    page: false,
    // Google needs who wrote a review and what kind of thing it reviews.
    needs: ["author", "itemReviewed", "itemType", "rating"],
    uses: [],
  },
  localBusiness: {
    label: "Local business",
    schemaType: "LocalBusiness",
    page: false,
    needs: ["streetAddress", "openingHours"],
    uses: ["image"],
  },
};

/**
 * The keys of every type offered, in the order they are offered: the
 * catalog's own order, so a type added there is offered and accepted alike.
 */
export const STRUCTURED_DATA_TYPE_KEYS: readonly StructuredDataTypeKey[] =
  Object.keys(STRUCTURED_DATA_TYPES) as StructuredDataTypeKey[];

/** True for a stored choice naming a type that is offered. */
export function isStructuredDataTypeKey(
  value: unknown
): value is StructuredDataTypeKey {
  return (
    typeof value === "string" && Object.hasOwn(STRUCTURED_DATA_TYPES, value)
  );
}

/**
 * The kinds of thing Google accepts as the subject of a review, which is what
 * a review's item type may be.
 */
export const REVIEWED_ITEM_TYPES = [
  "Book",
  "Course",
  "CreativeWorkSeason",
  "CreativeWorkSeries",
  "Episode",
  "Event",
  "Game",
  "HowTo",
  "LocalBusiness",
  "MediaObject",
  "Movie",
  "MusicPlaylist",
  "MusicRecording",
  "Organization",
  "Product",
  "Recipe",
  "SoftwareApplication",
] as const;

/** The types a page hidden from search may be described as. */
const HIDDEN_PAGE_TYPES: readonly StructuredDataTypeKey[] = [
  "collectionPage",
  "webPage",
];

/**
 * The types offered for a page: every type, or for a page hidden from search,
 * only the kinds of page, since nothing it describes can be shown in search.
 */
export function structuredDataTypesFor(page: {
  hidden: boolean;
}): readonly StructuredDataTypeKey[] {
  return page.hidden ? HIDDEN_PAGE_TYPES : STRUCTURED_DATA_TYPE_KEYS;
}
