/**
 * `@nextlyhq/plugin-seo` public entry.
 *
 * @module index
 */
export { seoPlugin } from "./plugin";
export type { SeoPluginOptions } from "./plugin";
export { defaultSeoFields } from "./fields";
// Pages with no entry: the one line a page built in code adds so the SEO set
// for its address on the Pages and addresses screen reaches its head.
export { seoMetadata } from "./code-pages/metadata";
export type { RouteMetadata, SeoMetadataOptions } from "./code-pages/metadata";
export {
  buildSitemapUrls,
  serializeSitemap,
  generateSitemap,
  escapeXml,
  defaultUrlForEntry,
} from "./sitemap";
export type {
  SitemapUrl,
  SitemapOptions,
  SitemapServices,
  UrlForEntry,
} from "./sitemap";
export {
  issuesFor,
  checksFor,
  reportableIssues,
  ISSUE_SCAN_ROW_BUDGET,
} from "./widget-source";
export type { IssueChecks } from "./widget-source";
// The listing every address-listing output reads, as the plugin's
// `listedPages` service hands it out, and the AI crawler choices robots.txt
// answers.
export type {
  ListedPage,
  ListedPagesService,
  ListingProblem,
} from "./outputs/listing";
export type { AiCrawlerChoice } from "./outputs/robots";
// Languages: the code each of the site's languages is named by in language
// links and why one is left out, and a page's links to its other languages.
export { hreflangCodes, hreflangOf } from "./languages/hreflang";
export type { Hreflang, LanguageCodeProblem } from "./languages/hreflang";
export { pageLanguageLinks } from "./languages/head";
export type { PageLanguageLinks } from "./languages/head";
export type { LanguageLink } from "./languages/links";
export type {
  CollectionReads,
  EntriesPage,
  EntriesQuery,
} from "./collection-reads";
// The dashboard card's id, for a site's `admin.dashboard` (`defaultLayout`,
// `hide`, `overrides`). The card and its Needs attention lines reach the
// dashboard through `seoPlugin`, so no declaration is exported.
export { SEO_ISSUES_WIDGET_ID } from "./widget-card";
// The site's SEO settings, as rules for a page's head and as brand facts,
// and the cache tags a read of them carries, which every save expires.
export { readBrandFacts, readSeoRules } from "./settings/rules";
export type {
  BrandFacts,
  SeoRules,
  SocialProfile,
  TypePatterns,
} from "./settings/rules";
export { seoSettingsCacheTags } from "./settings/single";
// Structured data: the types a page can be described as, a page's graph and
// the problems that keep a chosen type out, and the rules it is read with.
export {
  DETAIL_LABELS,
  REVIEWED_ITEM_TYPES,
  STRUCTURED_DATA_TYPES,
  STRUCTURED_DATA_TYPE_KEYS,
  isStructuredDataTypeKey,
  structuredDataTypesFor,
} from "./structured-data/catalog";
export type {
  StructuredDataDetail,
  StructuredDataType,
  StructuredDataTypeKey,
} from "./structured-data/catalog";
export {
  pageStructuredData,
  structuredDataProblems,
  withStructuredData,
} from "./structured-data/provider";
export type { StructuredDataReaders } from "./structured-data/provider";
export type {
  PageStructuredData,
  StructuredDataChoice,
  StructuredDataNode,
  StructuredDataProblem,
} from "./structured-data/graph";
export type {
  DetailMapping,
  DetailSource,
  ReadStructuredDataRules,
  StructuredDataBrand,
  StructuredDataOptions,
  StructuredDataRules,
  StructuredDataTypeRule,
} from "./structured-data/rules";
// Social cards: the size a share image shows in full and why a picture does
// not, a page's share image problems, and the action that makes a share image
// of the right size.
export {
  SHARE_IMAGE,
  SHARE_IMAGE_ROUTE_PATH,
  shareImageSizeProblem,
} from "./social/contract";
export type {
  MadeShareImageItem,
  MakeShareImageRequest,
} from "./social/contract";
export { shareImageProblems } from "./social/problems";
export type { ShareImageProblem, ShareImageReaders } from "./social/problems";
export type { SocialCardOptions } from "./social/card";
// Logs the address a not-found page was asked for, from the site's
// not-found page. Redirects themselves reach requests through the site's
// Proxy, which `seoPlugin` contributes a handler to.
export { logNotFound } from "./not-found/report";
export type { HeaderReader } from "./not-found/report";
