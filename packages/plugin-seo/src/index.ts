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
  seoIssuesWidgetSource,
  issuesFor,
  checksFor,
  issueFilter,
  SEO_ISSUES_SOURCE_ID,
  ISSUE_FIELD,
  ISSUE_SCAN_ROW_BUDGET,
  ISSUE_SCAN_PAGE_SIZE,
} from "./widget-source";
export type { IssueChecks } from "./widget-source";
export type {
  CollectionReads,
  EntriesPage,
  EntriesQuery,
} from "./collection-reads";
export { seoIssuesWidget, SEO_ISSUES_WIDGET_ID } from "./widget-card";
export { reportableIssues } from "./widget-source";
