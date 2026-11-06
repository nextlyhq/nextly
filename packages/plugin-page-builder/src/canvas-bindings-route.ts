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
import type { PluginRouteContext } from "@nextlyhq/plugin-sdk";
import { respondDoc } from "nextly";
import { z } from "nextly/zod";

import {
  CANVAS_BINDINGS_ROUTE_PATH,
  demandFromWire,
  type CanvasBindingsRequest,
  type CanvasBindingsResponse,
} from "./canvas-bindings-contract";
import { readBodyWith } from "./composition-route-kit";
import { readingAsUser } from "./library-route";

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

/** What one source is read for, as the canvas sends it. */
const SOURCE_DEMAND = z
  .object({
    fields: z.array(NAME).max(MOST),
    follows: z
      .record(NAME, z.array(NAME).max(MOST))
      .refine(follows => Object.keys(follows).length <= MOST, {
        message: `At most ${String(MOST)} relations.`,
      }),
  })
  .strict();

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
    locale: z.string().min(1).max(35).optional(),
  })
  .strict();

/** What the route reads with, injected so the read is tested without a server. */
export interface CanvasBindingsReads {
  /** The sources the request names, read as the caller. */
  read(request: CanvasBindingsRequest): Promise<CanvasBindingsResponse>;
}

/** Answer one ask: the sources it names, as the caller reads them. */
export function readCanvasBindings(
  request: CanvasBindingsRequest,
  reads: CanvasBindingsReads
): Promise<CanvasBindingsResponse> {
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
      const [runtime, next, blocks] = await Promise.all([
        import("nextly/runtime"),
        import("@nextlyhq/blocks-react/next"),
        import("@nextlyhq/blocks-react"),
      ]);
      const nextly = runtime.requireNextly();
      // The caller as core judges their own reads: their user, and an API
      // key's own scope when the request carried one.
      const { user, actor } = await readingAsUser(ctx);
      const locale = request.locale;
      const reader = runtime.createEditorReader(
        {
          find: async args => await nextly.find(args),
          findSingle: async args => await nextly.findSingle(args),
        },
        { user, ...(actor === undefined ? {} : { actor }) },
        locale === undefined ? {} : { locale }
      );
      const bindings = await next.readBindingSources({
        documents: [],
        demand: demandFromWire(request.demand),
        entrySource: request.source.kind,
        slug: request.source.slug,
        ...(request.source.id === undefined
          ? {}
          : { entryId: request.source.id }),
        page: request.source.slug,
        ...(locale === undefined ? {} : { locale }),
        reader,
        // A published page's own allowance, for one ask.
        budget: blocks.createQueryBudget(),
      });
      return bindings === undefined
        ? { singles: [], shapes: [] }
        : blocks.bindingsToWire(bindings);
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
  path: string;
  noStore: true;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
} {
  return {
    method: "POST",
    path: CANVAS_BINDINGS_ROUTE_PATH,
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
