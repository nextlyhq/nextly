/**
 * The one write that puts a pattern in the library.
 *
 * Without it `planSaveAsPattern` has no caller, so the library the insert panel
 * reads is a screen nobody can put anything into: an author can browse patterns
 * and never make one.
 *
 * ## Why the server plans the save
 *
 * The request carries the DOCUMENT and the SELECTION, not a finished pattern.
 * What a saved pattern is — which nodes travel, what is re-identified, which
 * selections are refused — is the planner's question, and the planner answers it
 * against the block registry. That registry is not the same at both ends: the
 * browser holds the core blocks, while the server also holds every block another
 * plugin declared. A browser planning the save answers nesting questions about
 * blocks it has never heard of.
 *
 * It is also what makes the guarantee a rule rather than a convention. The
 * insert panel offers a tile only for a pattern the planner would place; a
 * pattern posted ready-made would be whatever its sender decided to send, and
 * that guarantee would hold only for senders who chose to honour it.
 *
 * ## Published, deliberately, and that is a WRITE decision
 *
 * The row is created `published`. The status column defaults to `draft`, and a
 * draft pattern is deliberately kept out of the insert panel — so a save that
 * left the default would answer the author with a pattern their own library
 * does not show, which is indistinguishable from a save that failed.
 *
 * Saving as a pattern is not a half-finished act: the author selected a run,
 * named it, and asked for it back. The draft state belongs to the OTHER path,
 * where a stored pattern is opened in the admin and revised.
 *
 * Stating the state NAME here is not the mistake the library READ avoids. That
 * read must not name a state, because it is asking which patterns are public
 * and the workflow owns that answer. This is stating an intent, which is what
 * every publish does — the admin's own entry form posts `status: "published"`
 * for exactly the same reason.
 *
 * It grants nothing, either: the write runs AS THE USER, so an author without
 * permission to publish a pattern is refused by core rather than by this route
 * having been careful.
 *
 * ## No declared permission, for the reason the read has none
 *
 * A declared permission has to spell the collection slug, and a host may rename
 * the collection — the grant is then seeded under the new name and demanded
 * under the old one, which is a route nobody can call. The write runs as the
 * user, so core enforces whatever the resolved collection actually seeded.
 *
 * ## No request size cap of its own
 *
 * The document posted here is the same document the page save posts through the
 * collection API. A cap invented here would be a second, different answer to a
 * question the platform answers once, and it would refuse a page the platform
 * itself accepts. What the STORED pattern may weigh is already bounded, by the
 * planner, against the host's own limits.
 *
 * @module save-pattern-route
 */
import {
  planSaveAsPattern,
  registryNestingSource,
  type BlockDocument,
  type PlanRefusal,
} from "@nextlyhq/blocks-engine";
import { NextlyError } from "nextly/errors";

import { PATTERNS_SLUG, patternsCollection } from "./collections/patterns";
import {
  SAVE_PATTERN_ROUTE_PATH,
  type SavePatternFields,
  type SavePatternRequest,
  type SavePatternResponse,
} from "./library-contract";

/**
 * The lifecycle state a saved pattern is created in.
 *
 * See the module docblock: the default is `draft`, and a draft pattern is not
 * offered, so leaving it would save a pattern the author cannot find.
 */
const SAVED_PATTERN_STATUS = "published";

/**
 * The field the collection stores the tree under.
 *
 * Named once, here, because this is the write half of the same translation
 * `library-route.ts` makes on the read half: the collection calls it `content`
 * and every other surface calls it the document. Getting it wrong stores a
 * pattern with no tree, which reads back as a row the panel silently drops.
 */
const PATTERN_DOCUMENT_FIELD = "content";

/**
 * The metadata keys a caller may set, taken FROM the collection.
 *
 * Derived rather than listed, and that is the point. A listed allowlist is a
 * second statement of what a pattern carries: a field added to the collection
 * would be unsettable here with nothing failing, and — the direction that
 * matters — a key the collection never declared could otherwise be forwarded to
 * the write. `id`, `status` and the timestamps are columns rather than declared
 * fields, so they are not in this set and a caller cannot reach them by naming
 * them.
 *
 * The document field is excluded because the PLANNER owns it. A caller
 * supplying `content` beside a selection would be saying two different things
 * about what to store, and the one the panel's guarantee rests on is the
 * planner's.
 *
 * A field may legitimately have no name — a presentational group is one — and
 * those are dropped rather than carried as a hole in the set: an unnamed field
 * is not a key a caller could send in the first place.
 *
 * Computed once: the collection is declared in code and cannot change between
 * requests, and building it per save would parse the whole collection on every
 * write.
 */
