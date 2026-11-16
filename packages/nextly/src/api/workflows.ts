/**
 * `/workflows/...`: a document's review state, taking a step, assigning, what waits for the
 * caller, and steps or assignments over several documents, for developers, with the admin's
 * rules.
 *
 * Every route needs a signed-in caller or an API key, and the right to READ each document it
 * names, asked as the document's own history routes ask it (`assertVersionDocumentReadable`): a
 * document the caller may not read is answered as not found. What a step needs beyond that is
 * the step's own (`takeWorkflowStep`): its permission, a person for an approval or a request for
 * changes, and the version and revision the caller saw.
 *
 * @module api/workflows
 * @experimental
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { z } from "zod";

import type { AuthenticatedScope } from "../auth/authenticated-scope";
import { readAccessCaller, readableEntities } from "../auth/entity-read-access";
import type { AuthContext } from "../auth/middleware";
import { container } from "../di/container";
import { resolveSingleDocumentId } from "../domains/singles/services/single-document-access";
import type { UserContext } from "../domains/singles/types";
import { registeredWorkflows } from "../domains/workflows/registry";
import {
  assignMany,
  reviewStateOf,
  stepMany,
  waitingFor,
} from "../domains/workflows/review-api";
import type { ReviewDocument } from "../domains/workflows/review-state-repository";
import {
  assignWorkflowParts,
  takeWorkflowStep,
  type Assignment,
  type WorkflowCaller,
} from "../domains/workflows/steps";
import { NextlyError } from "../errors";
import { getCachedNextly } from "../init";

import { readCaller } from "./authenticated-read";
import {
  privateToSession,
  respondBulk,
  respondDoc,
  respondList,
  respondMutation,
} from "./response-shapes";
import { requireRouteAuthentication } from "./route-auth";
import { assertVersionDocumentReadable } from "./versions-access";
import { withErrorHandler } from "./with-error-handler";
import { nextlyValidationFromZod } from "./zod-to-nextly-error";

/** A document as a request names it: an entry of a collection, or a Single. */
const DocumentRef = z.union([
  z.object({ collection: z.string().min(1), id: z.string().min(1) }).strict(),
  z.object({ single: z.string().min(1) }).strict(),
]);

const Part = z.string().min(1).max(64).nullable();

const Seen = z
  .object({
    part: Part,
    revision: z.number().int().min(0),
    version: z.string().min(1),
  })
  .strict();

const StepBody = z
  .object({
    document: DocumentRef,
    step: z.string().min(1),
    parts: z.union([z.literal("all"), z.array(Part).min(1).max(500)]),
    seen: z.array(Seen).max(500),
    comment: z.string().nullable().optional(),
  })
  .strict();

const Assignee = z
  .object({ kind: z.enum(["user", "role"]), id: z.string().min(1) })
  .strict();

const AssignmentBody = z
  .object({
    document: DocumentRef,
    part: Part,
    revision: z.number().int().min(0),
    assignee: Assignee.nullable(),
    dueAt: z.coerce.date().nullable().optional(),
  })
  .strict();

const AssignBody = z
  .object({ assignments: z.array(AssignmentBody).min(1).max(500) })
  .strict();

const StepManyBody = z
  .object({
    step: z.string().min(1),
    comment: z.string().nullable().optional(),
    documents: z
      .array(
        z
          .object({
            document: DocumentRef,
            parts: z.union([z.literal("all"), z.array(Part).min(1).max(500)]),
            seen: z.array(Seen).max(500),
          })
          .strict()
      )
      .min(1)
      .max(200),
  })
  .strict();

const WaitingQuery = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .passthrough();

/** Parsed at the boundary: a body or query that does not fit is the client's mistake. */
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw nextlyValidationFromZod(result.error);
  return result.data;
}

/**
 * Who asks, as each check needs them: the read checks' user and scope, and the step's caller. Null
 * is trusted server code (the Direct API's default), which no read check holds back and which
 * takes a step as the system.
 *
 * @experimental
 */
export type WorkflowAsker = {
  user: UserContext;
  scope: AuthenticatedScope | undefined;
  caller: WorkflowCaller & { kind: "user" | "key" };
} | null;

/**
 * The asker an authenticated caller is: built with the shared reader constructor, so the read
 * checks judge them as every other read route does, a key by its own scope, never its owner's.
 * A key is named by `apiKeyId`, as the history of its moves names it.
 *
 * @experimental
 */
