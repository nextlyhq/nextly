/**
 * The route a Page Builder template's SEO panel reads: what the design, as
 * it is being edited, gives one of the type's published pages at every level
 * of the order of who wins, with the variables a rule may name and the pages
 * it may be previewed with.
 *
 * The design level is worked out by the Page Builder's own derivation for the
 * design handed in (`designLevelOf`), so the panel's preview shows the answer
 * the page is served once the design is saved, its bindings filled and its
 * site's name read as the page reads them. Every other level is read by the
 * resolver's own `levelsOf`.
 *
 * Answered to anyone who may read the type: the pages listed, counted and
 * previewed are those the reader may read, published. Changes nothing.
 *
 * @module template/route
 */
import {
  NextlyError,
  humanizeFieldName,
  type PageMetadataInput,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";
import { z } from "nextly/zod";

import { isRecord, textOf } from "../plain-values";
import { designLevelOf } from "../resolver/design-level";
import { levelsOf, NO_RULES } from "../resolver/page-levels";
import type { ReadRules } from "../resolver/provider";
import type { PatternField } from "../settings/contract";
import { tokenOf } from "../settings/pattern-fields";
import { publishedWhere } from "../sitemap";
import { mediaReadFor, siteOf } from "../tab/route";

import {
  SEO_TEMPLATE_PATH,
  type TemplateContext,
  type TemplateEntry,
} from "./contract";

/** How many pages the panel offers to preview with. */
const PREVIEW_CHOICES = 20;

/** The request: the design as edited, and which page to preview it with. */
const TEMPLATE_BODY = z.object({
  collection: z.string().min(1),
  entryId: z.string().min(1).nullish(),
  locale: z.string().min(1).nullish(),
  document: z.unknown(),
});

type TemplateBody = z.infer<typeof TEMPLATE_BODY>;

/** Field types whose value is words a rule can put in a title. */
const TEXT_TYPES: ReadonlySet<string> = new Set([
  "text",
  "textarea",
  "email",
  "number",
]);

/** The request body, parsed, or a refusal naming what is wrong. */
async function bodyOf(req: Request): Promise<TemplateBody> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw NextlyError.invalidInput({
      message: "The request body is not JSON.",
      logContext: { reason: "seo-template-body-not-json" },
    });
  }
  const parsed = TEMPLATE_BODY.safeParse(raw);
  if (!parsed.success) {
    throw NextlyError.invalidInput({
      message: "The request body is not one this route accepts.",
      logContext: {
        reason: "seo-template-body-invalid",
        issues: parsed.error.issues.map(issue => issue.path.join(".")),
      },
    });
  }
  return parsed.data;
}

/** What one of the type's fields is called on screen. */
function labelOfField(field: Record<string, unknown>, name: string): string {
  return textOf(field.label) ?? humanizeFieldName(name);
}

/** The type's names for one page and for its pages together. */
function namesOf(
  slug: string,
  meta: Record<string, unknown>
): { one: string; many: string } {
  const labels = isRecord(meta.labels) ? meta.labels : {};
  const one =
    textOf(labels.singular) ?? textOf(meta.label) ?? humanizeFieldName(slug);
  return { one, many: textOf(labels.plural) ?? one };
}

/** The type's fields a rule may name, and those a share image may come from. */
function fieldsOf(meta: Record<string, unknown>): {
  fields: PatternField[];
  imageFields: TemplateContext["imageFields"];
} {
  const declared = Array.isArray(meta.fields) ? meta.fields : [];
  const fields: PatternField[] = [];
  const imageFields: TemplateContext["imageFields"] = [];
  for (const field of declared) {
    if (!isRecord(field)) continue;
    const name = textOf(field.name);
    if (name === undefined || field.hasMany === true) continue;
    const type = String(field.type);
    if (TEXT_TYPES.has(type)) {
      fields.push({ name, token: tokenOf({ name, label: field.label }) });
    } else if (type === "upload") {
      imageFields.push({ name, label: labelOfField(field, name) });
    }
  }
  return { fields, imageFields };
}

