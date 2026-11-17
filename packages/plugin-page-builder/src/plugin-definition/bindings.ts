/**
 * Bindings: the "Bindings to fix" report (what it reads, the check of every
 * document it runs, and what each committed write's document is judged
 * again with), and the routes for a collection loop's menus, the named
 * queries, a list's entries, the canvas's bound props, the binding picker,
 * an unbind's plan and the report itself.
 */
import { DEFAULT_LIMITS } from "@nextlyhq/blocks-engine";
import type { PluginRoute, PluginRouteIdentity } from "@nextlyhq/plugin-sdk";

import { bindingFieldsRoute } from "../binding-fields-route";
import { schemaFingerprint } from "../bindings-report/fingerprint";
import { BINDINGS_REPORT_JOB } from "../bindings-report/job";
import { layoutRegionsOf } from "../bindings-report/layout-regions";
import {
  readableAsCaller,
  readableSingles,
  visibleBindings,
} from "../bindings-report/readable";
import { bindingsToFixRoute } from "../bindings-report/route";
import {
  registerBindingReportOnWrite,
  runFullCheck,
  type BindingReportDeps,
} from "../bindings-report/scan";
import { bindingReportStore } from "../bindings-report/store";
import { canvasBindingsRoute } from "../canvas-bindings-route";
import { canvasSourcesChangedRoute } from "../canvas-sources-changed-route";
import { COMPONENTS_SLUG } from "../collections/components";
import { LAYOUTS_SLUG } from "../collections/layouts";
import { PAGES_SLUG } from "../collections/pages";
import { PATTERNS_SLUG } from "../collections/patterns";
import { readLayoutSettings } from "../default-layout/store";
import {
  documentHosts,
  siteHostReader,
  siteWalkSource,
} from "../host-rewrite/site";
import { listEntriesRoute } from "../list-entries-route";
import { loopCollectionsRoute } from "../loop-collections-route";
import { namedQueriesRoute } from "../named-queries";
import { unbindPlanRoute } from "../unbind-plan-route";

import type { InitContext } from "./install-context";
import { componentStoreOf } from "./options";
import {
  collectionRegistryRows,
  fieldGroupRows,
  singleRegistryRows,
} from "./registry-reads";
import type { Definition } from "./state";

/** How often a read of the bindings report may start a check, at most. */
const BINDINGS_REFRESH_MS = 60_000;

/** How long a check a read starts may run. */
const BINDINGS_REFRESH_RUN_MS = 20_000;

/** The report's reads, its full check, and who may see how many rows. */
export interface BindingReportParts {
  readonly bindingReportDeps: BindingReportDeps;
  readonly bindingsVisibleTo: (
    user: PluginRouteIdentity["user"]
  ) => Promise<number>;
  readonly bindingReportPass: (deadline: Date) => Promise<unknown>;
}

