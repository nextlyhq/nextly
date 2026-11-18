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
import {
  canReadEntity,
  readAccessCaller,
  readableEntities,
} from "../auth/entity-read-access";
import {
  authorizeCaller,
  authorizeCallerForAny,
  isErrorResponse,
  type AuthContext,
} from "../auth/middleware";
import { toNextlyAuthError } from "../auth/middleware/to-nextly-error";
import type { RequestActor } from "../auth/request-actor";
import { container } from "../di/container";
import {
  SYSTEM_READ_POLICY,
  SYSTEM_WRITE_POLICY,
  type RouteGrant,
} from "../domains/auth/system-write-policy";
import { resolveSingleDocumentId } from "../domains/singles/services/single-document-access";
import type { UserContext } from "../domains/singles/types";
import { documentTableOf } from "../domains/workflows/part-versions";
import { registeredWorkflows } from "../domains/workflows/registry";
import {
  assignMany,
  reviewStateOf,
  stepMany,
  waitingFor,
  type ManyRefusal,
} from "../domains/workflows/review-api";
import type { ReviewDocument } from "../domains/workflows/review-state-repository";
import {
  assignWorkflowParts,
  namedParts,
  takeWorkflowStep,
  type Assignment,
  type WorkflowCaller,
} from "../domains/workflows/steps";
import {
  listWorkflowSummaries,
  readWorkflowSettingsView,
  refuseDefinitionKeys,
  updateWorkflowSettings,
  workflowDefinitionOf,
} from "../domains/workflows/workflow-settings-api";
import { NextlyError } from "../errors";
import { getCachedNextly } from "../init";

import { readCaller } from "./authenticated-read";
import {
  privateToSession,
  SKIP_DATE_FORMATTING_HEADER,
  respondBulk,
  respondDoc,
  respondList,
  respondMutation,
} from "./response-shapes";
import { requireRouteAuthentication } from "./route-auth";
import {
  assertVersionDocumentReadable,
  readableHistoryLocales,
} from "./versions-access";
import { withErrorHandler } from "./with-error-handler";
import { nextlyValidationFromZod } from "./zod-to-nextly-error";

/**
 * A document as a request names it: an entry of a collection by its id, or a Single by its slug.
 *
 * @experimental
 */
export type NamedDocument =
  | { collection: string; id: string }
  | { single: string };

/**
 * A document of a move over several that was refused, named as the request named it: a Single by
 * its slug alone, so a refusal (one for a Single the caller may not read included) never tells
 * the caller its stored id.
 *
 * @experimental
 */
export interface NamedRefusal {
  document: NamedDocument;
  code: string;
  message: string;
}

/** A document as review state keys it, named as a request names it. */
const namedDocument = (document: ReviewDocument): NamedDocument =>
  document.scopeKind === "single"
    ? { single: document.scopeSlug }
    : { collection: document.scopeSlug, id: document.entryId };

/** Refusals of a move over several, each document named as the request named it. */
const namedRefusals = (refused: readonly ManyRefusal[]): NamedRefusal[] =>
  refused.map(({ document, code, message }) => ({
    document: namedDocument(document),
    code,
    message,
  }));

/** A document as a request names it: an entry of a collection, or a Single. */
const DocumentRef = z.union([
  z.object({ collection: z.string().min(1), id: z.string().min(1) }).strict(),
  z.object({ single: z.string().min(1) }).strict(),
]);

/** A collection or a Single, by its slug alone. */
const EntityRef = z.union([
  z.object({ collection: z.string().min(1) }).strict(),
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

const SettingsSlug = z.object({ slug: z.string().min(1) }).passthrough();

const Assigned = z
  .object({ kind: z.enum(["user", "role"]), id: z.string().min(1) })
  .strict();

/** A colour as a stage shows it: hex only, so a value reaches a style as a colour and nothing else. */
const Colour = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, {
    message: "A colour is a hex value such as #aa3300.",
  });

const SettingsChangeBody = z
  .object({
    slug: z.string().min(1),
    revision: z.number().int().min(0),
    defaultReviewers: z.record(z.string(), Assigned.nullable()).optional(),
    labels: z
      .record(
        z.string(),
        z
          .object({
            label: z.string().trim().min(1).max(100).nullable().optional(),
            colour: Colour.nullable().optional(),
          })
          .strict()
          .nullable()
      )
      .optional(),
    emails: z
      .object({
        assigned: z.boolean().optional(),
        approved: z.boolean().optional(),
        changesRequested: z.boolean().optional(),
      })
      .strict()
      .optional(),
    grants: z
      .record(z.string(), z.array(z.string().min(1)).max(100))
      .optional(),
  })
  .strict();

/**
 * The shapes a document, a collection or Single, a part and what was seen of it are named in, for
 * another door that parses its own, stricter input from them, so every door names them alike.
 *
 * @experimental
 */
export const workflowInputShapes = { DocumentRef, EntityRef, Part, Seen };

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
  /** The authenticated caller, as the settings permissions are asked of it. */
  auth: AuthContext;
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
    return {
      user,
      scope,
      caller: { kind: "user", userId: auth.userId },
      auth,
    };
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
    auth,
  };
}

