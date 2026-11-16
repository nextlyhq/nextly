/**
 * The component-delete rewrite as the plugin offers it: open a run (which
 * fences the component), rewrite its hosts as the person who started it, read
 * its progress, close it.
 *
 * A collection entry with a pending draft is rewritten through the plugin's
 * field rewrite, its live copy and its drafts together, so a published page
 * no longer keeps the component until its author publishes; where the person
 * may update it but not publish it, its draft alone is converted, as before.
 *
 * The job that deletes a used component drives this a tick at a time; the
 * route that starts it opens the run. Bound to the installed plugin through a
 * holder, for the reason the usage health service is: the service is
 * contributed before `init` runs and called long after it.
 *
 * @module host-rewrite/service
 * @experimental
 */
import {
  registryBlockSource,
  registryNestingSource,
  type BlockDocument,
  type DefinitionsById,
  type DocumentLimits,
} from "@nextlyhq/blocks-engine";
import {
  NextlyError,
  type PluginRouteContext,
  type PluginRouteIdentity,
  type ServiceOpts,
} from "@nextlyhq/plugin-sdk";
import type { PluginDatabase } from "@nextlyhq/plugin-sdk/schema";

import {
  asDocument,
  AS_THE_SYSTEM,
  publishedStoreSource,
} from "../component-store-source";
import { asServiceCaller } from "../library-route";

import {
  componentDeleteStep,
  definitionsAlikeInEveryLanguage,
  type DefinitionsAnswer,
} from "./component-delete-step";
import type { RewriteReport, StoredForm } from "./contract";
import {
  fenceStore,
  walkedRuns,
  type DeletionRun,
  type RunPurpose,
} from "./fence";
import {
  progressStore,
  type HostProgress,
  type ProgressCounts,
} from "./progress";
import { rewriteHosts, type HostSource, type RunStore } from "./rewrite";
import {
  siteCopiesWriter,
  type RewriteScopeRunner,
  siteHostReader,
  siteHostSource,
  siteHostWriter,
  type RewriteSite,
  type SiteFieldRewrite,
} from "./site";

/** The name the service is contributed under. */
export const COMPONENT_DELETE_REWRITE_SERVICE = "componentDeleteRewrite";

/** The person a rewrite runs as: the caller of the route that started it. */
export type RewriteCaller = Pick<PluginRouteContext, "caller" | "user"> &
  Partial<Pick<PluginRouteContext, "authenticatedScope">>;

/** Why a document's copies changed, as its history keeps it. */
export const COMPONENT_DELETED_REASON =
  "A component it used was deleted, so each copy of it became plain blocks.";

/** One call of the rewrite. */
export interface ComponentDeleteRewriteArgs {
  readonly componentId: string;
  /** The caller of this request; it must be the person who opened the run. */
  readonly caller: RewriteCaller;
  /** How many documents this call may visit before it stops to resume later. */
  readonly maxDocuments?: number;
  /** When this call stops to resume later. */
  readonly deadline?: Date;
  /** Judge every host and write nothing. */
  readonly dryRun?: boolean;
  /**
   * In a dry run, report each write with the body it sends
   * (`RewriteReport.writes`). Asked only by a caller whose slices are small,
   * since every body is held until the call ends.
   */
  readonly plannedWrites?: boolean;
}

/**
 * The service.
 *
 * Every write of a run is made as the person who opened it. The run records
 * who that is, and a call from anybody else is refused, so a second person
 * reaching the same open run can neither borrow the first one's access nor
 * lend theirs.
 *
 * @experimental
 */
export interface ComponentDeleteRewriteService {
  /**
   * Open the run for a component and purpose as this caller; a `delete` run
   * fences the component. See `FenceStore.open`.
   */
  open(
    componentId: string,
    caller: RewriteCaller,
    purpose?: RunPurpose,
    /** Where a new run starts: the component delete opens at `preflight`. */
    startAt?: "converting" | "preflight"
  ): Promise<{ readonly opened: boolean; readonly run: DeletionRun }>;
  /** Rewrite the component's hosts for its `delete` run, resuming where it stopped. */
  rewrite(args: ComponentDeleteRewriteArgs): Promise<RewriteReport>;
  /**
   * Judge every host as a delete would, writing nothing and opening no run,
   * so nothing is fenced: what the delete dialog shows before anyone
   * confirms, and the check a delete makes before converting anything.
   */
  plan(args: PlanArgs): Promise<PlanSlice>;
  /** What a run recorded about each document, or nothing when none is open. */
  progress(
    componentId: string,
    purpose?: RunPurpose
  ): Promise<readonly HostProgress[]>;
  /**
   * How many documents of each state the component's `delete` run recorded,
   * counted in the database; all zero when none is open.
   */
  counts(componentId: string): Promise<ProgressCounts>;
  /** The first `limit` documents its `delete` run left; none when none is open. */
  leftPage(
    componentId: string,
    limit: number
  ): Promise<readonly HostProgress[]>;
  /** Close a run, which lifts a `delete` run's fence. */
  close(componentId: string, purpose?: RunPurpose): Promise<void>;
}

