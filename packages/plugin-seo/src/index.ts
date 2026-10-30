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
export type {
  CollectionReads,
  EntriesPage,
  EntriesQuery,
} from "./collection-reads";
// The dashboard card's id, for a site's `admin.dashboard` (`defaultLayout`,
// `hide`, `overrides`). The card and its Needs attention line reach the
// dashboard through `seoPlugin`, so neither declaration is exported.
export { SEO_ISSUES_WIDGET_ID } from "./widget-card";