/**
 * Refuses the asker unless they hold `grant`, asked of the decision the settings routes ask
 * (`requireAnyPermission`'s for any of several, `requirePermission`'s for one). Trusted code is
 * not asked.
 */
async function assertGrant(
  asker: WorkflowAsker,
  grant: RouteGrant
): Promise<void> {
  if (asker === null) return;
  const decision =
    "anyOf" in grant
      ? await authorizeCallerForAny(asker.auth, [...grant.anyOf], grant.names)
      : await authorizeCaller(asker.auth, grant.action, grant.resource);
  if (isErrorResponse(decision)) throw toNextlyAuthError(decision);
}

/**
 * A workflow's settings are read by whoever may read settings or change them, as a plugin's
 * settings are: a grant of the change alone would otherwise open a page that cannot load.
 */
const SETTINGS_READ: RouteGrant = {
  anyOf: [
    ...SYSTEM_READ_POLICY.settings.read.anyOf,
    ...SYSTEM_WRITE_POLICY.settings.update.anyOf,
  ],
};

/** Who a settings change is recorded as: the person, or the key itself. */
const actorOf = (asker: WorkflowAsker): RequestActor | null => {
  if (asker === null) return null;
  return asker.caller.kind === "key"
    ? { type: "apiKey", id: asker.caller.keyId }
    : { type: "user", id: asker.caller.userId };
};

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

/**
 * Throws not found unless the asker may read the collection or Single `slug` at all, as a read
 * route authorizes before it runs: the first half of every read check here, and the whole of a
 * definition's. Not found rather than forbidden, so a caller who may not read it is not told it
 * exists. Trusted code is not asked.
 */
async function assertEntityReadable(
  asker: WorkflowAsker,
  scopeKind: "collection" | "single",
  scopeSlug: string
): Promise<void> {
  if (asker === null) return;
  const readsEntity = await canReadEntity(
    scopeSlug,
    readAccessCaller({
      user: asker.user,
      ...(asker.scope === undefined ? {} : { authenticatedScope: asker.scope }),
    })
  );
  if (!readsEntity) {
    throw NextlyError.notFound({
      logContext: {
        reason: "workflow-entity-not-readable",
        scopeKind,
        scopeSlug,
      },
    });
  }
}

/**
 * Throws not found unless the asker may read `document` in every part named: first the collection
 * or Single at all, as a read route authorizes before it runs, then the document itself, in each
 * language named. Not found rather than forbidden either way, so a caller who may not read it is
 * not told it exists. A move naming `"all"` is asked of each part it can move (`namedParts`),
 * never of none, so it cannot reach a language its caller may not read. No parts at all is a
 * read of the document, which any language its caller may read it in allows.
 */
async function assertReadable(
  asker: WorkflowAsker,
  document: ReviewDocument,
  parts: "all" | readonly (string | null)[] = []
): Promise<void> {
  if (asker === null) return;
  await assertEntityReadable(asker, document.scopeKind, document.scopeSlug);
  // Each language named is asked about in its own right: one the caller may not read refuses the
  // whole move.
  await assertVersionDocumentReadable(
    document.scopeKind,
    document.scopeSlug,
    document.entryId,
    asker.user,
    asker.scope,
    {},
    parts === "all"
      ? namedParts("all", (await documentTableOf(document)).localized)
      : parts
  );
}

/** Whether the asker may read `document`; refusals other than not found are thrown. */
async function readableBy(
  asker: WorkflowAsker,
  document: ReviewDocument,
  parts: "all" | readonly (string | null)[] = []
): Promise<boolean> {
  try {
    await assertReadable(asker, document, parts);
    return true;
  } catch (error) {
    if (NextlyError.isNotFound(error)) return false;
    throw error;
  }
}