/** A page as the preview list names it: its title, else its id. */
function entryOf(
  entry: Record<string, unknown>,
  fields: readonly PatternField[]
): TemplateEntry | undefined {
  const id = entry.id;
  if (typeof id !== "string" && typeof id !== "number") return undefined;
  const titled = ["title", "name", ...fields.map(field => field.name)]
    .map(name => textOf(entry[name]))
    .find(value => value !== undefined);
  return { id: String(id), label: titled ?? String(id) };
}

/** The type's published pages the reader may read, newest first, and how many. */
async function readablePages(
  ctx: PluginRouteContext,
  body: TemplateBody,
  where: Record<string, unknown> | undefined,
  limit: number
): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  const page = await ctx.services.collections.listEntries(
    body.collection,
    {
      ...(where === undefined ? {} : { where }),
      depth: 1,
      sort: { field: "updatedAt", direction: "desc" },
      pagination: { limit, page: 1 },
    },
    {
      as: "user",
      user: ctx.user ?? undefined,
      ...(body.locale ? { locale: body.locale } : {}),
    }
  );
  const total: unknown = page.pagination.total;
  return {
    rows: (page.data as unknown[]).filter(isRecord),
    total: typeof total === "number" ? total : 0,
  };
}

/** The route a template's SEO panel reads. */
export function seoTemplateRoute(setup: {
  readRules?: ReadRules;
  /** The origin the plugin was configured with, where it was. */
  baseUrl?: string;
}): {
  method: "POST";
  path: string;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
} {
  const readRules: ReadRules =
    setup.readRules ?? (() => Promise.resolve(NO_RULES));
  return {
    method: "POST",
    path: SEO_TEMPLATE_PATH,
    handler: async (req, ctx) => {
      const body = await bodyOf(req);
      const caller = ctx.caller;
      if (
        caller === null ||
        !(await caller.can("read", body.collection, { anyEntry: true }))
      ) {
        throw NextlyError.forbidden({
          logContext: {
            reason: "seo-template-not-a-reader",
            collection: body.collection,
          },
        });
      }
      const meta: unknown = await ctx.services.collections.getCollection(
        body.collection,
        {}
      );
      const record = isRecord(meta) ? meta : {};
      const names = namesOf(body.collection, record);
      const { fields, imageFields } = fieldsOf(record);
      const published = await publishedWhere(ctx.services, body.collection);
      const listed = await readablePages(ctx, body, published, PREVIEW_CHOICES);
      const entries = listed.rows
        .map(row => entryOf(row, fields))
        .filter((entry): entry is TemplateEntry => entry !== undefined);
      // The page asked for where the reader may read it, else the newest.
      const wanted = body.entryId ?? entries[0]?.id;
      let previewedRow =
        wanted === undefined
          ? undefined
          : listed.rows.find(row => String(row.id) === wanted);
      if (previewedRow === undefined && wanted !== undefined) {
        const one = await readablePages(
          ctx,
          body,
          {
            and: [
              { id: { equals: wanted } },
              ...(published ? [published] : []),
            ],
          },
          1
        );
        previewedRow = one.rows[0];
      }
      const locale = body.locale ?? undefined;
      const rules = await readRules(ctx, locale);
      const answer: TemplateContext = {
        typeLabel: names.one,
        typePlural: names.many,
        fields,
        imageFields,
        entries,
        count: listed.total,
        site: siteOf(rules, setup.baseUrl, req),
      };
      if (previewedRow !== undefined) {
        const source: PageMetadataInput["source"] = {
          kind: "entry",
          collection: body.collection,
          entry: previewedRow,
        };
        const reading = mediaReadFor(
          ctx,
          (await caller.can("read", "media")) === true
        );
        const input: PageMetadataInput = {
          ...(locale === undefined ? {} : { locale }),
          source,
          code: {},
          // The design as edited, drawing this page, as its route will.
          derived: await designLevelOf(reading, source, locale, body.document),
        };
        answer.previewed = {
          id: String(previewedRow.id),
          levels: await levelsOf(reading, input, rules),
        };
      }
      return Response.json(answer);
    },
  };
}
