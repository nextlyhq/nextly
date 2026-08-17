/**
 * `@nextlyhq/plugin-api-docs` public entry.
 *
 * @module index
 */
export { apiDocsPlugin, renderDocsHtml } from "./plugin";
export type { ApiDocsPluginOptions } from "./plugin";
export {
  generateOpenApiDocument,
  type OpenApiInput,
  type OpenApiDocument,
} from "./generate";
export {
  scanAppDirectory,
  classifyRouteSource,
  deriveMountPath,
  type ScanResult,
  type ScannedRoute,
  type RouteSource,
  type RouteVerb,
} from "./scan";
export { pluginRoutesToDocs } from "./plugin-routes";
export { restOperationsToDocs } from "./descriptors";
export { applyMountOverrides, type MountOverride } from "./mount-overrides";
export {
  applyExcludes,
  excludeOperationsByService,
  type ExcludeOptions,
} from "./excludes";
export type { DocsOperation, DocsVerb, DocsAuthMode } from "./descriptors";
