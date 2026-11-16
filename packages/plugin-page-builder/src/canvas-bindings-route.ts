/**
 * The read behind the bound props on the editor's canvas: the entry being
 * edited, the Singles its bindings read and the site settings, AS THE PERSON
 * EDITING reads them.
 *
 * The canvas works out what its bindings read from the document it draws
 * (`bindingDemand`) and sends only that. This route reads it through the
 * published page's own pipeline (`readBindingSources`), handing it the editor
 * reader (`createEditorReader`): the entry and the Singles are read as the
 * caller, drafts included, with their row and field access; the site
 * settings and the field shapes are the public's, the same for everyone and
 * holding no one's data. A published page reads the same sources as an
 * anonymous visitor, so nothing read here reaches it.
 *
 * ## Who may ask
 *
 * The route is authenticated, and every source is read through core's one
 * access gate as the caller (`readingAsUser`, `overrideAccess: false`): the
 * gate is the only door, and no second check is made here. A source the
 * caller may not read is refused by the gate before anything of it is read
 * or any read hook runs, and reads as nothing, so its bindings show their
 * fallbacks, as a published page shows them for a source the public may not
 * read.
 *
 * ## Caching
 *
 * None of what is read as the caller. The answer is one person's, so the
 * route is `noStore`, it is never tagged, and nothing a published page reads
 * is made from it.
 *
 * @module canvas-bindings-route
 */
import type { PageReadReport } from "@nextlyhq/blocks-react";
import type { PluginRouteContext } from "@nextlyhq/plugin-sdk";
import { respondDoc } from "nextly";
import { z } from "nextly/zod";

import {
  CANVAS_BINDINGS_ROUTE_PATH,
  conditionsFromWire,
  demandFromWire,
  type CanvasBindingsRequest,
  type CanvasBindingsResponse,
} from "./canvas-bindings-contract";
import { readBodyWith } from "./composition-route-kit";
import { editorReaderAsCaller, mediaReaderAsCaller } from "./entry-reads";

/** A field name a binding may read: no paths, operators or quoting. */
const NAME = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);

/** A collection's or a Single's slug. */
const SLUG = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

/** At most this many fields, follows or Singles in one ask: a page's worth. */
const MOST = 200;

/** The most reads an ask may be allowed: far past any page's allowance. */
const MOST_READS = 100_000;

/** What one source is read for, as the canvas sends it. */
/*
 * A source and each relation it follows name at least one field: the canvas
 * never asks for none, and an empty projection would read the whole entry,
 * every large field with it.
 */
const SOURCE_DEMAND = z
  .object({
    fields: z.array(NAME).min(1).max(MOST),
    follows: z
      .record(NAME, z.array(NAME).min(1).max(MOST))
      .refine(follows => Object.keys(follows).length <= MOST, {
        message: `At most ${String(MOST)} relations.`,
      }),
  })
  .strict();

/**
 * How many field-shape lookups an ask can cost: one per source (the entry,
 * each Single, each list's collection) and one per relation a path follows.
 * Each list is capped on its own, and this caps them in all, so one ask cannot
 * name the most Singles each following the most relations.
 */
function shapeLookupsOf(body: {
  readonly demand: {
    readonly entry?: { readonly follows: Readonly<Record<string, unknown>> };
    readonly singles: Readonly<
      Record<string, { readonly follows: Readonly<Record<string, unknown>> }>
    >;
  };
  readonly lists: readonly string[];
}): number {
  const sources = [
    ...(body.demand.entry === undefined ? [] : [body.demand.entry]),
    ...Object.values(body.demand.singles),
  ];
  return (
    sources.length +
    sources.reduce(
      (sum, source) => sum + Object.keys(source.follows).length,
      0
    ) +
    body.lists.length
  );
}

/** The body as it is read, before anything else is. */
const CanvasBindingsBody = z
  .object({
    source: z
      .object({
        kind: z.enum(["collection", "single"]),
        slug: SLUG,
        id: z.string().min(1).max(200).optional(),
      })
      .strict(),
    demand: z
      .object({
        entry: SOURCE_DEMAND.optional(),
        singles: z
          .record(SLUG, SOURCE_DEMAND)
          .refine(singles => Object.keys(singles).length <= MOST, {
            message: `At most ${String(MOST)} Singles.`,
          }),
        site: z.boolean(),
        formatsDates: z.boolean(),
      })
      .strict(),
    lists: z.array(SLUG).max(MOST),
    locale: z.string().min(1).max(35).optional(),
    conditions: z
      .object({
        any: z.boolean(),
        entryFields: z.array(NAME).max(MOST),
        ordersValues: z.boolean(),
      })
      .strict()
      .optional(),
    // At most a published page's allowance: an ask is one page's reads.
    allowance: z.number().int().min(0).max(MOST_READS).optional(),
  })
  .strict()
  .refine(body => shapeLookupsOf(body) <= MOST, {
    message: `At most ${String(MOST)} sources, relations and lists in all.`,
  });

