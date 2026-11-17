import {
  getBlock,
  type AnyBlockDefinition,
  type BlockRegistryReader,
  type MigrationSource,
} from "@nextlyhq/blocks-engine";

import type {
  FormDrawing,
  FormReference,
  FormUnavailableDrawing,
} from "./context";

/**
 * How the renderer finds the definition for a stored node's `type`.
 *
 * An interface rather than a direct call into the engine's registry: each
 * site holds its own registry, so a renderer wired straight to one could only
 * ever render one set of blocks. Through a seam, a test renders fixtures
 * without registering anything, a canvas renders a document against the
 * editor's set, and two sites in one process can disagree about what
 * `core/hero` means.
 *
 * `PageRenderer` defaults to this bundle's registry, the one a browser bundle
 * such as the admin's editor fills. The Next.js routes default to the blocks
 * of the site they serve instead (`SITE_BLOCKS_SERVICE`).
 */
export interface BlockResolver {
  get(type: string): AnyBlockDefinition | undefined;
}

/**
 * This bundle's own registry: what the engine's module functions
 * (`registerBlocks`, `getBlock`) fill and read. In a browser bundle such as
 * the admin's editor, that is the one site's blocks. A server holds a
 * registry per site and fills none here, so a server render takes its site's
 * blocks instead.
 *
 * Deliberately a function, not a captured value: the registry is cleared and
 * rebuilt on a dev-server hot reload, so a resolver holding a snapshot would
 * keep serving definitions the boot has already replaced.
 */
export function registeredBlocks(): BlockResolver {
  return { get: getBlock };
}

/**
 * Where a Nextly instance offers its site's blocks: the page builder plugin's
 * read-only service holding the registry its boot filled. A route given no
 * `blocks` reads this from the process's instance on each render, so a site
 * draws its own registered blocks with nothing passed. One name, read by the
 * routes here and offered by the page builder, so the two cannot drift.
 *
 * @experimental Settles with the per-site block registry.
 */
export const SITE_BLOCKS_SERVICE = {
  plugin: "@nextlyhq/plugin-page-builder",
  service: "site-blocks",
} as const;

/**
 * Where a started page builder offers its site's named queries on the
 * instance, beside {@link SITE_BLOCKS_SERVICE}.
 *
 * @experimental Settles with the per-site block registry.
 */
export const SITE_NAMED_QUERIES_SERVICE: {
  readonly plugin: typeof SITE_BLOCKS_SERVICE.plugin;
  readonly service: "site-named-queries";
} = {
  plugin: SITE_BLOCKS_SERVICE.plugin,
  service: "site-named-queries",
};

/**
 * Where a started page builder offers what a routed page's forms need: the
 * receiver's address, the stored document each drawn document is, and the
 * description of a form picked from a provider. A route reads it on each
 * render to fill `ctx.forms`.
 *
 * @experimental Settles with the form provider contract.
 */
export const SITE_FORMS_SERVICE: {
  readonly plugin: typeof SITE_BLOCKS_SERVICE.plugin;
  readonly service: "site-forms";
} = {
  plugin: SITE_BLOCKS_SERVICE.plugin,
  service: "site-forms",
};

/**
 * What a started page builder offers under {@link SITE_FORMS_SERVICE}.
 *
 * @experimental Settles with the form provider contract.
 */
export interface SiteFormsService {
  /** The address every form on the site posts to. */
  readonly action: string;
  /**
   * The value naming the stored row's document as a form's post names it,
   * or `undefined` where the receiver reads no such document.
   */
  documentOf(row: {
    readonly collection: string;
    readonly id: string;
    readonly field: string;
    /** The entry is drawn by its design, its own blocks composed into it. */
    readonly design?: boolean;
  }): string | undefined;
  /** The value naming a component's document, as a form's post names it. */
  componentDocument(id: string): string;
  /** A form picked from a provider, as the public reads it. */
  describe(
    form: FormReference,
    locale: string | undefined
  ): Promise<FormDrawing | FormUnavailableDrawing>;
}

/**
 * The page builder's `site-forms` service as an instance offers it (its
 * `plugins`), or `undefined` where it offers none of that shape.
 */
export function offeredSiteForms(
  plugins: Readonly<Record<string, Readonly<Record<string, unknown>>>>
): SiteFormsService | undefined {
  const offered: unknown =
    plugins[SITE_FORMS_SERVICE.plugin]?.[SITE_FORMS_SERVICE.service];
  if (typeof offered !== "object" || offered === null) return undefined;
  const service = offered as Record<string, unknown>;
  return typeof service.action === "string" &&
    typeof service.documentOf === "function" &&
    typeof service.componentDocument === "function" &&
    typeof service.describe === "function"
    ? (offered as SiteFormsService)
    : undefined;
}