/**
 * One slice of a plan: the hosts after `after`, until the budget is spent.
 * A plan of a whole site may take several, each resuming where the last
 * stopped, so no one request walks a large site.
 */
export interface PlanArgs
  extends Pick<ComponentDeleteRewriteArgs, "componentId" | "caller"> {
  /** Where the slice starts: the `next` of the one before, or `null`. */
  readonly after: string | null;
  /** How many documents the slice judges at most (at least one). */
  readonly maxDocuments: number;
  /** When the slice stops, after the document in hand. */
  readonly deadline: Date;
  /** Report each write with its body; see {@link ComponentDeleteRewriteArgs}. */
  readonly plannedWrites?: boolean;
}

/** What one slice of a plan found. */
export interface PlanSlice {
  /** The slice's own findings: its hosts, and Layouts on its last slice. */
  readonly report: RewriteReport;
  /** Whether the slice reached the last document, so the plan is whole. */
  readonly complete: boolean;
  /** Where the next slice starts; `null` once complete. */
  readonly next: string | null;
}

/** What the installed plugin hands the service. */
export interface RewriteInstall {
  readonly db: PluginDatabase;
  readonly dialect: Parameters<typeof fenceStore>[1];
  /** The site, without the parts that belong to one run. */
  readonly site: Omit<RewriteSite, "componentId" | "identity" | "hints">;
  /** The documents the usage index says place a component. */
  readonly hints: (
    componentId: string
  ) => Promise<readonly { readonly slug: string; readonly id: string }[]>;
  /** Where component definitions are stored. */
  readonly store: { readonly collection: string; readonly field: string };
  readonly limits: () => DocumentLimits;
  /**
   * The plugin's own field rewrite, which names the Page Builder in each
   * document's history. Absent, a document with a pending draft has its
   * draft converted alone.
   */
  readonly rewriteField?: SiteFieldRewrite<ServiceOpts>;
  /** The scope a rewrite runs in, for the validation core runs inside it. */
  readonly rewriteScope?: RewriteScopeRunner;
  /**
   * What follows a committed field rewrite of a document: the work its save
   * hooks would have done, which a rewrite runs none of (the usage indexes).
   */
  readonly afterRewrite?: (document: {
    readonly slug: string;
    readonly id: string;
  }) => Promise<void>;
}

/**
 * Who a caller is, as a run records it: `user:<id>` for a signed-in person,
 * `api-key:<id>` for a key, which is judged on its own scope rather than its
 * owner's and so is a different person to a run. Refused for a request with
 * no caller.
 */
export function runStarterOf(
  caller: Pick<RewriteCaller, "caller"> & {
    readonly user: { readonly id: string } | null;
  }
): string {
  const who = caller.caller;
  if (who === null) {
    throw NextlyError.forbidden({
      logContext: { reason: "host-rewrite-no-caller" },
    });
  }
  return who.authMethod === "api-key" && who.apiKeyId !== undefined
    ? `api-key:${who.apiKeyId}`
    : `user:${userIdOf(caller)}`;
}

/** The caller's identity as the stored read and the conditional write take it. */
function identityOf(caller: RewriteCaller): Promise<PluginRouteIdentity> {
  if (caller.caller === null) {
    throw NextlyError.forbidden({
      logContext: { reason: "host-rewrite-no-caller" },
    });
  }
  return caller.caller.identity();
}

/**
 * The caller as the plugin's collection service takes them, for the field
 * rewrite (`asServiceCaller`). Refused for a request with no person, as a
 * run's every other write is.
 */
function serviceCallerOf(caller: RewriteCaller): ServiceOpts {
  if (caller.caller === null || caller.user === null) {
    throw NextlyError.forbidden({
      logContext: { reason: "host-rewrite-no-caller" },
    });
  }
  return asServiceCaller(caller);
}

/** The signed-in user's id, which a route's caller always carries. */
function userIdOf(caller: {
  readonly user: { readonly id: string } | null;
}): string {
  const id = caller.user?.id;
  if (id !== undefined && id !== "") return id;
  throw NextlyError.forbidden({
    logContext: { reason: "host-rewrite-no-user" },
  });
}

