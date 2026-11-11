/**
 * `@nextlyhq/plugin-seo` public entry.
 *
 * @module index
 */
export { seoPlugin } from "./plugin";
export type { SeoPluginOptions } from "./plugin";
export { defaultSeoFields } from "./fields";
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
export type {
  CollectionReads,
  EntriesPage,
  EntriesQuery,
} from "./collection-reads";
// The dashboard card's id, for a site's `admin.dashboard` (`defaultLayout`,
// `hide`, `overrides`). The card and its Needs attention lines reach the
// dashboard through `seoPlugin`, so no declaration is exported.
export { SEO_ISSUES_WIDGET_ID } from "./widget-card";
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
