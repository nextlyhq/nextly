/**
 * The structured data types a page can be described as, and the details each
 * one needs.
 *
 * Each type offered is one search engines read: most can earn a rich result
 * in Google, and the rest (an About or Contact page, technical writing,
 * source code, an app without ratings) still tell search and answer engines
 * what the page is. {@link StructuredDataType.richResult} says which. Each
 * type names the details it cannot be described without: where one is
 * missing, the type's markup is left out and the page lists a problem naming
 * the detail, rather than sending Google a description it would reject.
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
  | "bestRating"
  | "ratingCount"
  | "startDate"
  | "location"
  | "videoFile"
  | "uploadDate"
  | "itemReviewed"
  | "itemType"
  | "streetAddress"
  | "openingHours"
  | "dateModified"
  | "keywords"
  | "articleSection"
  | "wordCount"
  | "applicationCategory"
  | "codeRepository"
  | "programmingLanguage"
  | "license"
  | "questions";

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
  bestRating: "best rating",
  ratingCount: "rating count",
  startDate: "start date",
  location: "location",
  videoFile: "video file",
  uploadDate: "upload date",
  itemReviewed: "item reviewed",
  itemType: "item type",
  streetAddress: "street address",
  openingHours: "opening hours",
  dateModified: "date modified",
  keywords: "keywords",
  articleSection: "section",
  wordCount: "word count",
  applicationCategory: "app category",
  codeRepository: "code repository",
  programmingLanguage: "programming language",
  license: "license",
  questions: "questions and answers",
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
  bestRating: ["bestRating", "ratingScale", "outOf"],
  ratingCount: ["ratingCount", "reviewCount", "ratings"],
  startDate: ["startDate", "startsAt", "start", "eventDate"],
  location: ["location", "venue", "place"],
  videoFile: ["video", "videoUrl", "videoFile", "contentUrl"],
  uploadDate: ["uploadDate", "uploadedAt", "publishedAt", "datePublished"],
  itemReviewed: ["itemReviewed", "item", "product", "subject"],
  itemType: ["itemType", "itemReviewedType"],
  streetAddress: ["streetAddress", "address"],
  openingHours: ["openingHours", "hours"],
  // A correction or review date is the one a reader should see; the row's
  // own `updatedAt` changes with every save, so it is the last guess.
  dateModified: [
    "dateModified",
    "modifiedAt",
    "correctedAt",
    "revisedAt",
    "lastReviewed",
    "updatedAt",
  ],
  keywords: ["keywords", "tags"],
  articleSection: ["articleSection", "section", "category", "categories"],
  // Counted from the page's body where no field holds a count.
  wordCount: ["wordCount"],
  applicationCategory: ["applicationCategory", "appCategory"],
  codeRepository: [
    "codeRepository",
    "repository",
    "repositoryUrl",
    "repo",
    "sourceCode",
  ],
  programmingLanguage: ["programmingLanguage"],
  license: ["license", "licence"],
  // The route's own questions win; a field is read where it gives none.
  questions: ["faq", "faqs", "questions"],
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
  /**
   * Whether Google can show the page with a rich result for it once every
   * detail Google asks for is there: `false` for a type that describes the
   * page to search and answer engines without one, such as an About page,
   * or an app with no ratings, and for questions and answers, which Google
   * no longer shows as a rich result.
   */
  readonly richResult: boolean;
  /**
   * What a person choosing the type is told beside its name, where there is
   * something they should know first, such as a result Google no longer
   * shows.
   */
  readonly note?: string;
}

/** A type's key, as a content type's choice and a page's choice store it. */
export type StructuredDataTypeKey =
  | "article"
  | "blogPosting"
  | "techArticle"
  | "webPage"
  | "aboutPage"
  | "contactPage"
  | "collectionPage"
  | "faqPage"
  | "profilePage"
  | "softwareApplication"
  | "softwareSourceCode"
  | "product"
  | "event"
  | "videoObject"
  | "review"
  | "localBusiness";

/** What an article of any kind is described with where the page has it. */
const ARTICLE_EXTRAS: readonly StructuredDataDetail[] = [
  "dateModified",
  "keywords",
  "articleSection",
  "wordCount",
];

