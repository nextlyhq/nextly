/**
 * The `site-forms` service: what a routed page's forms need from the page
 * builder, read by `@nextlyhq/blocks-react/next` on each render to fill
 * `ctx.forms` (`SITE_FORMS_SERVICE`).
 *
 * The address forms post to, the value naming each stored document a page
 * draws as the receiver reads it, and a picked provider form as the public
 * reads it. The route knows none of these and the page builder knows all
 * three, so the page builder offers them and the route asks.
 *
 * @module forms/site-forms
 */
import {
  SITE_FORMS_SERVICE,
  type SiteFormsService,
} from "@nextlyhq/blocks-react";
import type { PluginRouteContext } from "@nextlyhq/plugin-sdk";

import { PAGES_CONTENT_FIELD } from "../collections/pages";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import type { ComponentStore } from "../library-route";

import { definingDocumentValue } from "./defining-document";
import type { FormProviders } from "./providers";
import { definingStores, FORM_RECEIVER_PATH } from "./route";

/**
 * Where the site's Nextly handler is mounted, as a scaffolded project mounts
 * it (`src/app/admin/api/[[...params]]/route.ts`): the half of the
 * receiver's address the plugin's own route path does not say.
 */
const API_MOUNT = "/admin/api";

/** The address every form on the site posts to. */
export const FORM_ACTION: string = `${API_MOUNT}/plugins/${PAGE_BUILDER_PLUGIN_NAME}${FORM_RECEIVER_PATH}`;

/** The service's name among the page builder's services. */
export const SITE_FORMS_SERVICE_NAME: typeof SITE_FORMS_SERVICE.service =
  SITE_FORMS_SERVICE.service;

/** The `site-forms` service, and the start of each boot that binds it. */
export interface SiteForms {
  /** Bind to this boot's collection names, which a host may have renamed. */
  start(self: PluginRouteContext["self"]): void;
  service(): SiteFormsService;
}

/** One page builder's `site-forms` service, over its providers and stores. */
export function siteForms(parts: {
  readonly providers: FormProviders;
  readonly componentStore: ComponentStore;
}): SiteForms {
  let self: PluginRouteContext["self"] | undefined;
  const stores = () =>
    definingStores(
      self ?? { name: PAGE_BUILDER_PLUGIN_NAME, collections: {}, singles: {} },
      parts.componentStore
    );
  return {
    start(started) {
      self = started;
    },
    service: () => ({
      action: FORM_ACTION,
      documentOf({ collection, id, field, design }) {
        // An entry drawn by its design: the receiver draws it as its page
        // does, its own blocks composed into the design.
        if (design === true) {
          return definingDocumentValue({ kind: "entry", collection, id });
        }
        const where = stores();
        if (collection === where.pages && field === PAGES_CONTENT_FIELD) {
          return definingDocumentValue({ kind: "page", id });
        }
        // A template keeps its document in one field, whichever the route
        // names it by.
        if (collection === where.templates) {
          return definingDocumentValue({ kind: "template", id });
        }
        if (
          collection === where.components.collection &&
          field === where.components.field
        ) {
          return definingDocumentValue({ kind: "component", id });
        }
        return undefined;
      },
      componentDocument: id => definingDocumentValue({ kind: "component", id }),
      async describe(form, locale) {
        const provider = parts.providers.get(form.provider);
        if (provider === undefined) return { unavailable: "missing" };
        return await provider.describe(form.ref, {
          access: { as: "public" },
          ...(locale === undefined ? {} : { locale }),
        });
      },
    }),
  };
}