const adapter = () => container.get<DrizzleAdapter>("adapter");

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
  /**
   * A document's review state, part by part, each step marked with whether the caller may take it.
   * With no workflow attached, none and no parts: answered only after the read check, so a missing
   * document, or one the caller may not read, is not found whether or not a workflow is attached.
   */
  async reviewState(asker: WorkflowAsker, input: unknown) {
    const document = await documentOf(parse(DocumentRef, input));
    await assertReadable(asker, document);
    const review = await reviewStateOf(adapter(), document, callerOf(asker));
    if (asker === null || review.workflow === null) return review;
    // Only the parts in a language the caller may read the document in, and the shared part,
    // which the read above allowed: where a language stands, who it waits for and its last move
    // (with its comment) are that language's to tell.
    const languages = await readableHistoryLocales(
      document.scopeKind,
      document.scopeSlug,
      document.entryId,
      asker.user,
      asker.scope
    );
    return {
      ...review,
      parts: review.parts.filter(
        each => each.part === null || languages.has(each.part)
      ),
    };
  },

  /**
   * The definition of the workflow attached to a collection or Single: its stages and steps, none
   * of its settings, and null where none is attached. Asked only of a caller who may read the
   * collection or Single; one who may not, or names one that does not exist, is told it is not
   * found, so the answer does not tell them which.
   */
  async definitionOf(asker: WorkflowAsker, input: unknown) {
    const ref = parse(EntityRef, input);
    const kind = "collection" in ref ? "collection" : "single";
    const slug = "collection" in ref ? ref.collection : ref.single;
    await assertEntityReadable(asker, kind, slug);
    return { workflow: workflowDefinitionOf(kind, slug) };
  },

  /** One step on one document, as the caller saw it. */
  async takeStep(asker: WorkflowAsker, input: unknown) {
    const body = parse(StepBody, input);
    const document = await documentOf(body.document);
    await assertReadable(asker, document, body.parts);
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
    const { moved, refused } = await stepMany(adapter(), {
      documents,
      step: body.step,
      comment: body.comment ?? null,
      caller: callerOf(asker),
      readable: (document, parts) => readableBy(asker, document, parts),
    });
    return { moved, refused: namedRefusals(refused) };
  },

  /** Assignments over several documents, each refusal named. */
  async assignMany(asker: WorkflowAsker, input: unknown) {
    const body = parse(AssignBody, input);
    const { assigned, refused } = await assignMany(adapter(), {
      assignments: await assignmentsOf(asker, body, false),
      caller: callerOf(asker),
      readable: (document, parts) => readableBy(asker, document, parts),
    });
    return { assigned, refused: namedRefusals(refused) };
  },

  /** The registered workflows, each with its stages, steps and attachments. */
  async list(asker: WorkflowAsker) {
    await assertGrant(asker, SETTINGS_READ);
    const items = listWorkflowSummaries();
    return {
      items,
      meta: {
        total: items.length,
        page: 1,
        limit: items.length,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      },
    };
  },

  /** A workflow's settings, as they read now. */
  async readSettings(asker: WorkflowAsker, input: unknown) {
    await assertGrant(asker, SETTINGS_READ);
    const { slug } = parse(SettingsSlug, input);
    return readWorkflowSettingsView(adapter(), slug);
  },

  /**
   * A change to a workflow's settings over the revision the caller read. A change of grants
   * changes what roles hold, so it also asks to update roles, as a role's own permissions do.
   */
  async updateSettings(asker: WorkflowAsker, input: unknown) {
    await assertGrant(asker, SYSTEM_WRITE_POLICY.settings.update);
    // Before the body is parsed, so a part of the definition is named as one, not as an unknown key.
    refuseDefinitionKeys(input);
    const { slug, ...change } = parse(SettingsChangeBody, input);
    if (change.grants !== undefined) {
      await assertGrant(asker, SYSTEM_WRITE_POLICY.roles.setPermissions);
    }
    return updateWorkflowSettings(adapter(), slug, change, actorOf(asker));
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
      // Each item in the language its part names: an item about a language the caller may not
      // read the document in is left out, as a read of that language would be refused.
      readable: (document, part) =>
        readableBy(asker, document, part === null ? [] : [part]),
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

/**
 * A response whose body is configuration, not records: the registered workflows, or a workflow's
 * settings. Marked so its values are answered as they were defined or saved, never rewritten as
 * dates for the reader's timezone (a stage label that reads like a date included), the update's
 * answer as much as the read's, since a settings screen renders the one it gets back.
 */
function configurationResponse(response: Response): Response {
  response.headers.set(SKIP_DATE_FORMATTING_HEADER, "1");
  return response;
}

/** The REST routes, by the method the route parser names. */
const ROUTES: Record<
  string,
  (
    request: Request,
    asker: NonNullable<WorkflowAsker>,
    params: Record<string, string>
  ) => Promise<Response>
> = {
  async listWorkflows(_request, asker) {
    const { items, meta } = await workflowOperations.list(asker);
    return configurationResponse(respondList(items, meta));
  },

  async getWorkflowSettings(_request, asker, params) {
    return configurationResponse(
      respondDoc(
        await workflowOperations.readSettings(asker, { slug: params.slug })
      )
    );
  },

  async updateWorkflowSettings(request, asker, params) {
    const body: unknown = await request.json();
    return configurationResponse(
      respondMutation(
        "Workflow settings saved.",
        await workflowOperations.updateSettings(
          asker,
          // The slug the path names, over any the body names.
          typeof body === "object" && body !== null && !Array.isArray(body)
            ? { ...body, slug: params.slug }
            : body
        )
      )
    );
  },

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
      refused.map(({ document, code, message }) =>
        "single" in document
          ? { single: document.single, code, message }
          : { id: document.id, code, message }
      )
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
      refused.map(({ document, code, message }) =>
        "single" in document
          ? { single: document.single, code, message }
          : { id: document.id, code, message }
      )
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
    async (
      request: Request,
      method: string,
      params: Record<string, string> = {}
    ): Promise<Response> => {
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
      return route(request, asker, params);
    }
  )
);