/** Every type offered, by its key. */
export const STRUCTURED_DATA_TYPES: Readonly<
  Record<StructuredDataTypeKey, StructuredDataType>
> = {
  article: {
    label: "Article",
    schemaType: "Article",
    page: false,
    needs: ["author", "datePublished", "image"],
    uses: ARTICLE_EXTRAS,
    richResult: true,
  },
  blogPosting: {
    label: "Blog post",
    schemaType: "BlogPosting",
    page: false,
    needs: ["author", "datePublished", "image"],
    uses: ARTICLE_EXTRAS,
    richResult: true,
  },
  techArticle: {
    label: "Technical article",
    schemaType: "TechArticle",
    page: false,
    // Documentation often has no byline or date: described from its title,
    // with whatever of the rest the page has.
    needs: [],
    uses: ["author", "datePublished", "image", ...ARTICLE_EXTRAS],
    richResult: true,
  },
  webPage: {
    label: "Web page",
    schemaType: "WebPage",
    page: true,
    needs: [],
    uses: [],
    richResult: false,
  },
  aboutPage: {
    label: "About page",
    schemaType: "AboutPage",
    page: true,
    needs: [],
    uses: [],
    richResult: false,
  },
  contactPage: {
    label: "Contact page",
    schemaType: "ContactPage",
    page: true,
    needs: [],
    uses: [],
    richResult: false,
  },
  collectionPage: {
    label: "Collection page",
    schemaType: "CollectionPage",
    page: true,
    needs: [],
    uses: [],
    richResult: false,
  },
  faqPage: {
    label: "Questions and answers",
    schemaType: "FAQPage",
    page: true,
    needs: ["questions"],
    uses: [],
    // Google stopped showing these as a rich result in May 2026. The kind
    // stays on offer for a site that chooses it, and is never added to a
    // page of another kind.
    richResult: false,
    note: "no longer shown by Google",
  },
  profilePage: {
    label: "Profile page",
    schemaType: "ProfilePage",
    page: true,
    needs: ["person"],
    uses: [],
    richResult: true,
  },
  softwareApplication: {
    label: "Software app",
    schemaType: "SoftwareApplication",
    page: false,
    // Google shows an app with a rich result only with a price and a
    // rating. Without them it is still described, and no rating is ever
    // made up to earn one.
    needs: [],
    uses: [
      "operatingSystem",
      "applicationCategory",
      "price",
      "currency",
      "rating",
      "ratingCount",
      "bestRating",
      "image",
    ],
    richResult: true,
  },
  softwareSourceCode: {
    label: "Source code",
    schemaType: "SoftwareSourceCode",
    page: false,
    needs: ["codeRepository"],
    uses: ["programmingLanguage", "license"],
    richResult: false,
  },
  product: {
    label: "Product",
    schemaType: "Product",
    page: false,
    needs: ["price", "availability"],
    uses: ["currency", "image"],
    richResult: true,
  },
  event: {
    label: "Event",
    schemaType: "Event",
    page: false,
    needs: ["startDate", "location"],
    uses: ["image"],
    richResult: true,
  },
  videoObject: {
    label: "Video",
    schemaType: "VideoObject",
    page: false,
    // Google needs a thumbnail, which is the page's image.
    needs: ["videoFile", "uploadDate", "image"],
    uses: [],
    richResult: true,
  },
  review: {
    label: "Review",
    schemaType: "Review",
    page: false,
    // Google needs who wrote a review and what kind of thing it reviews.
    needs: ["author", "itemReviewed", "itemType", "rating"],
    uses: ["bestRating"],
    richResult: true,
  },
  localBusiness: {
    label: "Local business",
    schemaType: "LocalBusiness",
    page: false,
    needs: ["streetAddress", "openingHours"],
    uses: ["image"],
    richResult: true,
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
  "webPage",
  "aboutPage",
  "contactPage",
  "collectionPage",
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

/**
 * A type as a chooser lists it: its name, with its note beside it where it
 * has one, so every chooser of a type says the same. Once chosen, a
 * chooser names the type alone, so the choice fits its box.
 */
export function structuredDataChoiceText(key: StructuredDataTypeKey): string {
  const { label, note } = STRUCTURED_DATA_TYPES[key];
  return note === undefined ? label : `${label} · ${note}`;
}
