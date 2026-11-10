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
  type BlockDocument,
  type DefinitionsById,
  type DocumentLimits,
} from "@nextlyhq/blocks-engine";
import {
  NextlyError,
  type PluginRouteContext,
  type PluginRouteIdentity,
} from "@nextlyhq/plugin-sdk";
import type { PluginDatabase } from "@nextlyhq/plugin-sdk/schema";

import {
  asDocument,
  AS_THE_SYSTEM,
  publishedStoreSource,
} from "../component-store-source";

import {
  componentDeleteStep,
  definitionsAlikeInEveryLanguage,
  type DefinitionsAnswer,
} from "./component-delete-step";
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
      return rewriteAsCaller(install(), fence(), progress(), args, run.id);
    },
  };
}

/** One call of the rewrite, as the caller, with the component-delete step. */
function rewriteAsCaller(
  installed: RewriteInstall,
  fence: ReturnType<typeof fenceStore>,
  progress: ReturnType<typeof progressStore>,
  args: ComponentDeleteRewriteArgs,
  /** The run whose starter was just checked against the caller. */
  runId: string
): Promise<RewriteReport> {
  const site: RewriteSite = {
    ...installed.site,
    componentId: args.componentId,
    hints: () => installed.hints(args.componentId),
    identity: () => identityOf(args.caller),
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
