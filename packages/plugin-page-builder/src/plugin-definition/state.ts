/**
 * What the Page Builder's definition holds from the moment it is defined:
 * the holders `init` fills for the parts made before it runs and called long
 * after it, and the values and accessors worked out from the options, which
 * the route areas, the services and the jobs share.
 */
import {
  createBlockRegistry,
  createNamedQueryRegistry,
  type BlockRegistry,
  namedQueryDeclaration,
  type NamedQueryRegistry,
  type NamedQuerySource,
  type NamedQueryDeclaration,
} from "@nextlyhq/blocks-engine";
import type { getCachedNextly } from "@nextlyhq/plugin-sdk";

import type { ContentAddressService } from "../address-claims/content-addresses";
import type { RemovalInstall } from "../breakpoint-removal/service";
import { canvasPathOption } from "../canvas-path";
import type { CommittedWriteReconciler } from "../class-usage-hook";
import type { CollectionReach } from "../collection-reach";
import type { ComponentDeleteSweepDeps } from "../component-delete/sweep";
import { withCoreLooks } from "../core-looks";
import type { EnsureDefaultDeps } from "../default-layout/ensure-default";
import type { DefaultLayoutSetup } from "../default-layout/install";
import type { BindingJudging } from "../fields/binding-judgement";
import type { CompositionSetup } from "../fields/blocks-composition";
import { fenceStore } from "../host-rewrite/fence";
import type { RewriteInstall } from "../host-rewrite/service";
import type { OriginStore } from "../origin-store";
import { NO_HOLDS, type RemovalHoldStore } from "../removal-hold";
import type { RetiredCleanupService } from "../retired-cleanup";
import {
  retiredHistoryMemo,
  type RetiredHistoryMemo,
} from "../retired-history";
import type { RetiredPins } from "../retired-pins";
import { resolveFontOptions } from "../site-fonts/options";
import {
  siteHeaderFooterOption,
  type SiteHeaderFooter,
} from "../site-header-footer";
import { resolveSiteStyle, type SiteStyleData } from "../site-style";
import type { VariablesInUseCheck } from "../site-style-storage";
import { checkedTemplateAddresses } from "../templates/template-addresses";
import type { TemplateGuardSetup } from "../templates/template-guard";
import type { BackfillHost } from "../usage-backfill-wiring";

import type { InitContext } from "./install-context";
import { fontCatalogueParts, type PageBuilderOptions } from "./options";

/**
 * One start's work on the address store: the check the boot waits for, and
 * the passes it leaves running.
 */
export interface AddressStart {
  readonly check: () => Promise<void>;
  readonly passes: () => Promise<void>;
}

/**
 * The holders `init` fills: each is empty until `init` has run, and a
 * reload under HMR runs `init` again on the same definition.
 */