/** The "Bindings to fix" report over the definition's installed context. */
export function bindingReportParts(def: Definition): BindingReportParts {
  const { opts, state, namedQuerySource, namedQueryDeclarations } = def;
  const bindingReportDeps: BindingReportDeps = {
    store: () =>
      state.bindingReportCtx === null
        ? null
        : bindingReportStore(
            state.bindingReportCtx.db,
            state.bindingReportCtx.dialect
          ),
    // Each source's declared fields, as a save judges bindings by them.
    shapesOf: async ref => {
      const { declaredFieldShapes } = await import("nextly/runtime");
      return declaredFieldShapes(ref);
    },
    // And a list's item bindings, against the rows its named query declares.
    namedQueries: namedQuerySource,
    // The site's blocks, whose definitions the bindings are read by.
    blocks: def.blocks,
    // Documents read as the walk reads them, and the components they place as
    // visitors are served them.
    reading: () => {
      const install = state.rewriteInstall;
      if (install === null) return null;
      const site = install.site;
      const read = siteHostReader(site);
      return {
        hostsOf: at => documentHosts(site, at),
        read,
        // A page's Layout, as visitors are served it: its regions' components
        // placed, so their bindings are judged against the page's entry.
        layoutOf: at => {
          const ctx = state.bindingReportCtx;
          const setup = state.defaultLayoutSetup;
          return ctx === null || setup === null
            ? Promise.resolve(undefined)
            : layoutRegionsOf(at, {
                pages: ctx.self.collections[PAGES_SLUG] ?? PAGES_SLUG,
                slugs: setup.slugs,
              });
        },
        components: async (id, draft) => {
          try {
            const found = await read({
              kind: "collection",
              slug: install.store.collection,
              id,
              path: [install.store.field],
            });
            const value =
              draft && found.draft !== null && found.draft.kind === "value"
                ? found.draft
                : found.published;
            return value.kind === "value"
              ? { kind: "document", document: value.value }
              : { kind: "absent" };
          } catch {
            return { kind: "unreadable" };
          }
        },
      };
    },
    // The sweep, started as soon as a write marks a document, at most once a
    // second; the jobs pass runs it where nothing starts it.
    kick: () => {
      const ctx = state.bindingReportCtx;
      const now = Date.now();
      if (ctx === null || now - state.bindingsKickedAt < 1000) return;
      state.bindingsKickedAt = now;
      ctx.services.jobs
        .runSweepNow(BINDINGS_REPORT_JOB, {
          maxDurationMs: BINDINGS_REFRESH_RUN_MS,
        })
        .catch((error: unknown) =>
          ctx.logger.warn(
            "[page-builder] the bindings report's judgement could not start; the next jobs pass runs it.",
            { error }
          )
        );
    },
    // A collection whose declaration holds no blocks field is not read
    // again on each write to it to say so.
    collectionMayHoldBlocks: collection =>
      state.writeReach.mayHoldBlocks(collection),
    limits: () => opts.limits ?? DEFAULT_LIMITS,
    placeOf: at => {
      if (at.kind === "single") return "singles";
      const own = state.bindingReportCtx?.self.collections ?? {};
      const named = (slug: string) => own[slug] ?? slug;
      if (at.slug === named(PAGES_SLUG)) return "pages";
      // The component store the composition reads, a configured one included.
      if (
        at.slug ===
        (state.rewriteInstall?.store.collection ?? named(COMPONENTS_SLUG))
      )
        return "components";
      if (at.slug === named(PATTERNS_SLUG)) return "patterns";
      if (at.slug === named(LAYOUTS_SLUG)) return "layouts";
      return "entries";
    },
  };
  /**
   * How many broken bindings a person may see, read as them by the report
   * route's own read, for the dashboard's card and attention line.
   */
  const bindingsVisibleTo = async (
    user: PluginRouteIdentity["user"]
  ): Promise<number> => {
    const ctx = state.bindingReportCtx;
    const store = bindingReportDeps.store();
    if (ctx === null || store === null) return 0;
    return visibleBindings(
      {
        caller: { identity: () => Promise.resolve({ user }) },
        services: ctx.services,
      },
      await store.list()
    );
  };
  /** The latest save among the documents named, for the fingerprint. */
  const latestSave = async (collections: readonly string[]) => {
    const { getCachedNextly } = await import("@nextlyhq/plugin-sdk");
    const nextly = await getCachedNextly();
    const parts: string[] = [];
    for (const collection of collections) {
      const found = await nextly.find({
        collection,
        sort: "-updatedAt",
        limit: 1,
        depth: 0,
        status: "all",
        overrideAccess: true,
      });
      const latest = (found.items[0] as { updatedAt?: unknown } | undefined)
        ?.updatedAt;
      parts.push(
        `${collection}:${String(found.meta.total)}:${JSON.stringify(latest ?? null)}`
      );
    }
    return parts.join("|");
  };
  /** One pass of the report's check of every document, until `deadline`. */
  const bindingReportPass = async (deadline: Date) => {
    const ctx = state.bindingReportCtx;
    const site = state.rewriteInstall?.site;
    if (ctx === null || site === undefined) return "paused" as const;
    const walk = siteWalkSource(site);
    return runFullCheck(
      {
        documents: cursor => walk.documents(cursor),
        cursorOf: document => walk.cursorOf(document),
        fingerprint: () =>
          schemaFingerprint({
            collections: () => collectionRegistryRows(ctx),
            singles: () => singleRegistryRows(ctx),
            fieldGroups: () => fieldGroupRows(),
            namedQueries: () => namedQueryDeclarations(),
            blocks: () => def.blocks.all(),
            designs: async () => {
              const saves = await latestSave([
                state.rewriteInstall?.store.collection ?? COMPONENTS_SLUG,
                state.defaultLayoutSetup?.slugs.layouts ?? LAYOUTS_SLUG,
              ]);
              // And the site's default Layout, which every page naming none
              // is drawn in.
              const setup = state.defaultLayoutSetup;
              if (setup === null) return saves;
              const { getCachedNextly } = await import("@nextlyhq/plugin-sdk");
              const settings = await readLayoutSettings(
                await getCachedNextly(),
                setup.slugs
              );
              return `${saves}|default:${settings.defaultLayout ?? ""}`;
            },
          }),
      },
      bindingReportDeps,
      deadline
    );
  };
  return { bindingReportDeps, bindingsVisibleTo, bindingReportPass };
}