export async function workflowAskerOf(
  auth: AuthContext,
  apiKeyId: string | undefined
): Promise<NonNullable<WorkflowAsker>> {
  const { user, authenticatedScope: scope } = await readCaller(auth);
  if (scope === undefined) {
    return { user, scope, caller: { kind: "user", userId: auth.userId } };
  }
  if (!apiKeyId) {
    throw NextlyError.validation({
      errors: [
        {
          path: "apiKeyId",
          code: "API_KEY_ID_REQUIRED",
          message: "A move made for an API key names the key, by its id.",
        },
      ],
    });
  }
  return {
    user,
    scope,
    caller: { kind: "key", keyId: apiKeyId, userId: auth.userId, scope },
  };
}

/** The step's caller: the asker's, or the system for trusted code. */
const callerOf = (asker: WorkflowAsker): WorkflowCaller =>
  asker === null ? { kind: "system" } : asker.caller;

/** The document a request names, as review state keys it; a Single's from its stored row. */
async function documentOf(
  ref: z.infer<typeof DocumentRef>
): Promise<ReviewDocument> {
  if ("collection" in ref) {
    return {
      scopeKind: "collection",
      scopeSlug: ref.collection,
      entryId: ref.id,
    };
  }
  const id = await resolveSingleDocumentId(ref.single);
  if (id === null) {
    throw NextlyError.notFound({
      logContext: {
        reason: "workflow-single-without-document",
        slug: ref.single,
      },
    });
  }
  return { scopeKind: "single", scopeSlug: ref.single, entryId: id };
}

/** Throws not found unless the asker may read `document` in every part named. */
async function assertReadable(
  asker: WorkflowAsker,
  document: ReviewDocument,
  parts: readonly (string | null)[] = []
): Promise<void> {
  if (asker === null) return;
  await assertVersionDocumentReadable(
    document.scopeKind,
    document.scopeSlug,
    document.entryId,
    asker.user,
    asker.scope,
    {},
    parts
  );
}

/** Whether the asker may read `document`; refusals other than not found are thrown. */
async function readableBy(
  asker: WorkflowAsker,
  document: ReviewDocument
): Promise<boolean> {
  try {
    await assertReadable(asker, document);
    return true;
  } catch (error) {
    if (NextlyError.isNotFound(error)) return false;
    throw error;
  }
}

const adapter = () => container.get<DrizzleAdapter>("adapter");

/** The parts a request names, for the read check: none for "all", which reads in every one. */
const namedParts = (parts: "all" | readonly (string | null)[]) =>
  parts === "all" ? [] : parts;

/** Every assignment a request names, each document resolved and read-checked. */
async function assignmentsOf(
  asker: WorkflowAsker,
  body: z.infer<typeof AssignBody>,
  check: boolean
): Promise<Assignment[]> {
  const assignments: Assignment[] = [];
  for (const each of body.assignments) {
    const document = await documentOf(each.document);
    if (check) await assertReadable(asker, document, [each.part]);
    assignments.push({
      document,
      part: each.part,
      revision: each.revision,
      assignee: each.assignee,
      dueAt: each.dueAt ?? null,
    });
  }
  return assignments;
}

/**
 * What the REST routes and the Direct API both run, each input parsed at the boundary as a
 * request body is: one implementation, so the two doors answer one caller alike.
 *
 * @experimental
 */
