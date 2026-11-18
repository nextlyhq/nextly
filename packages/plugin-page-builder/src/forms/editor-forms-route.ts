/**
 * The editor's two form routes: the forms a Form block's "Form: <pick a
 * form>" lists, and one picked form as the canvas draws it.
 *
 * **Read as the person editing, and only so.** Each provider is asked with
 * that person's access (`{ as: "user" }`), so it lists and describes what
 * they may see and nothing else; the page builder adds no read of its own.
 * Whether a picked form is a draft or closed is the provider's answer, from
 * that one form as it describes it to the author and to a visitor: never
 * from listing every form, which would read a whole collection per picked
 * form.
 *
 * **Core holds no plugin logic.** These routes name no plugin's collection,
 * field or address: a provider's label, its forms and each form's admin
 * address (`editHref`) are the provider's, passed on as it gave them.
 *
 * @module forms/editor-forms-route
 */
import type { PluginRouteContext } from "@nextlyhq/plugin-sdk";
import type {
  FormAccess,
  FormListing,
  FormProvider,
} from "@nextlyhq/plugin-sdk/blocks";
import { respondList } from "nextly";
import { z } from "nextly/zod";

import { ENTRIES_LOCALE_MAX } from "../entries-contract";
import { optionalText, parseRouteQuery } from "../route-query";

import {
  EDITOR_FORM_PARAMS,
  EDITOR_FORM_ROUTE_PATH,
  EDITOR_FORMS_ROUTE_PATH,
  type EditorFormProvider,
  type EditorFormResponse,
  type EditorFormsResponse,
} from "./editor-forms-contract";
import type { FormProviders } from "./providers";

/** What a picked form's reference may be, as a URL carries it. */
const EDITOR_FORM_QUERY = z.object({
  [EDITOR_FORM_PARAMS.provider]: z.string().min(1).max(64),
  [EDITOR_FORM_PARAMS.ref]: z.string().min(1).max(200),
  [EDITOR_FORM_PARAMS.locale]: optionalText(ENTRIES_LOCALE_MAX),
});

/** The person editing, as a provider reads a form for them. */
export function authorAccess(
  ctx: Pick<PluginRouteContext, "user" | "authenticatedScope">
): FormAccess | undefined {
  if (ctx.user === null) return undefined;
  return {
    as: "user",
    user: ctx.user,
    ...(ctx.authenticatedScope === undefined
      ? {}
      : { authenticatedScope: ctx.authenticatedScope }),
  };
}

/** One provider's forms for `access`; none where its listing fails. */
async function providerForms(
  provider: FormProvider,
  access: FormAccess
): Promise<EditorFormProvider> {
  let forms: readonly FormListing[] = [];
  try {
    forms = await provider.list(access);
  } catch {
    // One provider failing leaves the others, and says it is installed.
  }
  return { id: provider.id, label: provider.label, forms };
}

/**
 * Every provider the site has, each with the forms `access` may pick. With
 * no one to read as, none: a provider is never asked as nobody.
 */
export async function listEditorForms(
  providers: Pick<FormProviders, "all">,
  access: FormAccess | undefined
): Promise<EditorFormsResponse> {
  if (access === undefined) return { providers: [] };
  return {
    providers: await Promise.all(
      providers.all().map(provider => providerForms(provider, access))
    ),
  };
}

/** Which form to describe, and in which language. */
export interface EditorFormQuery {
  readonly provider: string;
  readonly ref: string;
  readonly locale?: string;
}

/**
 * One picked form, as its author sees it on the canvas: drawn, with whether
 * it is a draft; closed, with what a visitor reads instead; or missing.
 *
 * Two reads of that form alone. The author's says whether it is there for
 * them; a visitor's, which a provider answers for published, open forms
 * only, tells the rest: drawn for a visitor is published, closed is closed
 * with the words they read, and none at all, where the author has one, is
 * a draft.
 */
export async function describeEditorForm(
  providers: Pick<FormProviders, "get">,
  query: EditorFormQuery,
  access: FormAccess | undefined
): Promise<EditorFormResponse> {
  const provider = providers.get(query.provider);
  if (provider === undefined || access === undefined) {
    return { state: "missing" };
  }
  const locale = query.locale === undefined ? {} : { locale: query.locale };
  const asAuthor = await provider.describe(query.ref, { access, ...locale });
  if ("unavailable" in asAuthor) {
    return asAuthor.unavailable === "closed"
      ? closed(asAuthor.message)
      : { state: "missing" };
  }
  // Closed now, by its setting or by a limit only its page counts: what a
  // visitor is shown decides, with the words they read.
  const asVisitor = await provider.describe(query.ref, {
    access: { as: "public" },
    ...locale,
  });
  if (!("unavailable" in asVisitor)) {
    return { state: "published", drawing: asAuthor };
  }
  return asVisitor.unavailable === "closed"
    ? closed(asVisitor.message)
    : { state: "draft", drawing: asAuthor };
}

/** A closed form's answer, with a visitor's words where it has some. */
function closed(message: string | undefined): EditorFormResponse {
  return message === undefined
    ? { state: "closed" }
    : { state: "closed", message };
}

/** A route as the plugin declares it. */
interface EditorFormsRoute {
  readonly method: "GET";
  readonly path: string;
  readonly checksAccess: true;
  readonly handler: (
    req: Request,
    ctx: PluginRouteContext
  ) => Promise<Response>;
}

/**
 * The two routes. Authenticated, with no permission of their own: each
 * provider is asked as the caller, so its own access rules judge them.
 */
export function editorFormsRoutes(providers: FormProviders): {
  readonly list: EditorFormsRoute;
  readonly describe: EditorFormsRoute;
} {
  return {
    list: {
      method: "GET",
      path: EDITOR_FORMS_ROUTE_PATH,
      checksAccess: true, // Each provider reads as the caller.
      // The canonical list envelope, `{ items, meta }`: one provider per item.
      handler: async (_req, ctx) => {
        const { providers: listed } = await listEditorForms(
          providers,
          authorAccess(ctx)
        );
        return respondList([...listed], {
          total: listed.length,
          page: 1,
          limit: Math.max(listed.length, 1),
          totalPages: 1,
          hasNext: false,
          hasPrev: false,
        });
      },
    },
    describe: {
      method: "GET",
      path: EDITOR_FORM_ROUTE_PATH,
      checksAccess: true, // The provider reads as the caller.
      handler: async (req, ctx) => {
        const query = parseRouteQuery(
          req.url,
          Object.values(EDITOR_FORM_PARAMS),
          EDITOR_FORM_QUERY,
          "editor form route"
        );
        try {
          return Response.json(
            await describeEditorForm(providers, query, authorAccess(ctx))
          );
        } catch {
          // A provider that fails is not a deleted form: the canvas says
          // nothing rather than something untrue.
          return Response.json(
            { error: "The form could not be read." },
            { status: 502 }
          );
        }
      },
    },
  };
}
