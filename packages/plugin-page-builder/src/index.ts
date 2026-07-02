/**
 * "." entry — isomorphic, React-free public API.
 *
 * Exposes the core contracts + open registries (`defineBlock`, `createBlockRegistry`,
 * `defaultBlockRegistry`, control registry) and all types. The `pageBuilder()` plugin
 * factory and `pageBuilderField()` helper are added in later milestones.
 */
export * from "./core";
