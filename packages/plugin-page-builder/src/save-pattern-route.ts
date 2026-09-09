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
  documentRefusal,
  planSaveAsPattern,
  registryNestingSource,
  type BlockDocument,
  type PlanRefusal,
} from "@nextlyhq/blocks-engine";
import { respondMutation, slugify } from "nextly";
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
/**
 * The status a saved pattern is created with.
 *
 * EXPORTED so `capability-route` can derive which permissions this write needs
 * from the write itself. The status decides that — core requires the publish
 * grant on top of create when the persisted status is `published` — so a
 * capability answer that named `create` alone would say yes to an author the
 * save then refuses, which is the defect it exists to prevent.
 */
export const SAVED_PATTERN_STATUS = "published";

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
): Promise<Response> {
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
      slug: plan.create.fields.slug ?? derivedSlug(plan.create.fields.title),
      [PATTERN_DOCUMENT_FIELD]: plan.create.document,
      status: SAVED_PATTERN_STATUS,
    },
    // AS THE USER. A write with the instance's own identity would let any
    // authenticated caller create a pattern whatever the collection's
    // permissions say — and would record the wrong author on the version.
    { as: "user" as const, user: ctx.user ?? undefined }
  );

  // The canonical envelope, BUILT rather than assembled. `respondMutation`
  // reads the request's own side-effect warning scope — the same scope the
  // plugin collection facade writes post-commit failures into, because a
  // failure is recorded against every collector that is open — so forwarding
  // the facade's own `warnings` beside it would report each of them twice.
  return respondMutation("Pattern created.", writtenRow(written.item), {
    status: 201,
  });
}

/**
 * The identifier a pattern is keyed by when its author gave none.
 *
 * Derived from the title through the framework's own `slugify`, so a pattern's
 * slug is made the way every other slug in the product is made rather than by a
 * fourth rule that agrees with the others only until one of them moves.
 *
 * **A derivation can legitimately produce nothing, and that is not an edge
 * case.** `slugify` keeps `[a-z0-9]` and replaces everything else, so a title
 * written in a script it cannot transliterate comes back empty — measured,
 * `"見出しセクション"`, `"Заголовок"` and `"Πρότυπο"` all yield `""`. On a
 * Japanese or Russian site that is EVERY pattern, and an empty slug is refused
 * by a required field, so the feature would simply not work there.
 *
 * An empty derivation therefore falls back to a generated identifier. The slug
 * is an identity rather than an address — nothing resolves a pattern by it — so
 * a pattern keyed `pattern-3f2a1b2c` is as usable as one keyed `hero-banner`,
 * and the author is shown neither. The consequence worth knowing: two patterns
 * whose titles both derive to nothing never collide, where two titled "Hero" do.
 */
function derivedSlug(title: unknown): string {
  const derived = typeof title === "string" ? slugify(title) : "";
  return derived === ""
    ? `pattern-${crypto.randomUUID().slice(0, 8)}`
    : derived;
}

/**
 * The row that was just created, once it is one a caller can address.
 *
 * Read defensively for the reason the library read reads its rows defensively:
 * what comes back has been through the collection's `afterChange` hooks, and a
 * hook may return anything. A row with no usable id is a save the caller cannot
 * address afterwards, and putting it in the envelope would report that as a
 * success — so it is reported as the failure it is, AFTER the row has committed,
 * which is what the message says.
 */
function writtenRow(item: unknown): { id: string } & Record<string, unknown> {
  const row = (item ?? {}) as Record<string, unknown>;
  if (typeof row.id === "string" && row.id !== "") {
    return row as { id: string } & Record<string, unknown>;
  }
  throw new NextlyError({
    code: "INTERNAL_ERROR",
    publicMessage: "The pattern was saved but could not be identified.",
    logMessage: "createEntry returned no usable id for a saved pattern",
    logContext: { reason: "save-pattern-no-id" },
  });
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
  const body = objectAt(await readJson(req), "body");
  return {
    document: documentAt(body.document),
    selectedIds: selectionAt(body.selectedIds),
    fields: settableFields(objectAt(body.fields, "fields")),
  };
}

/**
 * The document the selection was made in, or the refusal that it is not one.
 *
 * Asked HERE as well as inside the planner, and the two are different questions.
 * The planner asks whether a document can be edited at all, and refuses one that
 * cannot as a rule the caller broke; this asks whether the REQUEST carried a
 * document, which is a question about the request and answers 400. Without it a
 * body of `{"document":{}}` reaches the planner as a well-formed request whose
 * refusal reads as the author's fault.
 *
 * The same published question either way, never a second predicate for it:
 * `documentRefusal` is the op layer's own rule about what it will edit.
 */
function documentAt(value: unknown): BlockDocument {
  if (documentRefusal(value) !== undefined) throw malformed("document");
  return value as BlockDocument;
}

/**
 * One part of the request that has to be an object, or the refusal that it is
 * not.
 *
 * Three parts ask the same question, and asking it in one place is what keeps
 * them answering it identically: written out three times, the check that `null`
 * is an object too is three chances to forget it, and forgetting it hands the
 * planner a `null` document that fails as a server fault rather than as the bad
 * request it is.
 */
function objectAt(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null) throw malformed(path);
  return value as Record<string, unknown>;
}

/**
 * The selected ids, or the refusal that they are not a selection.
 *
 * An empty list is refused HERE rather than left to the planner. The planner
 * would call it `empty` and this would answer 422 — a rule the caller broke
 * rather than a request that could not be read — and a caller who selected
 * nothing has not broken a rule about patterns. Which side answers decides
 * which status the caller gets, and only one of them is true.
 */
function selectionAt(value: unknown): readonly string[] {
  const ids = Array.isArray(value) ? (value as unknown[]) : undefined;
  if (ids === undefined || ids.length === 0) throw malformed("selectedIds");
  if (!ids.every(id => typeof id === "string" && id !== "")) {
    throw malformed("selectedIds");
  }
  return ids as string[];
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
 * Everything it decides lives in {@link savePattern}, which answers with a
 * finished `Response` rather than a body to be wrapped: the status a create
 * carries and the envelope it carries it in are two halves of one answer, and
 * splitting them puts the status here and the shape there.
 *
 * What is left is the shape of the CONTRIBUTION — the method, the path, and the
 * fact that it declares no permission — which is the part a reader of
 * `contributes.routes` needs to see without following a call.
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
    handler: savePattern,
  };
}
