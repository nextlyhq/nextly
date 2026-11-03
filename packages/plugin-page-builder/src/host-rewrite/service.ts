/**
 * The component-delete rewrite as the plugin offers it: open a run (which
 * fences the component), rewrite its hosts as the person who started it, read
 * its progress, close it.
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
  type DefinitionsById,
  type DocumentLimits,
} from "@nextlyhq/blocks-engine";
import { NextlyError, type PluginRouteContext } from "@nextlyhq/plugin-sdk";
import type { PluginDatabase } from "@nextlyhq/plugin-sdk/schema";

import {
  asDocument,
  AS_THE_SYSTEM,
  publishedStoreSource,
} from "../component-store-source";
import { readingAsUser } from "../library-route";

import { componentDeleteStep } from "./component-delete-step";
import type { RewriteReport, StoredForm } from "./contract";
import { fenceStore, type DeletionRun } from "./fence";
import { progressStore, type HostProgress } from "./progress";
import { rewriteHosts } from "./rewrite";
import {
  siteHostPermission,
  siteHostReader,
  siteHostSource,
  siteHostWriter,
  type RewriteSite,
} from "./site";

/** The name the service is contributed under. */
export const COMPONENT_DELETE_REWRITE_SERVICE = "componentDeleteRewrite";

/** The person a rewrite runs as: the caller of the route that started it. */
export type RewriteCaller = Pick<PluginRouteContext, "caller">;

/** One call of the rewrite. */
export interface ComponentDeleteRewriteArgs {
  readonly componentId: string;
  readonly caller: RewriteCaller;
  /** How many documents this call may visit before it stops to resume later. */
  readonly maxDocuments?: number;
  /** When this call stops to resume later. */
  readonly deadline?: Date;
  /** Judge every host and write nothing. */
  readonly dryRun?: boolean;
}

/**
 * The service.
 *
 * @experimental
 */
export interface ComponentDeleteRewriteService {
  /** Open the run for a component, which fences it; see `FenceStore.open`. */
  open(
    componentId: string,
    startedBy: string
  ): Promise<{ readonly opened: boolean; readonly run: DeletionRun }>;
  /** Rewrite the component's hosts, resuming where the run stopped. */
  rewrite(args: ComponentDeleteRewriteArgs): Promise<RewriteReport>;
  /** What the run recorded about each document, or nothing when none is open. */
  progress(componentId: string): Promise<readonly HostProgress[]>;
  /** Close the run, which lifts the fence. */
  close(componentId: string): Promise<void>;
}

/** What the installed plugin hands the service. */
export interface RewriteInstall {
  readonly db: PluginDatabase;
  readonly dialect: Parameters<typeof fenceStore>[1];
  /** The site, without the parts that belong to one run. */
  readonly site: Omit<
    RewriteSite,
    "componentId" | "identity" | "can" | "hints"
  >;
  /** The documents the usage index says place a component. */
  readonly hints: (
    componentId: string
  ) => Promise<readonly { readonly slug: string; readonly id: string }[]>;
  /** Where component definitions are stored. */
  readonly store: { readonly collection: string; readonly field: string };
  readonly limits: () => DocumentLimits;
}

/** The service over the installed plugin, resolved per call. */
export function componentDeleteRewriteService(
  install: () => RewriteInstall
): ComponentDeleteRewriteService {
  const fence = () => fenceStore(install().db, install().dialect);
  const progress = () => progressStore(install().db, install().dialect);
  return {
    open: (componentId, startedBy) => fence().open(componentId, startedBy),
    close: componentId => fence().close(componentId),
    progress: async componentId => {
      const run = await fence().runFor(componentId);
      return run === null ? [] : progress().all(run.id);
    },
    rewrite: args => rewriteAsCaller(install(), fence(), progress(), args),
  };
}

/** One call of the rewrite, as the caller, with the component-delete step. */
function rewriteAsCaller(
  installed: RewriteInstall,
  fence: ReturnType<typeof fenceStore>,
  progress: ReturnType<typeof progressStore>,
  args: ComponentDeleteRewriteArgs
): Promise<RewriteReport> {
  const caller = args.caller.caller;
  if (caller === null) {
    throw NextlyError.forbidden({
      logContext: { reason: "host-rewrite-no-caller" },
    });
  }
  const site: RewriteSite = {
    ...installed.site,
    componentId: args.componentId,
    hints: () => installed.hints(args.componentId),
    identity: () => readingAsUser(args.caller),
    can: (action, resource) => caller.can(action, resource),
  };
  const limits = installed.limits();
  return rewriteHosts(
    {
      fence,
      progress,
      source: siteHostSource(site),
      read: siteHostReader(site),
      write: siteHostWriter(site),
      may: siteHostPermission(site),
    },
    {
      componentId: args.componentId,
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
    }
  );
}

/**
 * The definitions a host's copies are converted from: each placed component's
 * PUBLISHED definition, which is what visitors are drawn, in the host's
 * language. The component being deleted falls back to its working draft when
 * it was never published, so its copies are converted from what an editor
 * sees rather than refused.
 */
async function definitionsFor(
  installed: RewriteInstall,
  componentId: string,
  ids: readonly string[],
  form: StoredForm
): Promise<DefinitionsById> {
  const nextly = await installed.site.nextly();
  const published = await publishedStoreSource(nextly, {
    collection: installed.store.collection,
    field: installed.store.field,
    locale: form.host.locale,
    reading: AS_THE_SYSTEM,
  })(ids);
  if (published.has(componentId) || !ids.includes(componentId))
    return published;
  let draft: unknown;
  try {
    draft = await nextly.findByID({
      collection: installed.store.collection,
      id: componentId,
      draft: true,
      status: "all",
      depth: 0,
      overrideAccess: true,
      ...(form.host.locale === undefined ? {} : { locale: form.host.locale }),
    });
  } catch (error) {
    // A component that is gone has no draft to convert from either; the step
    // then refuses its copies rather than inventing their blocks.
    if (NextlyError.isNotFound(error)) return published;
    throw error;
  }
  const document = asDocument(
    (draft as Record<string, unknown> | null)?.[installed.store.field]
  );
  if (document === null) return published;
  return new Map([...published, [componentId, document]]);
}
