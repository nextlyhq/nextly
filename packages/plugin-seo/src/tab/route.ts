/**
 * The SEO tab's route: every level of the order of who wins for a document as
 * the author is typing it, except what they typed in its `seo` group, with
 * what the tab needs to draw the answer (the site's name and address, the
 * content type's name, and the names of the fields a value came from).
 *
 * The tab puts the typed values on top itself (`tab/typed`) and works out the
 * answer with the same `resolveOrder` the page's head is answered by, so its
 * preview follows each keystroke and agrees with what the page serves. Levels
 * are read by `levelsOf`, the resolver's own reading of a page, never a copy.
 *
 * What a route's code supplies cannot be known here: the admin does not run
 * the page's route. That level is left empty until the address record keeps
 * what each route supplies.
 *
 * Answered to anyone who may read the collection or the Single, an editor or
 * a reader shown the page read-only. The page's images are looked up only for
 * a caller who may read the media library.
 *
 * @module tab/route
 */
import {
  humanizeFieldName,
  NextlyError,
  type PageMetadataInput,
  type PluginContext,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";
import { z } from "nextly/zod";

import type { Levels } from "../resolver/order";
import { productionAddressesOf } from "../canonical";
import { levelsOf, NO_RULES, type SiteRules } from "../resolver/page-levels";
import type { ReadRules } from "../resolver/provider";
import type { ReadSocialCardRules } from "../social/card";
import { shareImageProblems } from "../social/problems";
import type { ReadStructuredDataRules } from "../structured-data/rules";

import {
  SEO_RESOLVE_PATH,
  STRUCTURED_DATA_FIELD,
  type SeoTabContext,
} from "./contract";
import { tabStructuredData } from "./structured";
import { withoutTyped } from "./typed";

/** No settings yet: the site's rules are empty. */
const noRules: ReadRules = () => Promise.resolve(NO_RULES);

/** The request: the document as typed, and which document it is. */
const RESOLVE_BODY = z.object({
  kind: z.enum(["collection", "single"]),
  slug: z.string().min(1),
  locale: z.string().min(1).nullish(),
  /** The saved entry's id; none while it is being created. */
  id: z.string().min(1).nullish(),
  document: z.record(z.string(), z.unknown()),
});

type ResolveBody = z.infer<typeof RESOLVE_BODY>;

/** Where the plugin's SEO is, and how the route reads the site's rules. */
export interface SeoTabRouteSetup {
  /** The collections the plugin adds SEO to. */
  collections: readonly string[];
  /** The Singles the plugin adds SEO to. */
  singles: readonly string[];
  /** The origin the plugin was configured with, where it was. */
  baseUrl?: string;
  /** The `seo` group's fields, by name. */
  fields: readonly string[];
  /** Where the page's head reads the site's rules from. */
  readRules?: ReadRules;
  /** Where structured data reads its rules from. */
  readStructuredDataRules?: ReadStructuredDataRules;
  /** Where the social card reads its rules from. */
  readSocialCardRules?: ReadSocialCardRules;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The request body, parsed, or a refusal naming what is wrong. */
async function bodyOf(req: Request): Promise<ResolveBody> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw NextlyError.invalidInput({
      message: "The request body is not JSON.",
      logContext: { reason: "seo-resolve-body-not-json" },
    });
  }
  const parsed = RESOLVE_BODY.safeParse(raw);
  if (!parsed.success) {
    throw NextlyError.invalidInput({
      message: "The request body is not one this route accepts.",
      logContext: {
        reason: "seo-resolve-body-invalid",
        issues: parsed.error.issues.map(issue => issue.path.join(".")),
      },
    });
  }
  return parsed.data;
}

/**
 * Whether the caller may open documents of this kind: an editor, or a reader
 * shown the page read-only, whose tab still shows what the page will use.
 * What the route answers is worked out from the document the caller sends,
 * and changes nothing.
 */
async function mayOpen(
  ctx: PluginRouteContext,
  body: ResolveBody
): Promise<boolean> {
  const caller = ctx.caller;
  if (caller === null) return false;
  if (body.kind === "single") return caller.can("read", body.slug);
  return caller.can("read", body.slug, { anyEntry: true });
}

/**
 * The context the page's images are looked up through: the plugin's own,
 * where the caller may read the media library, and otherwise one that finds
 * no media, so an id the caller sends never answers with a file they may not
 * read.
 */
export function mediaReadFor<C extends PluginContext>(
  ctx: C,
  mayReadMedia: boolean
): C {
  if (mayReadMedia) return ctx;
  return {
    ...ctx,
    services: {
      ...ctx.services,
      // The library's other reads kept, through its own object.
      media: Object.create(ctx.services.media, {
        findById: {
          value: () =>
            Promise.reject(
              NextlyError.notFound({
                logContext: { reason: "seo-resolve-media-not-readable" },
              })
            ),
        },
      }) as C["services"]["media"],
    },
  };
}

/** The type's declaration in the app's configuration, where it is there. */
function declarationOf(
  ctx: PluginContext,
  body: ResolveBody
): Record<string, unknown> | undefined {
  const declared: readonly unknown[] =
    (body.kind === "collection"
      ? ctx.config.collections
      : ctx.config.singles) ?? [];
  return declared.find(
    (entity): entity is Record<string, unknown> =>
      isRecord(entity) && entity.slug === body.slug
  );
}

