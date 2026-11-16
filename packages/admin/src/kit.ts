/**
 * `@nextlyhq/admin/kit`: everything the admin offers to code outside it,
 * beyond what an application mounts.
 *
 * INTERNAL, and unstable as a path. It exists for `@nextlyhq/plugin-sdk/admin`,
 * which re-exports it to plugins and is the one surface plugin authors import
 * (see `packages/plugin-sdk/STABILITY.md`). Nothing else should import it: its
 * exports change in any release, under the SDK's stability tags.
 *
 * It is apart from the root (`./index.ts`) because the root is the admin's
 * first load: a component exported there is downloaded before any screen
 * draws. It re-exports everything the root does too, so it is the whole
 * surface in one place.
 *
 * The surface is held in areas, each its own entry under `./kit/`: the core
 * (state, data, primitives, the registry), the media library, the field-UI
 * kit, the data table, the document surfaces, the widget kit and the
 * plugin-page parts. The SDK re-exports each name from its area, and declares
 * its admin entry free of side effects, so an application's bundler follows
 * only the areas a plugin's imports name: a plugin's admin module, which the
 * generated component map imports with the admin's first load, brings the
 * parts it uses and not the media library or the field-UI kit. This entry is
 * every area at once, for code that wants the whole surface.
 *
 * @module kit
 */
export * from "./kit/core";
export * from "./kit/document";
export * from "./kit/field-ui";
export * from "./kit/media";
export * from "./kit/plugin-parts";
export * from "./kit/table";
export * from "./kit/widgets";