export interface DefinitionState {
  /**
   * The installed context, published by `init` for the backfill job to read.
   *
   * `contributes` is evaluated when the plugin is DEFINED and a job handler
   * runs long afterwards, so the two cannot share a value through an argument.
   * A holder is what bridges them, and it is safe in the one direction it is
   * used: nothing reads it until a handler runs, and a handler runs only after
   * the runner exists, which is after `init`.
   *
   * Deliberately not a captured Direct API. `requireNextly` refuses until
   * services are registered and boot migrations have settled, so resolving it
   * at definition time would throw during config; the holder stores the CONTEXT
   * and every pass resolves the API itself.
   */
  installed: BackfillHost | null;
  // This page builder's named queries: the site's own from the start, so a
  // route built before boot already knows them, and rebuilt with the ones
  // plugins declare on each boot. Its own, so two sites in one process never
  // resolve each other's.
  namedQueries: NamedQueryRegistry;
  /**
   * What the default-Layout repair needs from the installed plugin: the
   * RESOLVED slugs and the log. Published by `init` for the same reason
   * `installed` is — the repair job is contributed before `init` runs and
   * handled long after it.
   */
  defaultLayoutSetup: DefaultLayoutSetup | null;
  // Set once that pass has finished, after which a page save need not claim
  // the existing pages its list's later pages would fall on.
  pageClaimsBackfilled: boolean;
  // Which initialization the flag belongs to. A reload under HMR runs
  // `init` again on this same definition, so the flag is reset there, and a
  // pass started by an earlier initialization, still running, never sets it
  // for the new one (whose languages may differ).
  pageClaimsInit: number;
  // Which collections a write may concern at all, known from the site's
  // code (see `collection-reach`). Set by `init`, which a reload under HMR
  // runs again; until then every collection may concern it.
  writeReach: CollectionReach;
  // Who holds a path, for the site's content route, set by `init`.
  contentAddresses: ContentAddressService | null;
  // One start's work on the address store, set by `init`: the check that
  // refuses a collection given a template address that cannot have a
  // template (run once every plugin's collections are registered), and the
  // start-up passes, both over one read of the stored template addresses.
  beginAddressStart: (() => AddressStart) | null;
  // The start-up passes over the address store while they run: pages, the
  // sweep, then entries. The addresses listed for pre-rendering wait for it,
  // so a build never lists a store the passes are still filling or moving.
  addressStartup: Promise<void> | null;
  // How many of a collection's entries wait for an address, set by `init`.
  waitingEntriesOf: ((collection: string) => Promise<number>) | null;
  /**
   * The templates guard's lookups over the installed plugin: the RESOLVED
   * templates slug, the plugin's own collections, the registry and the
   * hook-free own read. Published by `init`, and read by the template route
   * and service per call, so a request reaching them before `init` refuses
   * rather than judging against slugs nothing resolved.
   */
  templateGuard: TemplateGuardSetup | null;
  /**
   * How the blocks field judges composition, once the plugin is installed.
   * Until then only a document's own rules run: nothing is installed to read
   * the library through.
   */
  composition: CompositionSetup | undefined;
  /**
   * What the component-delete rewrite needs from the installed plugin,
   * published by `init` for the reason `installed` is: the service is
   * contributed before `init` runs and called long after it.
   */
  rewriteInstall: RewriteInstall | null;
  /**
   * The installed plugin as the "Bindings to fix" report reads it, published
   * by `init`: its job and its route are contributed before `init` runs.
   */
  bindingReportCtx: InitContext | null;
  // When a write last started the report's sweep, which a write does at most
  // once a second.
  bindingsKickedAt: number;
  // When a read of the report last started its check, which a read does at
  // most once a minute.
  bindingsRefreshedAt: number;
  // The versions a lost removal is derived from, held until a repair records
  // it. Set by `init`, which holds the context pins are made through; read by
  // the facts route's repair, which releases them.
  heldRemovals: RetiredPins | undefined;
  // The holds a component's removal takes while it is published. Set by
  // `init`, which holds the bookkeeping table's slug; read by the hold route.
  removalHolds: RemovalHoldStore | null;
  // The count a removal makes before it judges an index that is not whole,
  // shared by every removal in this process so a second joins the first.
  usageCountNow: ((maxDurationMs: number) => Promise<void>) | null;
  // The in-use check a write of the site style that drops a variable is
  // judged by. Set by `init`, which holds the context the stored documents
  // are listed through; read by the Single's guard on such a write.
  variablesInUse: VariablesInUseCheck | undefined;
  // The cleanup of retired values still stored, published by `init` for the
  // reason `rewriteInstall` is: its service and sweep are contributed before
  // `init` runs and called long after it.
  retiredCleanup: RetiredCleanupService | null;
  /**
   * What removing breakpoints needs from the installed plugin, published by
   * `init` for the reason `rewriteInstall` is: the service, the Single's guard
   * and the routes are made before `init` runs and called long after it.
   */
  removalInstall: RemovalInstall | null;
  // Where a removal's save logs a walk that failed after its set was stored;
  // published by `init` beside the install.
  removalLogger: {
    error(message: string, meta?: Record<string, unknown>): void;
  } | null;
}

/**
 * What every part of the definition shares: the options, the holders, and
 * what was worked out from the options when the plugin was defined.
 */
export interface Definition {
  readonly opts: PageBuilderOptions;
  readonly state: DefinitionState;
  /**
   * This page builder's block registry: filled on each boot through the
   * registration service, and read by its validation, its routes and the
   * site's public routes. Its own, so two sites in one process never share
   * blocks.
   */
  readonly blocks: BlockRegistry;
  readonly namedQuerySource: NamedQuerySource;
  readonly namedQueryDeclarations: () => NamedQueryDeclaration[];
  readonly templateAddresses: ReadonlyMap<string, readonly string[]>;
  readonly declaredPaths: ReadonlyMap<string, string>;
  readonly requireContentAddresses: () => ContentAddressService;
  readonly templateActions: {
    guard: () => TemplateGuardSetup;
    waitingEntries: (collection: string) => Promise<number>;
  };
  readonly requireTemplateGuard: () => TemplateGuardSetup;
  readonly defaultLayoutDeps: () => Promise<EnsureDefaultDeps>;
  readonly pageActionBindings: () => BindingJudging | undefined;
  readonly requireRewriteInstall: () => RewriteInstall;
  readonly componentDeleteSweepDeps: () => ComponentDeleteSweepDeps;
  readonly requireInstalled: () => BackfillHost;
  readonly configStyle: SiteStyleData;
  readonly configClassIds: Set<string>;
  readonly fonts: ReturnType<typeof fontCatalogueParts>;
  readonly canvasPath: string | undefined;
  /** Who draws the site's header and footer, refused at boot when unknown. */
  readonly siteHeaderFooter: SiteHeaderFooter;
  readonly usage: {
    reconcile?: CommittedWriteReconciler;
    origins?: OriginStore;
  };
  readonly retiredHistory: RetiredHistoryMemo;
  readonly requireRemovalHolds: () => RemovalHoldStore;
  readonly bootedNextly: () => ReturnType<typeof getCachedNextly>;
  readonly requireRetiredCleanup: () => RetiredCleanupService;
}