const SETTABLE_FIELDS: ReadonlySet<string> = new Set(
  patternsCollection()
    .fields.map(field => field.name)
    .filter(
      (name): name is string =>
        name !== undefined && name !== PATTERN_DOCUMENT_FIELD
    )
);

/** The capabilities this route uses, named rather than imported whole. */
export interface SavePatternRouteContext {
  self: { collections: Record<string, string | undefined> };
  user: unknown;
  services: {
    collections: {
      createEntry(
        collection: string,
        data: Record<string, unknown>,
        context: unknown
      ): Promise<{
        item: unknown;
        warnings?: SavePatternResponse["warnings"];
      }>;
    };
  };
}

/**
 * Store a selection as a pattern, as the user asking for it.
 *
 * Separate from the route declaration so it can be tested against a stub
 * without a server, exactly as the library read is: what this decides — what is
 * planned, what is written, and what a refusal answers with — is the part worth
 * holding still.
 */
export async function savePattern(
  req: Request,
  ctx: SavePatternRouteContext
): Promise<SavePatternResponse> {
  const request = await readRequest(req);
  const slug = ctx.self.collections[PATTERNS_SLUG] ?? PATTERNS_SLUG;

  const plan = planSaveAsPattern(
    request.document,
    request.selectedIds,
    { collection: slug, fields: request.fields },
    // The SERVER's registry, which is the one that knows every block: the
    // declared blocks another plugin contributed are registered here and not in
    // the browser.
    registryNestingSource()
  );
  if (plan.problem !== undefined) throw refusal(plan);

  const written = await ctx.services.collections.createEntry(
    plan.create.collection,
    {
      ...plan.create.fields,
      [PATTERN_DOCUMENT_FIELD]: plan.create.document,
      status: SAVED_PATTERN_STATUS,
    },
    // AS THE USER. A write with the instance's own identity would let any
    // authenticated caller create a pattern whatever the collection's
    // permissions say — and would record the wrong author on the version.
    { as: "user" as const, user: ctx.user ?? undefined }
  );

  return { id: writtenId(written.item), ...warningsOf(written.warnings) };
}

/**
 * The id of the row that was just created.
 *
 * Read defensively for the reason the library read reads its rows defensively:
 * what comes back has been through the collection's `afterChange` hooks, and a
 * hook may return anything. A row with no usable id is a save the caller cannot
 * address afterwards, and answering `{ id: undefined }` would report that as a
 * success — so it is reported as the failure it is, AFTER the row has committed,
 * which is what the message says.
 */
function writtenId(item: unknown): string {
  const id = (item as { id?: unknown } | null | undefined)?.id;
  if (typeof id === "string" && id !== "") return id;
  throw new NextlyError({
    code: "INTERNAL_ERROR",
    publicMessage: "The pattern was saved but could not be identified.",
    logMessage: "createEntry returned no usable id for a saved pattern",
    logContext: { reason: "save-pattern-no-id" },
  });
}

/** The post-commit warnings, present only when there are any to report. */
function warningsOf(
  warnings: SavePatternResponse["warnings"]
): Pick<SavePatternResponse, "warnings"> {
  return warnings === undefined || warnings.length === 0 ? {} : { warnings };
}

/**
 * The error a planner refusal answers with.
 *
 * 422 rather than 400: the request was understood and well formed, and it was
 * refused on a rule the caller can act on — which is what that status is for
 * here, and what `BUSINESS_RULE_VIOLATION` already carries.
 *
 * ONE message for every refusal, with the planner's own cause as the machine
 * code beside it. Phrasing a sentence per cause would put a second vocabulary of
 * refusals here, and the surface that has to phrase them for an author already
 * holds the first: it asks `saveAsPatternRefusal` before it offers the button,
 * and that answer carries what this one cannot — which parents a refused block
 * requires, which nominated property was invalid. A caller reaching this has
 * either skipped that question or disagreed with the server about the
 * registry, and neither is a case for inventing prose here.
 *
 * The cause travels VERBATIM. It is a `PlanProblem`, which is what the caller
 * compares against, and re-spelling it — screaming it, prefixing it — would make
 * the two ends agree only for as long as someone maintained the translation.
 */