/** Each committed write's document judged again for the report. */
export function installBindingReport(
  ctx: InitContext,
  def: Definition,
  bindingReportDeps: BindingReportDeps
): void {
  const { state } = def;
  // The "Bindings to fix" report: each committed write's document judged
  // again, and every document by the sweep once the schema changes.
  state.bindingReportCtx = ctx;
  registerBindingReportOnWrite(ctx, bindingReportDeps);
}

/** The routes bindings contribute, by name. */
export function routesForBindings(
  def: Definition,
  bindingReportDeps: BindingReportDeps
): {
  readonly loopCollections: PluginRoute;
  readonly namedQueries: PluginRoute;
  readonly listEntries: PluginRoute;
  readonly canvasBindings: PluginRoute;
  readonly canvasSourcesChanged: PluginRoute;
  readonly bindingFields: PluginRoute;
  readonly unbindPlan: PluginRoute;
  readonly bindingsToFix: PluginRoute;
} {
  const { opts, state, namedQueryDeclarations, requireTemplateGuard } = def;
  return {
    // A collection loop's menus: the collections the author may read,
    // the plugin's own stores left out, with each one's sortable fields.
    loopCollections: loopCollectionsRoute(componentStoreOf(opts)),
    // The site's named queries, without their run functions: what the
    // editor offers as a list's custom sources.
    namedQueries: namedQueriesRoute(namedQueryDeclarations),
    // A collection list's entries on the canvas, read as the author asking
    // reads them, drafts included, for a collection they may read. A
    // list whose source is a named query runs it here, on the server,
    // where its run function lives.
    listEntries: listEntriesRoute(
      name => state.namedQueries.definitionOf(name),
      requireTemplateGuard
    ),
    // The canvas's bound props: the entry being edited, the Singles its
    // bindings read and the site settings, read as the author asking.
    canvasBindings: canvasBindingsRoute(),
    // Whether what the canvas reads has changed since it read it: the
    // editor's change check, read as the author asking.
    canvasSourcesChanged: canvasSourcesChangedRoute(),
    // The fields the inspector's picker offers a binding, as the author
    // asking may read them, each marked by whether visitors may.
    bindingFields: bindingFieldsRoute(),
    // An unbind's plan for the inspector, against the document it holds:
    // the same decision as the page actions API's, applied by the editor.
    unbindPlan: unbindPlanRoute({
      limits: () => opts.limits ?? DEFAULT_LIMITS,
      blocks: def.blocks,
    }),
    // The documents whose bindings no longer fit, for those who edit
    // pages, each listed only when the caller may read it.
    bindingsToFix: bindingsToFixRoute({
      store: bindingReportDeps.store,
      readable: (routeCtx, entries) => readableAsCaller(routeCtx, entries),
      // A read starts a check when the schema may have changed, at most
      // once a minute, and never waits for it.
      refresh: routeCtx => {
        const now = Date.now();
        if (now - state.bindingsRefreshedAt < BINDINGS_REFRESH_MS) return;
        state.bindingsRefreshedAt = now;
        routeCtx.services.jobs
          .runSweepNow(BINDINGS_REPORT_JOB, {
            maxDurationMs: BINDINGS_REFRESH_RUN_MS,
          })
          .catch((error: unknown) =>
            state.bindingReportCtx?.logger.warn(
              "[page-builder] the bindings report's check could not start; the next jobs pass runs it.",
              { error }
            )
          );
      },
      // Where a Layout region's binding is edited, and the language the
      // builder edits, for each row's way into the editor.
      componentStore: () =>
        state.rewriteInstall?.store.collection ??
        state.bindingReportCtx?.self.collections[COMPONENTS_SLUG] ??
        COMPONENTS_SLUG,
      defaultLocale: () =>
        state.bindingReportCtx?.config.localization?.defaultLocale,
      readableSingles: (routeCtx, slugs) => readableSingles(routeCtx, slugs),
      blocks: def.blocks,
    }),
  };
}