/**
 * The definition's holders and shared values for `opts`. The options are
 * judged here, in this order: the named queries, the template addresses, the
 * site style, the font catalogue, the canvas path; so a bad one refuses while
 * the config is read.
 */
export function createDefinition(opts: PageBuilderOptions): Definition {
  const state: DefinitionState = {
    installed: null,
    namedQueries: createNamedQueryRegistry(),
    defaultLayoutSetup: null,
    pageClaimsBackfilled: false,
    pageClaimsInit: 0,
    writeReach: {
      mayServeEntries: () => true,
      mayHoldBlocks: () => true,
    },
    contentAddresses: null,
    beginAddressStart: null,
    addressStartup: null,
    waitingEntriesOf: null,
    templateGuard: null,
    composition: undefined,
    rewriteInstall: null,
    bindingReportCtx: null,
    bindingsKickedAt: 0,
    bindingsRefreshedAt: 0,
    heldRemovals: undefined,
    removalHolds: null,
    usageCountNow: null,
    variablesInUse: undefined,
    retiredCleanup: null,
    removalInstall: null,
    removalLogger: null,
  };
  state.namedQueries.register(opts.namedQueries ?? [], {
    source: "pageBuilder({ namedQueries })",
  });
  const namedQuerySource: NamedQuerySource = {
    declarationOf: name => state.namedQueries.declarationOf(name),
  };
  const namedQueryDeclarations = () =>
    state.namedQueries.all().map(namedQueryDeclaration);

  // Each collection's code-declared template address, checked when the
  // plugin is defined, so a malformed or shared one refuses to start.
  const templateAddresses = checkedTemplateAddresses(opts.templates);
  // The same addresses as written, each in its one spelling once checked:
  // what a stored address is compared with.
  const declaredPaths: ReadonlyMap<string, string> = new Map(
    Object.entries(opts.templates?.addresses ?? {}).filter(([collection]) =>
      templateAddresses.has(collection)
    )
  );
  const requireContentAddresses = (): ContentAddressService => {
    if (state.contentAddresses === null) {
      throw new Error(
        "[page-builder] the content route asked for an address before the plugin was installed"
      );
    }
    return state.contentAddresses;
  };
  // What the template actions run with, for the route and the service.
  const templateActions = {
    guard: (): TemplateGuardSetup => requireTemplateGuard(),
    waitingEntries: (collection: string): Promise<number> => {
      if (state.waitingEntriesOf === null) {
        throw new Error(
          "[page-builder] a template action ran before the plugin was installed"
        );
      }
      return state.waitingEntriesOf(collection);
    },
  };

  const requireTemplateGuard = (): TemplateGuardSetup => {
    if (state.templateGuard === null) {
      throw new Error(
        "[page-builder] a template action ran before the plugin was installed"
      );
    }
    return state.templateGuard;
  };

  /**
   * The repair's deps for one run, the Direct API resolved at call time. A run
   * before `init` refuses with a named reason and the sweep is re-queued,
   * rather than writing to slugs the plugin has not resolved.
   */
  const defaultLayoutDeps = async (): Promise<EnsureDefaultDeps> => {
    if (state.defaultLayoutSetup === null) {
      throw new Error(
        "[page-builder] the default Layout repair ran before the plugin was installed"
      );
    }
    // The booted instance through the SDK, imported at call time because
    // this entry reaches a browser bundle, and the Direct API graph has no
    // place there.
    const { getCachedNextly } = await import("@nextlyhq/plugin-sdk");
    return { ...state.defaultLayoutSetup, nextly: await getCachedNextly() };
  };

  /**
   * What a page action's bindings are judged with, as a save judges them;
   * nothing until the plugin is installed.
   */
  const pageActionBindings = (): BindingJudging | undefined => {
    if (state.composition?.bindingShapes === undefined) return undefined;
    const { bindingShapes, templates, namedQueries, limits } =
      state.composition;
    return {
      shapesOf: bindingShapes,
      maxNodes: limits.maxNodes,
      ...(templates === undefined ? {} : { templates }),
      ...(namedQueries === undefined ? {} : { namedQueries }),
    };
  };

  const requireRewriteInstall = (): RewriteInstall => {
    if (state.rewriteInstall === null) {
      throw new Error(
        "[page-builder] the component-delete rewrite ran before the plugin was installed"
      );
    }
    return state.rewriteInstall;
  };
  // What Delete component's sweep reads and moves, resolved per pass.
  const componentDeleteSweepDeps = () => {
    const installed = requireRewriteInstall();
    const runs = fenceStore(installed.db, installed.dialect);
    return {
      deleting: () => runs.runsAt("deleting"),
      store: () => runs,
      exists: async (componentId: string) => {
        const nextly = await installed.site.nextly();
        const found = await nextly.find({
          collection: installed.store.collection,
          where: { id: { equals: componentId } },
          status: "all",
          limit: 1,
          depth: 0,
          overrideAccess: true,
        });
        return found.items.length > 0;
      },
      now: () => new Date(),
    };
  };

  /**
   * The installed context, or a refusal naming why it is missing.
   *
   * Throwing beats defaulting here. Every plausible default is a claim about a
   * site this has not read — no collections, no locales, the declared slugs —
   * and each of those reports the backfill finished on a site it never looked
   * at. A refusal fails the pass, and the sweep is re-queued.
   */
  const requireInstalled = (): BackfillHost => {
    if (state.installed === null) {
      throw new Error(
        "[page-builder] the usage backfill ran before the plugin was installed, so it has no configuration to enumerate"
      );
    }
    return state.installed;
  };
  // Resolved once, with no stored tier: at config time there is no database to
  // read, so what the factory can wire into the validator and the canvas is
  // the defaults tier. The stored tier reaches the published route through
  // `loadSiteStyle`, which reads per request.
  // The core blocks' looks join the code tier, so the site receives them as
  // shared styles its code supplies.
  const configStyle = resolveSiteStyle(withCoreLooks(opts.siteStyle));
  // The code tier's class ids, for the routes that refuse to rename or remove
  // what code supplies. One set, refreshed in place with the code tier.
  const configClassIds = new Set(
    (configStyle.classes ?? []).map(entry => entry.id)
  );
  // The font catalogue's hosts and caps, refused at boot when unusable, and
  // what it adds to the plugin.
  const fonts = fontCatalogueParts(resolveFontOptions(opts.fonts));
  // The canvas route's path, refused at boot when it names another origin.
  const canvasPath = canvasPathOption(opts.canvasPath);
  // Who draws the site's header and footer, refused at boot when it is
  // neither value, so a typo never reads as the default.
  const siteHeaderFooter = siteHeaderFooterOption(opts.siteHeaderFooter);

  // The usage indexes' reconciler for a write made in a transaction the
  // caller owns, which their hooks skip. Set by `init`, read per request.
  const usage: {
    reconcile?: CommittedWriteReconciler;
    origins?: OriginStore;
  } = {};
  // What deriving retired ids from component history has read so far, shared
  // by the repair after a failed record and the editor's facts read.
  const retiredHistory = retiredHistoryMemo();
  const requireRemovalHolds = (): RemovalHoldStore => {
    // Nothing is retired without the readiness hooks, so a removal loses no
    // value and nothing need be held: a hold asked for holds nothing.
    if (opts.componentReadiness === false) return NO_HOLDS;
    if (state.removalHolds === null) {
      throw new Error(
        "[page-builder] a component removal was held before the plugin was installed"
      );
    }
    return state.removalHolds;
  };
  // The booted Direct API through the SDK, imported at call time for the
  // reason `defaultLayoutDeps` gives.
  const bootedNextly = async () =>
    (await import("@nextlyhq/plugin-sdk")).getCachedNextly();
  const requireRetiredCleanup = (): RetiredCleanupService => {
    if (state.retiredCleanup === null) {
      throw new Error(
        "[page-builder] the cleanup of removed component fields ran before the plugin was installed"
      );
    }
    return state.retiredCleanup;
  };
  return {
    opts,
    state,
    blocks: createBlockRegistry(),
    namedQuerySource,
    namedQueryDeclarations,
    templateAddresses,
    declaredPaths,
    requireContentAddresses,
    templateActions,
    requireTemplateGuard,
    defaultLayoutDeps,
    pageActionBindings,
    requireRewriteInstall,
    componentDeleteSweepDeps,
    requireInstalled,
    configStyle,
    configClassIds,
    fonts,
    canvasPath,
    siteHeaderFooter,
    usage,
    retiredHistory,
    requireRemovalHolds,
    bootedNextly,
    requireRetiredCleanup,
  };
}
