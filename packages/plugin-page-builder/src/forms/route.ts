/**
 * The public route every form on the site posts to, and the send limit it
 * counts under. What the route checks, and in which order, is the
 * receiver's (`receiver.ts`); this module only hands it the site's own
 * parts: the published reads, the providers, the limiter and the delivery.
 *
 * Public, because a visitor posting a form is signed in to nothing. That
 * waives the route's authentication only: every document is read as the
 * live page reads it, with the public's access where the page has it.
 *
 * @module forms/route
 */
import { COMPONENT_DOCUMENT_FIELD } from "@nextlyhq/blocks-react";
import type {
  LimitRule,
  PluginRoute,
  PluginRouteContext,
} from "@nextlyhq/plugin-sdk";

import { COMPONENTS_SLUG } from "../collections/components";
import { LAYOUTS_SLUG } from "../collections/layouts";
import { PAGES_SLUG } from "../collections/pages";
import { TEMPLATES_SLUG } from "../collections/templates";
import type { ComponentStore } from "../library-route";

import {
  publishedNode,
  type DefiningStores,
  type PublishedReadApi,
} from "./defining-document";
import { deliverAnswers } from "./deliver";
import type { FormProviders } from "./providers";
import {
  FORM_SEND_RULE,
  FORM_SENDS_PER_MINUTE,
  receiveFormPost,
} from "./receiver";

/** Where forms post, within the plugin's routes. */
export const FORM_RECEIVER_PATH = "/forms/send";

/**
 * The send limit, declared in code: {@link FORM_SENDS_PER_MINUTE} sends a
 * minute per visitor address. Counted in the deployment's shared limit store
 * (`rateLimit.store`), so every instance of the site counts the same sends.
 */
export const FORM_SEND_LIMITS: Readonly<Record<string, LimitRule>> = {
  [FORM_SEND_RULE]: {
    type: "window",
    windows: [{ max: FORM_SENDS_PER_MINUTE, perMs: 60_000 }],
  },
};

/** Where this site stores each kind of document a form can be defined in. */
function definingStores(
  self: PluginRouteContext["self"],
  componentStore: ComponentStore
): DefiningStores {
  const slug = (declared: string): string =>
    self.collections[declared] ?? declared;
  return {
    pages: slug(PAGES_SLUG),
    templates: slug(TEMPLATES_SLUG),
    layouts: slug(LAYOUTS_SLUG),
    components: {
      collection: componentStore.collection ?? slug(COMPONENTS_SLUG),
      field: componentStore.field || COMPONENT_DOCUMENT_FIELD,
    },
  };
}

/** The route declaration, bound to this page builder's providers and component store. */
export function formReceiverRoute(parts: {
  readonly providers: FormProviders;
  readonly componentStore: ComponentStore;
}): PluginRoute {
  return {
    method: "POST",
    path: FORM_RECEIVER_PATH,
    public: true,
    // Each answer is about one visitor's post and must never be cached.
    noStore: true,
    handler: async (request, ctx) => {
      // The Direct API through the plugin SDK, resolved per request, as the
      // plugin's other routes resolve it.
      const { getCachedNextly } = await import("@nextlyhq/plugin-sdk");
      const api = (await getCachedNextly()) as unknown as PublishedReadApi;
      const stores = definingStores(ctx.self, parts.componentStore);
      return receiveFormPost(request, {
        readNode: (document, nodeId, locale) =>
          publishedNode(api, stores, document, nodeId, locale),
        provider: id => parts.providers.get(id),
        limits: ctx.limits,
        deliver: (address, answers) => deliverAnswers(address, answers),
        logger: ctx.logger,
      });
    },
  };
}
