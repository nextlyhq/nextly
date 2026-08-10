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
