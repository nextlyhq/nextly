/**
 * The composition API as a service: the manifest, the page and definition
 * actions and the collection template actions, for code that serves a request of its own, such as another
 * plugin's route or the MCP endpoint, and should not call this plugin's
 * routes over HTTP to reach them.
 *
 * Reached as `nextly.plugins["@nextlyhq/plugin-page-builder"].composition`,
 * or `ctx.services.plugins[...]` from another plugin. Each call runs the same
 * function the route runs, so it makes the same checks, the same dry run and
 * the same write, and answers the same `{ message, item }`.
 *
 * ## Who a call runs as
 *
 * The caller is the route context of the request being served: its `user`,
 * its `caller` and, for an API key, its `authenticatedScope`. Every read and
 * write is made as that caller, and every right the route asks, including the
 * permission the definition route declares, is asked of it here before
 * anything is read. A call with no signed-in caller is refused. The plugin's
 * own context supplies the rest (its collections as this site named them, its
 * database), so a caller from another plugin is read against this plugin's
 * names rather than its own.
 *
 * In-process code is trusted the way the Direct API is: a caller is what the
 * calling code says it is. Hand it the context core built for the request,
 * never one assembled by hand.
 *
 * @experimental Settles when the composition API ships.
 * @module composition-service
 */
import type { DocumentLimits, RetiredExposures } from "@nextlyhq/blocks-engine";
import {
  NextlyError,
  type PluginContext,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";

import type {
  DefinitionActionRequest,
  DefinitionActionResult,
  PageActionRequest,
  PageActionResult,
} from "./composition-actions-contract";
import {
  manifestRequestFrom,
  readCompositionManifest,
  type CompositionManifest,
  type ManifestRequest,
} from "./composition-manifest";
import type { ActionAnswer } from "./composition-route-kit";
import { runDefinitionAction } from "./definition-actions-route";
import type { ComponentStore } from "./library-route";
import { pageActionRequestOf, runPageAction } from "./page-actions-route";
import type {
  TemplateActionRequest,
  TemplateActionResult,
} from "./templates/template-actions-contract";
import {
  runTemplateAction,
  templateActionRequestOf,
  type TemplateActionsSetup,
} from "./templates/template-actions-route";

/** The name the service is contributed under. */
export const COMPOSITION_SERVICE = "composition";

/**
 * Who a call runs as: the route context of the request being served, or the
 * parts of it that say who is asking.
 *
 * @experimental Settles when the composition API ships.
 */
export type CompositionCaller = Pick<
  PluginRouteContext,
  "user" | "caller" | "authenticatedScope"
>;

/**
 * The service.
 *
 * Each request is read as outside input, as the route reads its body, so a
 * request built from an agent's arguments is refused for what the route
 * would refuse, with the path of each problem.
 *
 * @experimental Settles when the composition API ships.
 */
export interface CompositionService {
  /** The manifest, as the caller may read it. See `GET /manifest`. */
  manifest(
    caller: CompositionCaller,
    request?: ManifestRequest
  ): Promise<CompositionManifest>;
  /** One action on a stored page. See `POST /pages/actions`. */
  pageAction(
    caller: CompositionCaller,
    request: PageActionRequest
  ): Promise<ActionAnswer<PageActionResult>>;
  /** One edit to a component's definition. See `POST /components/:id/definition`. */
  definitionAction(
    caller: CompositionCaller,
    componentId: string,
    request: DefinitionActionRequest
  ): Promise<ActionAnswer<DefinitionActionResult>>;
  /** One action on a collection's template. See `POST /templates/actions`. */
  templateAction(
    caller: CompositionCaller,
    request: TemplateActionRequest
  ): Promise<ActionAnswer<TemplateActionResult>>;
}

/** What the plugin builds the service with: the store and bounds its routes use. */
export interface CompositionServiceSetup {
  readonly store?: ComponentStore;
  readonly limits?: () => DocumentLimits;
  readonly readRetired?: (
    ctx: PluginRouteContext
  ) => (componentId: string) => Promise<RetiredExposures | null>;
  readonly templates: TemplateActionsSetup;
}

/**
 * The service over this plugin's own context.
 *
 * The route context a call runs with is built per call: the plugin's context
 * as core hands its routes, with the caller's identity in place of the
 * request's. Built per call rather than once, since the context's own reads
 * (its dialect among them) are answered when they are asked.
 */
export function compositionService(
  plugin: PluginContext,
  setup: CompositionServiceSetup
): CompositionService {
  // Signed in first, before a request is read or anything is asked of the
  // site, as a route's authentication comes before its handler: a call made
  // for nobody (from a public route, say) learns nothing about the request
  // or the collections it names.
  const asRoute = (caller: CompositionCaller): PluginRouteContext => ({
    ...plugin,
    ...signedIn(caller),
    ...(caller.authenticatedScope === undefined
      ? {}
      : { authenticatedScope: caller.authenticatedScope }),
    principal: null,
    params: {},
  });
  return {
    manifest: (caller, request = {}) =>
      readCompositionManifest(
        asRoute(caller),
        setup,
        manifestRequestFrom(request)
      ),
    pageAction: (caller, request) =>
      runPageAction(asRoute(caller), pageActionRequestOf(request), setup),
    definitionAction: (caller, componentId, request) =>
      runDefinitionAction(
        asRoute(caller),
        componentId,
        request,
        setup,
        "ask-update"
      ),
    templateAction: (caller, request) =>
      runTemplateAction(
        asRoute(caller),
        templateActionRequestOf(request),
        setup.templates
      ),
  };
}

/** The caller's identity, or the refusal for a call with no signed-in caller. */
function signedIn(
  caller: CompositionCaller
): Pick<PluginRouteContext, "user" | "caller"> {
  if (caller.user === null || caller.caller === null) {
    throw NextlyError.forbidden({
      logContext: { reason: "composition-service-no-caller" },
    });
  }
  return { user: caller.user, caller: caller.caller };
}