/** The service over the installed plugin, resolved per call. */
export function componentDeleteRewriteService(
  install: () => RewriteInstall
): ComponentDeleteRewriteService {
  const fence = () => fenceStore(install().db, install().dialect);
  const progress = () => progressStore(install().db, install().dialect);
  return {
    open: (componentId, caller, purpose = "delete", startAt) =>
      fence().open(componentId, purpose, runStarterOf(caller), startAt),
    close: (componentId, purpose = "delete") =>
      fence().close(componentId, purpose),
    progress: async (componentId, purpose = "delete") => {
      const run = await fence().runFor(componentId, purpose);
      return run === null ? [] : progress().all(run.id);
    },
    counts: async componentId => {
      const run = await fence().runFor(componentId, "delete");
      return run === null ? NO_PROGRESS : progress().counts(run.id);
    },
    leftPage: async (componentId, limit) => {
      const run = await fence().runFor(componentId, "delete");
      return run === null ? [] : progress().leftPage(run.id, limit);
    },
    rewrite: async args => {
      const run = await fence().runFor(args.componentId, "delete");
      if (run === null) {
        throw NextlyError.notFound({
          logContext: {
            reason: "host-rewrite-no-run",
            componentId: args.componentId,
          },
        });
      }
      // A precondition, so before any host is read: the run's writes are its
      // starter's, and nobody else's request may make them. The run checked
      // here is the one walked: its id is handed on, and nothing looks the
      // component's run up again.
      if (run.startedBy !== runStarterOf(args.caller)) {
        throw NextlyError.forbidden({
          logContext: {
            reason: "host-rewrite-not-the-starter",
            componentId: args.componentId,
          },
        });
      }
      return rewriteAsCaller(
        install(),
        walkedRuns(fence(), args.dryRun === true),
        progress(),
        args,
        run.id
      );
    },
    // A dry walk reads the run once, for its phase, and moves nothing: the
    // stand-in answers that one read and refuses any move.
    plan: async args => {
      const slice: SliceState = { next: args.after, ended: false };
      const report = await rewriteAsCaller(
        install(),
        {
          runById: runId =>
            Promise.resolve({ id: runId, phase: "converting", cursor: null }),
          advance: () => Promise.resolve(false),
        },
        progress(),
        {
          componentId: args.componentId,
          caller: args.caller,
          dryRun: true,
          ...(args.plannedWrites === true ? { plannedWrites: true } : {}),
        },
        PLAN_RUN_ID,
        source => slicedSource(source, args, slice)
      );
      return {
        report,
        complete: slice.ended,
        next: slice.ended ? null : slice.next,
      };
    },
  };
}

/** Where a slice of a plan got to. */
interface SliceState {
  /** The cursor after the last document it judged. */
  next: string | null;
  /** Whether it judged the last document there is. */
  ended: boolean;
}

/**
 * A source answering one slice: the documents after `after`, stopping once the
 * budget is spent, always after at least one so every slice moves on. The
 * hosts outside every walk (Layouts) are judged on the slice that ends, once.
 */
function slicedSource(
  source: HostSource,
  budget: Pick<PlanArgs, "after" | "maxDocuments" | "deadline">,
  slice: SliceState
): HostSource {
  return {
    ...source,
    documents: async function* () {
      let judged = 0;
      for await (const document of source.documents(budget.after)) {
        const spent =
          judged >= budget.maxDocuments ||
          Date.now() >= budget.deadline.getTime();
        if (judged > 0 && spent) return;
        judged += 1;
        slice.next = source.cursorOf(document);
        yield document;
      }
      slice.ended = true;
    },
    outside: () => (slice.ended ? source.outside() : Promise.resolve([])),
  };
}

/** The counts of a component with no run open. */
const NO_PROGRESS: ProgressCounts = {
  rewritten: 0,
  unchanged: 0,
  left: 0,
  pending: 0,
};

/** The id a plan's stand-in run answers to; no stored run has it. */
const PLAN_RUN_ID = "plan";

