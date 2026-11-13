/**
 * The editor's unbind plan: what the inspector keeps in a prop's place when
 * it unbinds it, planned by the one decision the page actions API takes
 * (`planUnbind`), so an author and an API client are kept to the same value
 * and told the same reason.
 *
 * The editor holds a document of its own, unsaved blocks included, and
 * applies its edits to it before a save: so the plan is made against the
 * document it sends, and the editor applies it as any edit. Nothing is
 * written here.
 *
 * ## Who may ask
 *
 * The route is authenticated, and the page named is read as the caller,
 * through core's one access gate, before anything is planned: a page the
 * caller may not read is not found. What the plan reads besides is what a
 * visitor reads, published entries and the fields the public may read, the
 * same for everyone.
 *
 * @module unbind-plan-route
 */
import {
  DEFAULT_LIMITS,
  surveyDocument,
  type DocumentLimits,
} from "@nextlyhq/blocks-engine";
import { pageActionSchema } from "@nextlyhq/builder/ops";
import {
  NextlyError,
  respondDoc,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";
import { z } from "nextly/zod";

import { TEMPLATES_SLUG } from "./collections/templates";
import {
  blocksDocumentOf,
  parsedWith,
  readBodyWith,
} from "./composition-route-kit";
import { editorReaderAsCaller } from "./entry-reads";
import { TEMPLATE_TARGET_FIELDS } from "./templates/template-preview-contract";
import { templateTargetOf } from "./templates/template-target";
import { planUnbind, type UnbindSource } from "./unbind-kept";
import {
  UNBIND_PLAN_ROUTE_PATH,
  type UnbindPlanRequest,
  type UnbindPlanResponse,
} from "./unbind-plan-contract";
import { unbindReadsOf } from "./visitor-entry-title";

/** A collection's slug. */
const SLUG = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

/** The body as it is read, before anything else is. */
const UnbindPlanBody = z
  .object({
    page: z.union([
      z
        .object({
          collection: SLUG,
          id: z.string().min(1).max(200),
          locale: z.string().min(1).max(35).optional(),
        })
        .strict(),
      z
        .object({
          single: SLUG,
          locale: z.string().min(1).max(35).optional(),
        })
        .strict(),
    ]),
    // Its shape is judged by the survey and the plan's own walk: a document
    // the walk can't find the block in is answered with a refusal.
    document: z.unknown(),
    action: z.unknown(),
  })
  .strict();

/** What the plan reads with, injected so the route is tested without a server. */
export interface UnbindPlanReads {
  /** The page as the caller reads it; `null` when they may not, or it is gone. */
  readPage(
    page: UnbindPlanRequest["page"]
  ): Promise<Readonly<Record<string, unknown>> | null>;
  /** The one unbind decision. */
  plan: typeof planUnbind;
  /** The collection templates are stored in, under the host's name for it. */
  readonly templates: string;
}

/**
 * The request, read from outside input: the unbind as the page actions API
 * spells it, and a document within the limits a saved one keeps to.
 */
export function unbindPlanRequestOf(
  raw: unknown,
  /** The site's document limits, which the editor and a save judge by. */
  limits: DocumentLimits = DEFAULT_LIMITS
): UnbindPlanRequest {
  const body = parsedWith(raw, UnbindPlanBody);
  const action = parsedWith(body.action, pageActionSchema, "action");
  if (action.kind !== "unbind-prop") {
    throw NextlyError.invalidInput({
      message: "Only an unbind is planned here.",
      logContext: { reason: "unbind-plan-not-unbind" },
    });
  }
  const survey = surveyDocument(body.document, {
    maxBytes: limits.maxBytes,
    maxDepth: limits.maxDepth,
    maxNodes: limits.maxNodes,
  });
  if (survey.tooLarge || survey.tooDeep || survey.tooManyNodes) {
    throw NextlyError.invalidInput({
      message: "The document is larger than a page may be.",
      logContext: { reason: "unbind-plan-document-too-large" },
    });
  }
  const document = blocksDocumentOf(body, "document");
  if (document === null) {
    throw NextlyError.invalidInput({
      message: "The document to plan against is not a document.",
      logContext: { reason: "unbind-plan-not-a-document" },
    });
  }
  return { page: body.page, document, action };
}

/** Answer one ask: the page read as the caller first, then the plan. */
export async function answerUnbindPlan(
  request: UnbindPlanRequest,
  reads: UnbindPlanReads
): Promise<UnbindPlanResponse> {
  const page = await reads.readPage(request.page);
  if (page === null) {
    throw NextlyError.notFound({
      logContext: { reason: "unbind-plan-missing-page" },
    });
  }
  const { page: at } = request;
  // A template's collection, read only from a template: an ordinary
  // collection may have a field of the same name, which names nothing.
  const target =
    !("single" in at) && at.collection === reads.templates
      ? templateTargetOf(page)
      : undefined;
  const source: UnbindSource = {
    // A Single's page reads the Single, named as the collection and the id.
    ...("single" in at
      ? { collection: at.single, id: at.single, kind: "single" as const }
      : { collection: at.collection, id: at.id }),
    ...(at.locale === undefined ? {} : { locale: at.locale }),
    ...(target === undefined ? {} : { templateTarget: target.collection }),
  };
  const { nodeId, prop, keep } = request.action;
  return reads.plan(source, request.document, nodeId, prop, keep ?? "visitor");
}

/** The reads the route binds: the page as the caller, and the one decision. */
function directUnbindPlanReads(ctx: PluginRouteContext): UnbindPlanReads {
  return {
    readPage: async page => {
      const reader = await editorReaderAsCaller(ctx, page.locale);
      const at = page.locale === undefined ? {} : { locale: page.locale };
      // Only what the plan reads of it, the template's collection: the
      // document itself is the editor's, sent with the ask.
      return "single" in page
        ? reader.findSingle({
            slug: page.single,
            select: TEMPLATE_TARGET_FIELDS,
            ...at,
          })
        : reader.findById({
            collection: page.collection,
            id: page.id,
            select: TEMPLATE_TARGET_FIELDS,
            ...at,
          });
    },
    // The one decision, with the reads only a route can make: the title of
    // the entry a link keeps going to.
    plan: async (source, document, nodeId, prop, keep) =>
      await planUnbind(
        source,
        document,
        nodeId,
        prop,
        keep,
        unbindReadsOf(ctx.services.collections)
      ),
    templates: ctx.self.collections[TEMPLATES_SLUG] ?? TEMPLATES_SLUG,
  };
}

/**
 * The route declaration. Authenticated (no `public: true`), with no
 * permission of its own: the page is read through core's gate as the
 * caller. A POST because an ask carries a document, never because it writes;
 * `noStore` because its answer is one person's ask.
 */
export function unbindPlanRoute(
  setup: {
    /** The site's document limits, as the page actions are given them. */
    readonly limits?: () => DocumentLimits;
  } = {}
): {
  method: "POST";
  checksAccess: true;
  path: string;
  noStore: true;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
} {
  return {
    method: "POST",
    path: UNBIND_PLAN_ROUTE_PATH,
    checksAccess: true, // The handler judges each caller.
    noStore: true,
    handler: async (req, ctx) => {
      const raw = await readBodyWith(req, z.unknown(), "unbind plan");
      return respondDoc(
        await answerUnbindPlan(
          unbindPlanRequestOf(raw, setup.limits?.() ?? DEFAULT_LIMITS),
          directUnbindPlanReads(ctx)
        )
      );
    },
  };
}