/**
 * What the route answers: the sources read, and what reading them cost the
 * page's allowance, so the editor's read meter counts the binding reads as
 * they were made rather than working them out again.
 *
 * @experimental Settles with the editor's read meter.
 */
export type CanvasBindingsAnswer = CanvasBindingsResponse & {
  readonly reads?: PageReadReport;
};

/** What the route reads with, injected so the read is tested without a server. */
export interface CanvasBindingsReads {
  /** The sources the request names, read as the caller. */
  read(request: CanvasBindingsRequest): Promise<CanvasBindingsAnswer>;
}

/** Answer one ask: the sources it names, as the caller reads them. */
export function readCanvasBindings(
  request: CanvasBindingsRequest,
  reads: CanvasBindingsReads
): Promise<CanvasBindingsAnswer> {
  return reads.read(request);
}

/** The read the route binds: the editor reader, as the caller. */
function directCanvasBindingsReads(
  ctx: PluginRouteContext
): CanvasBindingsReads {
  return {
    // Imported at call time, so loading this module costs none of the
    // runtime, as the route's other reads are.
    read: async request => {
      const [next, blocks] = await Promise.all([
        import("@nextlyhq/blocks-react/next"),
        import("@nextlyhq/blocks-react"),
      ]);
      const locale = request.locale;
      // The editor reader as the caller: their user, and an API key's own
      // scope when the request carried one. The page's own entry and each
      // entry a binding follows to are read by id, so a pending working
      // draft is what the canvas shows.
      const reader = await editorReaderAsCaller(ctx, locale);
      // The media library as the caller reads it, so a binding into a media
      // item (its alt text) shows on the canvas as it does on the page.
      const media = await mediaReaderAsCaller(ctx);
      // A published page's own allowance, for one ask, counting what it
      // spends, so the editor's read meter adds what these reads cost as
      // they were made, as a named query's run reports its reads.
      // Under the reads the page has left at that point, when the meter
      // says, so a read past them is refused here as it is there.
      const budget = blocks.createQueryBudget(request.allowance);
      const bindings = await next.readBindingSources({
        documents: [],
        demand: demandFromWire(request.demand),
        // The lists' collections the canvas found in the tree it draws, so
        // their public field shapes judge the items' bindings, as on the
        // published page.
        lists: request.lists,
        entrySource: request.source.kind,
        slug: request.source.slug,
        ...(request.source.id === undefined
          ? {}
          : { entryId: request.source.id }),
        page: request.source.slug,
        ...(locale === undefined ? {} : { locale }),
        reader,
        media,
        budget,
        // The entry fields the page's conditions check, read with the
        // bindings', as the published page reads them.
        ...(request.conditions === undefined
          ? {}
          : { conditions: conditionsFromWire(request.conditions) }),
      });
      const reads = budget.report();
      return bindings === undefined
        ? { singles: [], shapes: [], reads }
        : { ...blocks.bindingsToWire(bindings), reads };
    },
  };
}

/**
 * The route declaration. Authenticated (no `public: true`), with no
 * permission of its own: core's gate judges each source's read as the
 * caller.
 * A POST because an ask carries what to read, never because it writes;
 * `noStore` because its answer is one person's.
 */
export function canvasBindingsRoute(): {
  method: "POST";
  checksAccess: true;
  path: string;
  noStore: true;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
} {
  return {
    method: "POST",
    path: CANVAS_BINDINGS_ROUTE_PATH,
    checksAccess: true, // The handler judges each caller.
    noStore: true,
    handler: async (req, ctx) => {
      const body = await readBodyWith(
        req,
        CanvasBindingsBody,
        "canvas bindings"
      );
      return respondDoc(
        await readCanvasBindings(body, directCanvasBindingsReads(ctx))
      );
    },
  };
}
