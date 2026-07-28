/**
 * `runtime/seo` — Next-coupled SEO bridges that turn the `@nextlyhq/plugin-seo`
 * field group into Next.js primitives. Type-only `next` imports, so nothing
 * here forces `next` at load.
 *
 * @module runtime/seo
 */
export { buildMetadata } from "./build-metadata";
export type {
  BuildMetadataOptions,
  MetadataEntry,
  SeoMetaInput,
} from "./build-metadata";