export const workflowOperations = {
  /** A document's review state, part by part. */
  async reviewState(asker: WorkflowAsker, input: unknown) {
    const document = await documentOf(parse(DocumentRef, input));
    await assertReadable(asker, document);
    return reviewStateOf(adapter(), document);
  },

  /** One step on one document, as the caller saw it. */
  async takeStep(asker: WorkflowAsker, input: unknown) {
    const body = parse(StepBody, input);
    const document = await documentOf(body.document);
    await assertReadable(asker, document, namedParts(body.parts));
    return takeWorkflowStep(adapter(), {
      document,
      step: body.step,
      parts: body.parts,
      seen: body.seen,
      comment: body.comment ?? null,
      caller: callerOf(asker),
    });
  },

  /** Assignments, all or nothing. */
  async assign(asker: WorkflowAsker, input: unknown) {
    const body = parse(AssignBody, input);
    return assignWorkflowParts(adapter(), {
      assignments: await assignmentsOf(asker, body, true),
      caller: callerOf(asker),
    });
  },

  /** One step over several documents, each refusal named. */
  async stepMany(asker: WorkflowAsker, input: unknown) {
    const body = parse(StepManyBody, input);
    const documents = [];
    for (const each of body.documents) {
      documents.push({
        document: await documentOf(each.document),
        parts: each.parts,
        seen: each.seen,
      });
    }
    return stepMany(adapter(), {
      documents,
      step: body.step,
      comment: body.comment ?? null,
      caller: callerOf(asker),
      readable: document => readableBy(asker, document),
    });
  },

  /** Assignments over several documents, each refusal named. */
  async assignMany(asker: WorkflowAsker, input: unknown) {
    const body = parse(AssignBody, input);
    return assignMany(adapter(), {
      assignments: await assignmentsOf(asker, body, false),
      caller: callerOf(asker),
      readable: document => readableBy(asker, document),
    });
  },

  /** What waits for the caller, a page at a time. Trusted code has nothing waiting for it. */
  async waiting(asker: NonNullable<WorkflowAsker>, input: unknown) {
    const query = parse(WaitingQuery, input);
    // Collections and Singles share one namespace of slugs, so one ask covers both.
    const attached = registeredWorkflows().flatMap(registered => [
      ...registered.collections,
      ...registered.singles,
    ]);
    const readable = await readableEntities(
      attached,
      readAccessCaller({
        user: asker.user,
        ...(asker.scope === undefined
          ? {}
          : { authenticatedScope: asker.scope }),
      })
    );
    const { items, total } = await waitingFor(adapter(), {
      caller: asker.caller,
      limit: query.limit,
      offset: (query.page - 1) * query.limit,
      readsEntity: (_kind, slug) => Promise.resolve(readable.has(slug)),
      readable: document => readableBy(asker, document),
    });
    const totalPages = Math.max(1, Math.ceil(total / query.limit));
    return {
      items,
      meta: {
        total,
        page: query.page,
        limit: query.limit,
        totalPages,
        hasNext: query.page < totalPages,
        hasPrev: query.page > 1,
      },
    };
  },
};

/** The REST routes, by the method the route parser names. */
const ROUTES: Record<
  string,
  (request: Request, asker: NonNullable<WorkflowAsker>) => Promise<Response>
> = {
  async getReviewState(request, asker) {
    const query = Object.fromEntries(new URL(request.url).searchParams);
    return respondDoc(
      await workflowOperations.reviewState(
        asker,
        query.single !== undefined
          ? { single: query.single }
          : { collection: query.collection, id: query.id }
      )
    );
  },

  async takeStep(request, asker) {
    return respondMutation(
      "Step taken.",
      await workflowOperations.takeStep(asker, await request.json())
    );
  },

  async assign(request, asker) {
    return respondMutation(
      "Assigned.",
      await workflowOperations.assign(asker, await request.json())
    );
  },

  async stepMany(request, asker) {
    const { moved, refused } = await workflowOperations.stepMany(
      asker,
      await request.json()
    );
    return respondBulk(
      `${moved.length} moved; ${refused.length} refused.`,
      moved.map(({ document, result }) => ({
        id: document.entryId,
        ...result,
      })),
      refused.map(({ document, code, message }) => ({
        id: document.entryId,
        code,
        message,
      }))
    );
  },

  async assignMany(request, asker) {
    const { assigned, refused } = await workflowOperations.assignMany(
      asker,
      await request.json()
    );
    return respondBulk(
      `${assigned.length} assigned; ${refused.length} refused.`,
      assigned.map(document => ({ id: document.entryId })),
      refused.map(({ document, code, message }) => ({
        id: document.entryId,
        code,
        message,
      }))
    );
  },

  async listWaiting(request, asker) {
    const { items, meta } = await workflowOperations.waiting(
      asker,
      Object.fromEntries(new URL(request.url).searchParams)
    );
    return respondList(items, meta);
  },
};

/**
 * Every `/workflows/...` route, dispatched by the method the route parser names. Private to the
 * session, refusals included: what a caller may see of review state depends on who asks.
 *
 * @experimental
 */
export const handleWorkflowRequest = privateToSession(
  withErrorHandler(
    async (request: Request, method: string): Promise<Response> => {
      // Authenticated first: a cold worker registers services only for a request that carries
      // credentials, so booting first would answer an anonymous request with a server error.
      const auth = await requireRouteAuthentication(request);
      await getCachedNextly();
      const asker = await workflowAskerOf(auth, auth.apiKeyId);
      const route = ROUTES[method];
      if (!route) {
        throw NextlyError.notFound({
          message: `Unknown workflows operation: ${method}`,
          logContext: { service: "workflows", method },
        });
      }
      return route(request, asker);
    }
  )
);
