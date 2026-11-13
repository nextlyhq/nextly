/**
 * The import's routes: the field groups the site's content types hold, a
 * dry run that changes nothing, and the apply of a dry run a person
 * confirmed.
 *
 * An import changes the whole site's SEO, so each route is for whoever holds
 * site-wide SEO (`manage-seo`). Pages are read and written as that person
 * too, and a page whose SEO they may not change is left out of the import
 * and said so in the dry run. The routes only parse the request and hand it
 * to the import engine (`import/plan`), as the person asking
 * (`import/actor`), so a command on the server runs the same import.
 *
 * @module import/route
 */
import {
  NextlyError,
  respondAction,
  respondDoc,
  type PluginRoute,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";
import { z } from "nextly/zod";

import { defaultLanguageOnly, queryOf } from "../bulk/route";
import { MANAGE_SEO_PERMISSION, siteWide } from "../permissions";

import { callerActor } from "./actor";
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
  typesWithOwnSeo,
  type ImportEngine,
  type ImportSetup,
} from "./plan";
import { count } from "./records";

const TARGET = z.enum(IMPORT_TARGETS as [ImportTarget, ...ImportTarget[]]);

/** Text from a file, as its reader keeps it. */
const TEXT = z.string().max(100_000);

/**
 * A file read in the browser: what it holds for each page, in the shape the
 * readers give it. Parsed here as outside input, since the browser sent it.
 */
const PARSED = z.object({
  records: z
    .array(
      z.object({
        label: TEXT,
        match: z.object({
          path: TEXT.optional(),
          origin: TEXT.optional(),
          slug: TEXT.optional(),
        }),
        values: z.object({
          title: TEXT.optional(),
          description: TEXT.optional(),
          socialTitle: TEXT.optional(),
          socialDescription: TEXT.optional(),
          canonical: TEXT.optional(),
          image: z
            .union([z.object({ id: TEXT }), z.object({ url: TEXT })])
            .optional(),
          hidden: z.boolean().optional(),
        }),
        variables: z.enum(["yoast", "rankMath"]).optional(),
        sourceTitle: TEXT.optional(),
        redirect: z
          .object({
            source: TEXT.optional(),
            address: TEXT.optional(),
            target: TEXT,
            permanent: z.boolean(),
          })
          .optional(),
      })
    )
    .max(200_000),
  from: z.record(z.string(), z.array(TEXT)),
  left: z.array(TEXT),
  warnings: z.array(TEXT),
});

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
  z.object({
    kind: z.literal("records"),
    tool: z.enum(["yoast", "rankMath", "payload"]),
    fileName: z.string().min(1).max(500),
    parsed: PARSED,
  }),
]);

const REQUEST = z.object({
  source: SOURCE,
  locale: z.string().min(1).nullish(),
  includeNeverServed: z.boolean().optional(),
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

/** The request as the import reads it, in the site's default language. */
async function requestOf(
  ctx: PluginRouteContext,
  body: z.infer<typeof REQUEST>
): Promise<ImportRequest> {
  const locale = await defaultLanguageOnly(ctx, body.locale);
  return {
    source: body.source,
    ...(locale === undefined ? {} : { locale }),
    ...(body.includeNeverServed === true ? { includeNeverServed: true } : {}),
  };
}

/** The import engine, run as the person asking. */
async function engineFor(
  ctx: PluginRouteContext,
  setup: ImportSetup
): Promise<ImportEngine> {
  return {
    ctx,
    actor: await callerActor(ctx, { pagePermissions: setup.pagePermissions }),
    setup,
  };
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
        const locale = await defaultLanguageOnly(ctx, queryOf(req).locale);
        const engine = await engineFor(ctx, setup);
        const body: ImportGroupsBody = {
          groups: await importGroups(engine, locale),
          ownSeo: await typesWithOwnSeo(engine),
          language: locale ?? (await ctx.publicAddresses.defaultLanguage()),
        };
        return respondDoc(body);
      },
    },
    {
      method: "POST",
      path: IMPORT_DRY_RUN_PATH,
      requiredPermission: MANAGE_SEO_PERMISSION,
      handler: async (req, ctx) => {
        const request = await requestOf(ctx, await parsedBody(req, REQUEST));
        const plan = await planImport(await engineFor(ctx, setup), request);
        return respondDoc(plan.body);
      },
    },
    {
      method: "POST",
      path: IMPORT_APPLY_PATH,
      requiredPermission: MANAGE_SEO_PERMISSION,
      handler: async (req, ctx) => {
        const body = await parsedBody(req, APPLY);
        const request = await requestOf(ctx, body);
        // Worked out again, and applied only where it is exactly the one the
        // dry run showed.
        const plan = await planImport(await engineFor(ctx, setup), request);
        if (plan.body.plan !== body.plan) {
          throw NextlyError.conflict({
            reason: "state",
            message:
              "Pages have changed since the dry run, so it no longer shows what would happen. Nothing was imported. Do the dry run again.",
          });
        }
        const applied = await applyImport(plan);
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