/** A declaration's name for one of its pages, else its slug made readable. */
function typeLabelOf(
  declaration: Record<string, unknown> | undefined,
  slug: string
): string {
  const named = declaration?.labels ?? declaration?.label;
  if (typeof named === "string" && named.trim() !== "") return named;
  if (isRecord(named) && typeof named.singular === "string") {
    return named.singular;
  }
  return humanizeFieldName(slug);
}

/** What one of the declaration's fields is called on screen. */
function fieldLabelOf(
  declaration: Record<string, unknown> | undefined,
  name: string
): string {
  const fields = Array.isArray(declaration?.fields) ? declaration.fields : [];
  const field: unknown = fields.find(
    (each: unknown) => isRecord(each) && each.name === name
  );
  const label = isRecord(field) ? field.label : undefined;
  return typeof label === "string" && label.trim() !== ""
    ? label
    : humanizeFieldName(name);
}

/** What each field a value came from is called on screen. */
function fieldLabelsOf(
  declaration: Record<string, unknown> | undefined,
  levels: Levels
): Record<string, string> {
  const named = [
    levels.content.title?.field,
    levels.content.description?.field,
    levels.content.image?.field,
  ].filter((name): name is string => name !== undefined);
  return Object.fromEntries(
    named.map(name => [name, fieldLabelOf(declaration, name)])
  );
}

/** An address's origin, or nothing where it is not an http(s) address. */
function originOf(address: string | undefined): string | undefined {
  if (address === undefined) return undefined;
  try {
    const url = new URL(address);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.origin
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Where the site is shown to be: its main production address, else the
 * origin the plugin was configured with, else the one the admin is on.
 */
function siteOf(
  rules: SiteRules,
  baseUrl: string | undefined,
  req: Request
): SeoTabContext["site"] {
  // Where search engines see the site: its first production address, the
  // environment's winning as the resolver's do; else the origin the plugin
  // was configured with, else the one the admin is on.
  const origin =
    productionAddressesOf(rules.productionAddresses)[0] ??
    originOf(baseUrl) ??
    new URL(req.url).origin;
  return {
    ...(rules.siteName === undefined ? {} : { name: rules.siteName }),
    origin,
  };
}

/** The route the SEO tab reads its levels from. */
export function seoTabRoute(setup: SeoTabRouteSetup): {
  method: "POST";
  path: string;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
} {
  const readRules = setup.readRules ?? noRules;
  return {
    method: "POST",
    path: SEO_RESOLVE_PATH,
    handler: async (req, ctx) => {
      const body = await bodyOf(req);
      // Only the types this plugin adds SEO to have a tab to answer.
      const targets =
        body.kind === "collection" ? setup.collections : setup.singles;
      if (!targets.includes(body.slug)) {
        throw NextlyError.notFound({
          logContext: { reason: "seo-resolve-not-a-target", slug: body.slug },
        });
      }
      if (!(await mayOpen(ctx, body))) {
        throw NextlyError.forbidden({
          logContext: { reason: "seo-resolve-not-an-editor", slug: body.slug },
        });
      }
      const locale = body.locale ?? undefined;
      // The form holds the fields alone: the saved entry's id says which page
      // the address record knows it as.
      const asTyped =
        body.id === undefined || body.id === null
          ? body.document
          : { ...body.document, id: body.id };
      const document = withoutTyped(asTyped);
      const input: PageMetadataInput = {
        ...(locale === undefined ? {} : { locale }),
        source:
          body.kind === "collection"
            ? { kind: "entry", collection: body.slug, entry: document }
            : { kind: "single", slug: body.slug, document },
        code: {},
        derived: {},
      };
      const reading = mediaReadFor(
        ctx,
        (await ctx.caller?.can("read", "media")) === true
      );
      const rules = await readRules(ctx, locale);
      const levels = await levelsOf(reading, input, rules);
      const declaration = declarationOf(ctx, body);
      const answer: SeoTabContext = {
        levels,
        site: siteOf(rules, setup.baseUrl, req),
        typeLabel: typeLabelOf(declaration, body.slug),
        fieldLabels: fieldLabelsOf(declaration, levels),
        fields: [...setup.fields],
      };
      // Read for the document as typed, the tab's own values included.
      const typed: PageMetadataInput = {
        ...input,
        source:
          body.kind === "collection"
            ? { kind: "entry", collection: body.slug, entry: asTyped }
            : { kind: "single", slug: body.slug, document: asTyped },
      };
      if (setup.fields.includes(STRUCTURED_DATA_FIELD)) {
        answer.structuredData = await tabStructuredData(
          reading,
          typed,
          {
            readRules,
            ...(setup.readStructuredDataRules === undefined
              ? {}
              : { readStructuredDataRules: setup.readStructuredDataRules }),
          },
          name => fieldLabelOf(declaration, name)
        );
      }
      const shareProblems = await shareImageProblems(reading, typed, {
        readRules,
        ...(setup.readSocialCardRules === undefined
          ? {}
          : { readSocialCardRules: setup.readSocialCardRules }),
      });
      answer.shareImage = {
        problems: shareProblems.map(({ message, fix }) => ({ message, fix })),
      };
      return Response.json(answer);
    },
  };
}