/**
 * Where a started page builder offers the site's page data limit on the
 * instance: `pageBuilder({ maxQueries })`, the reads one page render may
 * make, which a route given no `maxQueries` of its own renders under, so the
 * editor's meter and the published page count against one number.
 *
 * @experimental Settles with the editor's page data meter.
 */
export const SITE_PAGE_DATA_LIMIT_SERVICE: {
  readonly plugin: typeof SITE_BLOCKS_SERVICE.plugin;
  readonly service: "site-page-data-limit";
} = {
  plugin: SITE_BLOCKS_SERVICE.plugin,
  service: "site-page-data-limit",
};

/**
 * The limit a started page builder offers under
 * {@link SITE_PAGE_DATA_LIMIT_SERVICE}, or `undefined` where it offers none
 * or one that is not a count: a whole number from 0, or `Infinity`.
 */
export function offeredSitePageDataLimit(
  plugins: Readonly<Record<string, Readonly<Record<string, unknown>>>>
): number | undefined {
  const offered: unknown =
    plugins[SITE_PAGE_DATA_LIMIT_SERVICE.plugin]?.[
      SITE_PAGE_DATA_LIMIT_SERVICE.service
    ];
  if (typeof offered !== "object" || offered === null) return undefined;
  const limit = (offered as { maxQueries?: unknown }).maxQueries;
  return typeof limit === "number" &&
    (limit === Infinity || (Number.isInteger(limit) && limit >= 0))
    ? limit
    : undefined;
}

/**
 * The mark a site's own blocks or named queries carry when they are bound to
 * one page builder (`blocksOf`, `namedQueriesOf`): whether that page builder
 * started in this module copy. A production build bundles the plugin into
 * each route, and a route's copy never starts; a route then reads the started
 * site's through the instance. Keyed by `Symbol.for`, so a mark made by one
 * copy of this package is read by another.
 *
 * @experimental Settles with the per-site block registry.
 */
export const SITE_COPY: unique symbol = Symbol.for(
  "@nextlyhq/blocks-react/site-copy"
) as never;

/** What {@link SITE_COPY} marks. */
export interface SiteCopyMark {
  /** Whether the page builder it is bound to started in this module copy. */
  started(): boolean;
}

/** The {@link SITE_COPY} mark `value` carries, or `undefined`. */
export function siteCopyOf(value: unknown): SiteCopyMark | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const mark: unknown = (value as Record<symbol, unknown>)[SITE_COPY];
  return typeof mark === "object" &&
    mark !== null &&
    typeof (mark as { started?: unknown }).started === "function"
    ? (mark as SiteCopyMark)
    : undefined;
}

/**
 * The site's blocks as an instance offers them (its `plugins`), or
 * `undefined` when it offers none. The one reading of
 * {@link SITE_BLOCKS_SERVICE}, for the routes and the site style alike.
 */
export function offeredSiteBlocks(
  plugins: Readonly<Record<string, Readonly<Record<string, unknown>>>>
): BlockRegistryReader | undefined {
  const offered: unknown =
    plugins[SITE_BLOCKS_SERVICE.plugin]?.[SITE_BLOCKS_SERVICE.service];
  if (
    typeof offered === "object" &&
    offered !== null &&
    typeof (offered as { get?: unknown }).get === "function" &&
    typeof (offered as { all?: unknown }).all === "function"
  ) {
    return offered as BlockRegistryReader;
  }
  return undefined;
}

/**
 * A resolver over an explicit list, for tests and standalone rendering.
 *
 * A later definition with the same name replaces an earlier one rather than
 * being silently dropped, so composing a base set with an override reads the
 * way spreading an object does.
 */
export function createBlockResolver(
  definitions: readonly AnyBlockDefinition[]
): BlockResolver {
  const byName = new Map<string, AnyBlockDefinition>();
  for (const definition of definitions) byName.set(definition.name, definition);
  return { get: name => byName.get(name) };
}

/**
 * The migration view of a resolver.
 *
 * Derived from the resolver rather than taken from the engine's registry
 * helper, because the two must agree: migrating a document against the global
 * registry while rendering it against a fixture set would upgrade nodes to
 * versions the definitions doing the rendering have never heard of, and the
 * mismatch would surface as wrong props rather than as an error.
 */
export function migrationSourceFor(resolver: BlockResolver): MigrationSource {
  return {
    get: type => {
      const definition = resolver.get(type);
      if (!definition) return undefined;
      return definition.migrate === undefined
        ? { version: definition.version }
        : { version: definition.version, migrate: definition.migrate };
    },
  };
}
