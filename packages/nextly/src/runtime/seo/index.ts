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

// The page-metadata contract a plugin provides.
export {
  PAGE_METADATA_CAPABILITY,
  PAGE_METADATA_SERVICE,
} from "./page-metadata-contract";
export type {
  PageMetadataAnswer,
  PageMetadataImage,
  PageMetadataInput,
  PageMetadataResolver,
  PageMetadataSource,
  PageMetadataValues,
} from "./page-metadata-contract";
