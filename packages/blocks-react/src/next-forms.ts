/**
 * What a routed page's forms need to be sent: the receiver they post to,
 * the stored document each drawn document is, the path a visitor comes back
 * to, and a picked provider form's description, from the page builder's
 * `site-forms` service (`SITE_FORMS_SERVICE`).
 *
 * A route fills `ctx.forms` from it on every page it draws, so a Form block
 * on a published page posts with no script. Where the instance offers no
 * such service (no page builder), the page's forms have nowhere to post and
 * `ctx.forms` is left out.
 *
 * Reachable only from `next.ts`, because its reads go through
 * `nextly/runtime`: the package root stays usable with no CMS behind it.
 *
 * @module next-forms
 */
import { cachedFind, requireNextly, servedAddress } from "nextly/runtime";
import type { RenderContext, RequestLanguage } from "nextly/runtime";

import type {
  FormDrawing,
  FormReference,
  FormUnavailableDrawing,
  PageForms,
} from "./context";
import { emitPath, listPageSlug } from "./next-entry-paths";
import { offeredSiteForms, type SiteFormsService } from "./resolver";

/**
 * The key a route hands the render the stored row whose document it draws
 * under, where that is not the entry itself: the template drawing an
 * entry. A name no collection's field can take.
 */
export const FORM_DOCUMENT_KEY = "__nextlyFormDocument";

/**
 * A stored row holding a drawn document: its collection, id and field, or a
 * collection's entry drawn by its design (`design`).
 */
interface StoredDocumentRow {
  readonly collection: string;
  readonly id: string;
  readonly field: string;
  readonly design?: boolean;
}

/** The row a route set under {@link FORM_DOCUMENT_KEY}, if it set one. */
function setRow(
  entry: Readonly<Record<string, unknown>>
): StoredDocumentRow | undefined {
  const value: unknown = entry[FORM_DOCUMENT_KEY];
  if (typeof value !== "object" || value === null) return undefined;
  const { collection, id, field, design } = value as Record<string, unknown>;
  return typeof collection === "string" &&
    typeof id === "string" &&
    typeof field === "string"
    ? { collection, id, field, ...(design === true ? { design } : {}) }
    : undefined;
}

/** What a route knows of the page it draws, for its forms. */
interface PageFormsInput {
  /**
   * The installed plugins' services, where `site-forms` is offered: the
   * process's instance's where not given.
   */
  readonly plugins?: () => Readonly<
    Record<string, Readonly<Record<string, unknown>>>
  >;
  readonly entry: Readonly<Record<string, unknown>>;
  /** The entry's field the page draws. */
  readonly field: string;
  /**
   * Where the route found the entry: its collection, the path's segments,
   * the page of its list drawn and where each is served, and its language.
   */
  readonly route: Pick<
    RenderContext,
    "collection" | "slug" | "page" | "listPagePath" | "locale"
  >;
  readonly language: RequestLanguage;
  /** The route's cache scope, which every read it keeps is filed under. */
  readonly cacheScope: string | undefined;
  /** The route's own revalidation window, which a description never outlives. */
  readonly revalidate: number | false | undefined;
}

/** The forms of one routed page, and of each region drawn around it. */
export interface RoutedForms {
  /** The page's own document's forms. */
  readonly page: PageForms;
  /** The forms of a region's component, drawn around the page. */
  readonly region: (componentId: string) => PageForms;
}

/**
 * The path a visitor comes back to: the address this route serves the page
 * at, in the page's language, its list's page included.
 */
async function returnPathOf(input: PageFormsInput): Promise<string> {
  const { route } = input;
  if (route.listPagePath !== undefined) {
    return route.listPagePath(route.page ?? 1);
  }
  const path = emitPath(listPageSlug(route.slug, route.page)) ?? "/";
  return await servedAddress(path, input.language);
}

/**
 * The longest a kept description lives, in seconds. Nothing tells a page
 * when a provider's form changes (its fields, closing, opening), so a kept
 * description expires on its own, however long the page around it is kept.
 */
const DESCRIPTION_LIFETIME = 60;

/** A description read as the public reads it, kept a short while. */
function cachedDescribe(
  service: SiteFormsService,
  locale: string | undefined,
  revalidate: number | false | undefined,
  /** Filed under, so sites sharing a cache never draw each other's forms. */
  scope: string | undefined
): PageForms["describe"] {
  return async (form: FormReference) =>
    await cachedFind<FormDrawing | FormUnavailableDrawing>(
      async () => await service.describe(form, locale),
      {
        tags: [],
        keyParts: [
          "nextly-form-description",
          scope ?? "",
          form.provider,
          form.ref,
          locale ?? "",
        ],
        revalidate:
          typeof revalidate === "number"
            ? Math.min(revalidate, DESCRIPTION_LIFETIME)
            : DESCRIPTION_LIFETIME,
      }
    );
}

/**
 * The forms of the page a route draws, or `undefined` where the instance
 * offers no `site-forms` service, or none that can be read.
 */
export async function routedFormsFor(
  input: PageFormsInput
): Promise<RoutedForms | undefined> {
  let service: SiteFormsService | undefined;
  try {
    service = offeredSiteForms(
      (input.plugins ?? (() => requireNextly().plugins))()
    );
  } catch {
    return undefined;
  }
  if (service === undefined) return undefined;
  const offered = service;
  const returnTo = await returnPathOf(input);
  const describe = cachedDescribe(
    offered,
    input.route.locale,
    input.revalidate,
    input.cacheScope
  );
  const row = setRow(input.entry) ?? {
    collection: input.route.collection,
    id: typeof input.entry.id === "string" ? input.entry.id : "",
    field: input.field,
  };
  const formsOf = (document: string | undefined): PageForms => ({
    action: offered.action,
    returnTo,
    describe,
    ...(document === undefined ? {} : { document }),
  });
  return {
    page: formsOf(row.id === "" ? undefined : offered.documentOf(row)),
    region: componentId => formsOf(offered.componentDocument(componentId)),
  };
}
