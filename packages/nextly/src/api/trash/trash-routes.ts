/**
 * The trash over REST, each route asked of the same checks the Direct API
 * makes (`domains/trash/trash-service`):
 *
 * - `GET /trash?collection=&limit=&page=`: a page of the deleted entries the
 *   caller may see, newest first, as `{ items, meta }`.
 * - `POST /trash/restore` with `{ id, collection? }` or `{ trashId }`, and
 *   `values` for new unique values: the entry back as it was. Where a value
 *   it held is taken, nothing is written, and the answer is `restored: false`
 *   with the values to choose again, rather than a failure.
 * - `POST /trash/empty` with `{ collection?, ids? }`: entries removed for
 *   good.
 *
 * This handler authenticates and resolves who is asking; the service decides
 * access.
 *
 * @experimental
 * @module api/trash/trash-routes
 */
import { z } from "zod";

import {
  apiKeyScopeFrom,
  type AuthenticatedScope,
} from "../../auth/authenticated-scope";
import { actorFromAuthContext } from "../../auth/request-actor";
import { buildUserContext } from "../../auth/user-context";
import {
  emptyTrashFor,
  listTrashFor,
  restoreFor,
  type TrashCaller,
} from "../../domains/trash/trash-service";
import { getCachedNextly } from "../../init";
import { resolveRoleSlugs } from "../../services/lib/permissions";
import { readJsonBody } from "../read-json-body";
import {
  privateToSession,
  respondAction,
  respondList,
} from "../response-shapes";
import { requireRouteAuthentication } from "../route-auth";
import { withErrorHandler } from "../with-error-handler";
import { nextlyValidationFromZod } from "../zod-to-nextly-error";

import { paginationMetaOf } from "./trash-page";

const ListQuery = z.object({
  collection: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).optional(),
});

const RestoreBody = z
  .object({
    id: z.string().min(1).optional(),
    collection: z.string().min(1).optional(),
    trashId: z.string().min(1).optional(),
    values: z.record(z.string(), z.unknown()).optional(),
  })
  .refine(body => (body.id === undefined) !== (body.trashId === undefined), {
    message: "Name the entry by `id`, or its trash record by `trashId`.",
  });

const EmptyBody = z.object({
  collection: z.string().min(1).optional(),
  ids: z.array(z.string().min(1)).max(1000).optional(),
});

/** `input` parsed by `schema`, or the one validation refusal. */
function parsed<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw nextlyValidationFromZod(result.error);
}

/** Who is asking, resolved as every read resolves its caller. */
async function callerOf(request: Request): Promise<TrashCaller> {
  // Authenticated first: the route handler registers services on a cold
  // worker only for a request that carries credentials.
  const auth = await requireRouteAuthentication(request);
  await getCachedNextly();
  // Role slugs, so a code-defined rule judges the caller it would on any
  // other read; an API key is judged by its own scope.
  const roles = await resolveRoleSlugs(auth);
  const scope: AuthenticatedScope | undefined =
    auth.authMethod === "api-key" ? apiKeyScopeFrom(auth) : undefined;
  return {
    user: buildUserContext({
      claims: auth.claims,
      id: auth.userId,
      name: auth.userName,
      email: auth.userEmail,
      roles,
    }),
    ...(scope === undefined ? {} : { authenticatedScope: scope }),
    actor: actorFromAuthContext(auth),
  };
}

/** The body, as JSON; an empty body is no options. */
async function bodyOf(request: Request): Promise<unknown> {
  const text = await request.clone().text();
  if (text.trim() === "") return {};
  return readJsonBody(request, { route: "trash" });
}

// Private to the session, refusals included: what is visible depends on who
// asks, so a shared cache must not replay one caller's answer to another.
export const listTrashRoute = privateToSession(
  withErrorHandler(async (request: Request): Promise<Response> => {
    const caller = await callerOf(request);
    const query = parsed(
      ListQuery,
      Object.fromEntries(new URL(request.url).searchParams)
    );
    const page = await listTrashFor(caller, query);
    return respondList(page.items, paginationMetaOf(page));
  })
);

export const restoreFromTrashRoute = privateToSession(
  withErrorHandler(async (request: Request): Promise<Response> => {
    const caller = await callerOf(request);
    const body = parsed(RestoreBody, await bodyOf(request));
    const result = await restoreFor(
      caller,
      body.trashId !== undefined
        ? { trashId: body.trashId }
        : {
            itemId: String(body.id),
            ...(body.collection === undefined
              ? {}
              : { collection: body.collection }),
          },
      body.values
    );
    if (!result.restored) {
      return respondAction(
        "A value this entry held has been taken by another entry since it was deleted. Choose a new one and restore it again.",
        { restored: false, conflicts: result.conflicts }
      );
    }
    return respondAction(
      "Restored from the trash, as a draft where it had been published.",
      {
        restored: true,
        collection: result.collection,
        id: result.id,
      }
    );
  })
);

export const emptyTrashRoute = privateToSession(
  withErrorHandler(async (request: Request): Promise<Response> => {
    const caller = await callerOf(request);
    const body = parsed(EmptyBody, await bodyOf(request));
    const removed = await emptyTrashFor(caller, body);
    return respondAction(
      removed.length === 1
        ? "1 entry removed for good."
        : `${removed.length} entries removed for good.`,
      { removed: removed.length, ids: removed.map(item => item.id) }
    );
  })
);