function refusal(refused: PlanRefusal): NextlyError {
  return new NextlyError({
    code: "BUSINESS_RULE_VIOLATION",
    publicMessage: "The selection cannot be saved as a pattern.",
    publicData: {
      errors: [
        {
          path: "selectedIds",
          code: refused.problem,
          message: "The selection cannot be saved as a pattern.",
        },
      ],
    },
    logMessage: "Refused a save-as-pattern request",
    logContext: { reason: "save-pattern-refused", problem: refused.problem },
  });
}

/**
 * The request, or the refusal that it is not one.
 *
 * Only what THIS route needs to do its own job is checked here: the planner
 * takes a document and a list of ids, and handing it something else is a
 * `TypeError` reported as a server fault rather than as the bad request it is.
 *
 * The metadata are deliberately NOT validated. Which of them are required, how
 * long they may be, and whether a slug is already taken are the collection's
 * rules, and it enforces them on every other path into the same table. A second
 * copy here would be a copy that drifts — and it would drift SILENTLY, since
 * both copies passing is indistinguishable from one of them being right.
 */
async function readRequest(req: Request): Promise<SavePatternRequest> {
  const body = await readJson(req);
  if (typeof body !== "object" || body === null) throw malformed("body");
  const { document, selectedIds, fields } = body as Record<string, unknown>;

  if (typeof document !== "object" || document === null) {
    throw malformed("document");
  }
  if (
    !Array.isArray(selectedIds) ||
    selectedIds.length === 0 ||
    !selectedIds.every(id => typeof id === "string" && id !== "")
  ) {
    throw malformed("selectedIds");
  }
  if (typeof fields !== "object" || fields === null) throw malformed("fields");

  return {
    document: document as BlockDocument,
    selectedIds: selectedIds as string[],
    fields: settableFields(fields as Record<string, unknown>),
  };
}

/**
 * The metadata this write will carry, and nothing else the caller sent.
 *
 * Unknown keys are DROPPED rather than refused. A refusal would make an older
 * editor unable to save against a newer server the moment the dialog learns a
 * field, for a key that would have been ignored anyway; dropping keeps the two
 * versions working together, which is what a route serving a browser it does not
 * ship with has to do.
 */
function settableFields(fields: Record<string, unknown>): SavePatternFields {
  const kept: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(fields)) {
    if (SETTABLE_FIELDS.has(name)) kept[name] = value;
  }
  return kept as unknown as SavePatternFields;
}

/** The body as JSON, or the refusal that it was not JSON at all. */
async function readJson(req: Request): Promise<unknown> {
  try {
    return (await req.json()) as unknown;
  } catch {
    throw malformed("body");
  }
}

/**
 * What a request this route cannot read answers with.
 *
 * The PATH is named and the value is not. Which part of the request was wrong is
 * what a caller needs to fix it; echoing what they sent would put arbitrary
 * caller content into an error body, which the public-message rubric refuses for
 * every other error in the codebase.
 */
function malformed(path: string): NextlyError {
  return NextlyError.validation({
    errors: [
      {
        path,
        code: "INVALID_TYPE",
        message: "The request is not a save-as-pattern request.",
      },
    ],
  });
}

/**
 * The route declaration, thin on purpose.
 *
 * Everything it decides lives in {@link savePattern}. What is left here is the
 * shape of the contribution — the method, the path, the created status it
 * answers with, and the fact that it declares no permission — which is the part
 * a reader of `contributes.routes` needs to see without following a call.
 */
export function savePatternRoute(): {
  method: "POST";
  path: string;
  handler: (req: Request, ctx: SavePatternRouteContext) => Promise<Response>;
} {
  return {
    method: "POST",
    path: SAVE_PATTERN_ROUTE_PATH,
    // No `public: true`, which is what makes this authenticated, and no
    // `requiredPermission`, which is what keeps it callable on a site that
    // renamed the collection. See the module docblock.
    handler: async (req: Request, ctx: SavePatternRouteContext) =>
      Response.json(await savePattern(req, ctx), { status: 201 }),
  };
}
