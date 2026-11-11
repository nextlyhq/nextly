/**
 * The import's routes: the field groups the site's content types hold, a
 * dry run that changes nothing, and the apply of a dry run a person
 * confirmed.
 *
 * An import changes the whole site's SEO, so each route is for whoever holds
 * site-wide SEO (`manage-seo`). Pages are read and written as that person
 * too, and a page whose SEO they may not change is left out of the import
 * and said so in the dry run.
 *
 * @module import/route
 */
import {
  NextlyError,
  respondAction,
  respondDoc,
  type PluginRoute,
  type PluginRouteContext,
  type ServiceOpts,
} from "@nextlyhq/plugin-sdk";
import { z } from "nextly/zod";

import { asCaller } from "../bulk/route";
import { MANAGE_SEO_PERMISSION, siteWide } from "../permissions";

import {
  IMPORT_APPLY_PATH,
  IMPORT_DRY_RUN_PATH,
  IMPORT_FILE_LIMIT,
  IMPORT_GROUPS_PATH,
  IMPORT_TARGETS,
  type ImportGroupsBody,
  type ImportRequest,
  type ImportTarget,
} from "./contract";
import {
  applyImport,
  importGroups,
  planImport,
  type ImportSetup,
} from "./plan";
import { count } from "./records";

const TARGET = z.enum(IMPORT_TARGETS as [ImportTarget, ...ImportTarget[]]);

const SOURCE = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("group"),
    field: z.string().min(1),
    map: z.record(z.string(), TARGET),
  }),
  z.object({
    kind: z.enum(["yoast", "rankMath", "payload"]),
    fileName: z.string().min(1).max(500),
    text: z.string().min(1).max(IMPORT_FILE_LIMIT),
  }),
]);

const REQUEST = z.object({
  source: SOURCE,
  locale: z.string().min(1).nullish(),
});

const APPLY = REQUEST.extend({ plan: z.string().min(1) });

/** A body read as JSON and parsed, or a refusal naming what is wrong. */
async function parsedBody<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw NextlyError.invalidInput({
      message: "The request body is not JSON.",
      logContext: { reason: "seo-import-body-not-json" },
    });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw NextlyError.invalidInput({
      message: "The request body is not one this route accepts.",
      logContext: {
        reason: "seo-import-body-invalid",
        issues: parsed.error.issues.map(issue => issue.path.join(".")),
      },
    });
  }
  return parsed.data;
}

/** The request as the import reads it. */
function requestOf(body: z.infer<typeof REQUEST>): ImportRequest {
  return {
    source: body.source,
    ...(body.locale ? { locale: body.locale } : {}),
  };
}

/** The person asking, reading and writing in the import's language. */
function asIn(
  ctx: PluginRouteContext,
  locale: string | undefined
): ServiceOpts {
  return { ...asCaller(ctx), ...(locale === undefined ? {} : { locale }) };
}

/** A query parameter's text, or none. */
function param(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name);
  return value === null || value === "" ? undefined : value;
}

/** The import's routes. */
export function importRoutes(setup: ImportSetup): PluginRoute[] {
  const routes: PluginRoute[] = [
    {
      method: "GET",
      path: IMPORT_GROUPS_PATH,
      noStore: true,
      requiredPermission: MANAGE_SEO_PERMISSION,
      handler: async (req, ctx) => {
        const locale = param(new URL(req.url), "locale");
        const body: ImportGroupsBody = {
          groups: await importGroups(ctx, setup, asIn(ctx, locale), locale),
        };
        return respondDoc(body);
      },
    },
    {
      method: "POST",
      path: IMPORT_DRY_RUN_PATH,
      requiredPermission: MANAGE_SEO_PERMISSION,
      handler: async (req, ctx) => {
        const request = requestOf(await parsedBody(req, REQUEST));
        const plan = await planImport(
          ctx,
          setup,
          request,
          asIn(ctx, request.locale)
        );
        return respondDoc(plan.body);
      },
    },
    {
      method: "POST",
      path: IMPORT_APPLY_PATH,
      requiredPermission: MANAGE_SEO_PERMISSION,
      handler: async (req, ctx) => {
        const body = await parsedBody(req, APPLY);
        const request = requestOf(body);
        const applied = await applyImport(
          ctx,
          setup,
          request,
          body.plan,
          asIn(ctx, request.locale)
        );
        const redirects =
          applied.redirects > 0
            ? ` and added ${count(applied.redirects, "redirect")}`
            : "";
        return respondAction(
          `Imported ${count(applied.pages, "page")}${redirects} in one step.`,
          { ...applied }
        );
      },
    },
  ];
  // Site-wide SEO: each asks for manage-seo before its handler runs.
  return routes.map(siteWide);
}
