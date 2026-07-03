/**
 * "." entry — isomorphic, React-free public API.
 *
 * Exposes the core contracts + open registries (`defineBlock`, `defaultBlockRegistry`,
 * control registry, tree/validate/migrate/style/bindings) and the `pageBuilder()` plugin
 * factory. The React editor lives on `./admin`; the renderer on `./render`.
 */
export * from "./core";
export { pageBuilder } from "./plugin";
export type { PageBuilderOptions } from "./plugin";
export { pagesCollection, EDIT_VIEW_PATH } from "./collections/pages";