/** One call of the rewrite, as the caller, with the component-delete step. */
function rewriteAsCaller(
  installed: RewriteInstall,
  runs: RunStore,
  progress: ReturnType<typeof progressStore>,
  args: ComponentDeleteRewriteArgs,
  /** The run whose starter was just checked against the caller. */
  runId: string,
  /** How the site's source is narrowed, for a slice of a plan. */
  narrow: (source: HostSource) => HostSource = source => source
): Promise<RewriteReport> {
  const site: RewriteSite = {
    ...installed.site,
    componentId: args.componentId,
    hints: () => installed.hints(args.componentId),
    identity: () => identityOf(args.caller),
  };
  const limits = installed.limits();
  const { rewriteField } = installed;
  return rewriteHosts(
    {
      fence: runs,
      progress,
      source: narrow(siteHostSource(site)),
      read: siteHostReader(site),
      write: siteHostWriter(site),
      ...(rewriteField === undefined
        ? {}
        : {
            writeCopies: siteCopiesWriter({
              rewriteField,
              as: () =>
                Promise.resolve().then(() => serviceCallerOf(args.caller)),
              reason: COMPONENT_DELETED_REASON,
              ...(installed.afterRewrite === undefined
                ? {}
                : { afterRewrite: installed.afterRewrite }),
              ...(installed.rewriteScope === undefined
                ? {}
                : { scope: installed.rewriteScope }),
            }),
          }),
    },
    {
      runId,
      step: componentDeleteStep({
        componentId: args.componentId,
        definitions: (ids, form) =>
          definitionsFor(installed, args.componentId, ids, form),
        nesting: registryNestingSource(),
        blocks: registryBlockSource(),
        limits,
      }),
      ...(args.maxDocuments === undefined
        ? {}
        : { maxDocuments: args.maxDocuments }),
      ...(args.deadline === undefined ? {} : { deadline: args.deadline }),
      ...(args.dryRun === undefined ? {} : { dryRun: args.dryRun }),
      ...(args.plannedWrites === true ? { plannedWrites: true } : {}),
    }
  );
}

/**
 * The definitions a host's copies are converted from: each placed component's
 * PUBLISHED definition, which is what visitors are drawn, in the host's
 * language.
 *
 * A host shared by every language is drawn, in each language, from that
 * language's definition. So on a site with languages, its definitions are
 * read in every one of them, and the host is converted only when they agree;
 * otherwise it is refused and left. That needs no knowledge of whether the
 * component store is translated: an untranslated store reads alike in every
 * language.
 */
async function definitionsFor(
  installed: RewriteInstall,
  componentId: string,
  ids: readonly string[],
  form: StoredForm
): Promise<DefinitionsAnswer> {
  const locales = installed.site.locales();
  const read = (locale: string | undefined) =>
    form.form === "draft"
      ? draftDefinitionsIn(installed, componentId, ids, locale)
      : definitionsIn(installed, componentId, ids, locale);
  if (form.host.locale !== undefined || locales.length === 0) {
    return { kind: "definitions", byId: await read(form.host.locale) };
  }
  const byLanguage: DefinitionsById[] = [];
  for (const locale of locales) byLanguage.push(await read(locale));
  return definitionsAlikeInEveryLanguage(byLanguage, ids);
}

/**
 * The definitions a working draft is converted from, in one language: each
 * placed component as the editor resolves it, its own working draft overlaid
 * on its published definition. A draft host shows those, so its copies are
 * turned into the blocks its author sees; a live host is converted from the
 * published definitions alone, which is what visitors see.
 */
async function draftDefinitionsIn(
  installed: RewriteInstall,
  componentId: string,
  ids: readonly string[],
  locale: string | undefined
): Promise<DefinitionsById> {
  const published = await definitionsIn(installed, componentId, ids, locale);
  const overlaid = new Map(published);
  for (const id of ids) {
    const draft = await draftDefinition(installed, id, locale);
    if (draft !== null) overlaid.set(id, draft);
  }
  return overlaid;
}

/**
 * The published definitions in one language. The component being deleted
 * falls back to its working draft when it was never published, so its copies
 * are converted from what an editor sees rather than refused.
 */
async function definitionsIn(
  installed: RewriteInstall,
  componentId: string,
  ids: readonly string[],
  locale: string | undefined
): Promise<DefinitionsById> {
  const nextly = await installed.site.nextly();
  const published = await publishedStoreSource(nextly, {
    collection: installed.store.collection,
    field: installed.store.field,
    locale,
    reading: AS_THE_SYSTEM,
  })(ids);
  if (published.has(componentId) || !ids.includes(componentId)) {
    return published;
  }
  const draft = await draftDefinition(installed, componentId, locale);
  return draft === null
    ? published
    : new Map([...published, [componentId, draft]]);
}

/**
 * A component's definition as an editor's preview reads it (its pending
 * working draft, else its stored row), or `null` when there is no such
 * component.
 */
async function draftDefinition(
  installed: RewriteInstall,
  componentId: string,
  locale: string | undefined
): Promise<BlockDocument | null> {
  const nextly = await installed.site.nextly();
  let row: unknown;
  try {
    row = await nextly.findByID({
      collection: installed.store.collection,
      id: componentId,
      draft: true,
      status: "all",
      depth: 0,
      overrideAccess: true,
      ...(locale === undefined ? {} : { locale }),
    });
  } catch (error) {
    // A component that is gone has no draft to convert from either; the step
    // then refuses its copies rather than inventing their blocks.
    if (NextlyError.isNotFound(error)) return null;
    throw error;
  }
  return asDocument(
    (row as Record<string, unknown> | null)?.[installed.store.field]
  );
}
