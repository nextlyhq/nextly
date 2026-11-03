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
import { fenceStore, type DeletionRun, type RunPurpose } from "./fence";
import { progressStore, type HostProgress } from "./progress";
import { rewriteHosts } from "./rewrite";
import {
  siteHostReader,
  siteHostSource,
  siteHostWriter,
  type RewriteSite,
} from "./site";

/** The name the service is contributed under. */
export const COMPONENT_DELETE_REWRITE_SERVICE = "componentDeleteRewrite";

/** The person a rewrite runs as: the caller of the route that started it. */
export type RewriteCaller = Pick<PluginRouteContext, "caller" | "user">;

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
    purpose?: RunPurpose
  ): Promise<{ readonly opened: boolean; readonly run: DeletionRun }>;
  /** Rewrite the component's hosts for its `delete` run, resuming where it stopped. */
  rewrite(args: ComponentDeleteRewriteArgs): Promise<RewriteReport>;
  /** What a run recorded about each document, or nothing when none is open. */
  progress(
    componentId: string,
    purpose?: RunPurpose
  ): Promise<readonly HostProgress[]>;
  /** Close a run, which lifts a `delete` run's fence. */
  close(componentId: string, purpose?: RunPurpose): Promise<void>;
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
}

/**
 * Who a caller is, as a run records it: `user:<id>` for a signed-in person,
 * `api-key:<id>` for a key, which is judged on its own scope rather than its
 * owner's and so is a different person to a run. Refused for a request with
 * no caller.
 */
function runStarterOf(caller: RewriteCaller): string {
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

/** The signed-in user's id, which a route's caller always carries. */
function userIdOf(caller: RewriteCaller): string {
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
    open: (componentId, caller, purpose = "delete") =>
      fence().open(componentId, purpose, runStarterOf(caller)),
    close: (componentId, purpose = "delete") =>
      fence().close(componentId, purpose),
    progress: async (componentId, purpose = "delete") => {
      const run = await fence().runFor(componentId, purpose);
      return run === null ? [] : progress().all(run.id);
    },
    rewrite: async args => {
      const run = await fence().runFor(args.componentId, "delete");
      // A precondition, so before any host is read: the run's writes are its
      // starter's, and nobody else's request may make them.
      if (run !== null && run.startedBy !== runStarterOf(args.caller)) {
        throw NextlyError.forbidden({
          logContext: {
            reason: "host-rewrite-not-the-starter",
            componentId: args.componentId,
          },
        });
      }
      return rewriteAsCaller(install(), fence(), progress(), args);
    },
  };
}

/** One call of the rewrite, as the caller, with the component-delete step. */
function rewriteAsCaller(
  installed: RewriteInstall,
  fence: ReturnType<typeof fenceStore>,
  progress: ReturnType<typeof progressStore>,
  args: ComponentDeleteRewriteArgs
): Promise<RewriteReport> {
  const site: RewriteSite = {
    ...installed.site,
    componentId: args.componentId,
    hints: () => installed.hints(args.componentId),
    identity: () => readingAsUser(args.caller),
  };
  const limits = installed.limits();
  return rewriteHosts(
    {
      fence,
      progress,
      source: siteHostSource(site),
      read: siteHostReader(site),
      write: siteHostWriter(site),
    },
    {
      componentId: args.componentId,
      purpose: "delete",
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
