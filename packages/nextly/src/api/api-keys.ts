/**
 * API Key REST Handler Functions
 *
 * Named handler functions for the five API key endpoints. Each handler owns
 * its full auth + validation + service-call cycle:
 *
 *   requirePermission("update", "api-keys")  to  update-api-keys system permission
 *   authMethod !== "session" guard           to  create / update / revoke are session-only
 *
 * These functions are called by the main route handler when it detects
 * `service === "apiKeys"` in the parsed route.
 *
 * The list endpoint is not server-paginated (callers receive every key
 * they are allowed to see in one page). To stay on the canonical
 * `respondList` envelope we ship a single-page synthetic meta whose
 * `total` matches the array length. The session-only 403 surface uses
 * the canonical "You don't have permission to perform this action."
 * message per spec §13.8; the session-only reason lives in `logContext`.
 *
 * @module api/api-keys
 * @since 1.0.0
 */

import { z } from "zod";

import { isErrorResponse, requireAnyPermission } from "../auth/middleware";
import { toNextlyAuthError } from "../auth/middleware/to-nextly-error";
import { container } from "../di";
import {
  apiKeyPermissionsFor,
  type ApiKeyOperation,
} from "../domains/auth/api-key-policy";
import {
  apiKeyViewer,
  type ApiKeyService,
} from "../domains/auth/services/api-key-service";
import { NextlyError } from "../errors/nextly-error";
import { getCachedNextly } from "../init";
import {
  ApiKeyTokenTypeSchema,
  CreateApiKeySchema,
  UpdateApiKeySchema,
} from "../schemas/_zod/api-keys";

import { readJsonBody } from "./read-json-body";
import {
  privateToSession,
  respondAction,
  respondDoc,
  respondList,
  respondMutation,
} from "./response-shapes";
import { withErrorHandler } from "./with-error-handler";
import { nextlyValidationFromZod } from "./zod-to-nextly-error";

async function getApiKeyService(): Promise<ApiKeyService> {
  await getCachedNextly();
  return container.get<ApiKeyService>("apiKeyService");
}

async function requireApiKeyPermission(req: Request, action: ApiKeyOperation) {
  // The policy is declared once, in `domains/auth/api-key-policy`, because the
  // admin's route guards and controls gate on the same question and drifted
  // from it before.
  return requireAnyPermission(req, apiKeyPermissionsFor(action));
}

/**
 * Throw the canonical FORBIDDEN error for session-only operations. Per spec
 * §13.8 every 403 across the API ships the same canonical sentence; the
 * session-only reason and the attempted action live in `logContext` for
 * operator triage.
 */
function denySessionOnly(action: "create" | "update" | "delete"): never {
  throw NextlyError.forbidden({
    logContext: { reason: "session-only", action },
  });
}

/**
 * The signed-in person allowed to create keys. Creating a key and asking
 * what one would do are guarded alike, so a caller refused one is refused the
 * other: a key asking is refused as session-only.
 */
async function requireKeyCreator(req: Request) {
  const authResult = await requireApiKeyPermission(req, "create");
  if (isErrorResponse(authResult)) throw toNextlyAuthError(authResult);
  if (authResult.authMethod !== "session") denySessionOnly("create");
  return authResult;
}

/**
 * List API keys.
 *
 * Anyone who may read keys sees every key (`allUsers: true`). A key's owner
 * is shown only to a caller who may also read users, and a person always on
 * their own keys (`apiKeyViewer`). The secret itself is never listed: a key
 * shows only its prefix after it is created.
 *
 * Auth: session or API key + `read-api-keys` (or `update-api-keys`).
 *
 * Response: `{ items: ApiKeyMeta[], meta: PaginationMeta }`. The list is
 * not server-paginated (callers see every key they're allowed to read);
 * meta is a single-page synthetic envelope so the wire format matches
 * `respondList` for every list endpoint.
 */
export const listApiKeys = privateToSession(
  withErrorHandler(async (req: Request): Promise<Response> => {
    const authResult = await requireApiKeyPermission(req, "read");
    if (isErrorResponse(authResult)) throw toNextlyAuthError(authResult);

    const service = await getApiKeyService();
    const see = await apiKeyViewer(authResult);
    const keys = (
      await service.listApiKeys(authResult.userId, { allUsers: true })
    ).map(see);

    // Synthetic single-page meta keeps the canonical list shape even though
    // the underlying service does not paginate.
    return respondList(keys, {
      total: keys.length,
      page: 1,
      limit: keys.length,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
    });
  })
);

/**
 * Fetch a single API key by ID.
 *
 * Any key, as the list shows it to this caller (`apiKeyViewer`); a key that
 * does not exist is 404.
 *
 * Auth: session or API key + `read-api-keys` (or `update-api-keys`).
 *
 * Response: bare `ApiKeyMeta` document body via `respondDoc`.
 */
export function getApiKeyById(req: Request, id: string): Promise<Response> {
  return privateToSession(
    withErrorHandler(async (request: Request) => {
      const authResult = await requireApiKeyPermission(request, "read");
      if (isErrorResponse(authResult)) throw toNextlyAuthError(authResult);

      const service = await getApiKeyService();
      const key = await service.getApiKeyById(id, authResult.userId, {
        allUsers: true,
      });

      if (!key) {
        // Per §13.7 the public message stays "Not found.".
        throw NextlyError.notFound({
          logContext: { entity: "api-key", id, callerId: authResult.userId },
        });
      }

      return respondDoc((await apiKeyViewer(authResult))(key));
    })
  )(req);
}

/**
 * Create a new API key for the authenticated session user.
 *
 * Session-only; cannot be called via an API key to prevent privilege
 * escalation. The raw key is returned exactly once in this response; it
 * is never stored and cannot be retrieved again.
 *
 * Auth: **session only** + `update-api-keys` permission.
 *
 * Response: `{ message, item: { doc: ApiKeyMeta, key: string } }` via
 * `respondMutation`. `key` is the one-time raw secret; status 201.
 */
/**
 * The query a key summary is asked with: the type and role the form has
 * chosen. Only their shapes are checked here; whether the two belong together,
 * and whether the role is within its creator's, is the service's question, so
 * a summary is refused exactly as creating that key would be.
 */
const ApiKeyAbilitiesQuerySchema = z.object({
  tokenType: ApiKeyTokenTypeSchema,
  roleId: z.string().min(1).optional(),
});

/**
 * What a key the caller creates now, of this type and role, would be able to
 * do: the summary the key form shows before creation.
 *
 * `GET /api/api-keys/abilities?tokenType=…&roleId=…`
 *
 * Answered by the resolution a key's own requests use, so the summary is the
 * permissions the key gets. An access rule written in code for a collection
 * or Single can still refuse a request they allow, and may depend on the
 * entry, so it is not judged here.
 *
 * Session-only and behind the permission to create keys, as
 * creation is: a summary is that creation's preview, and a key asking it
 * about another key is refused.
 *
 * Its two 403s carry different codes, as creation's do: `FORBIDDEN` for a
 * caller who may not create keys (that is asked first), and
 * `API_KEY_ROLE_ABOVE_CREATOR` for a role that allows more than its creator,
 * so the form can say which.
 *
 * Response: `{ items: { slug, action, resource }[], meta }`.
 * Private to the session that asked, refusals included, since it describes
 * that person's own grants.
 *
 * @experimental The key form's summary; its shape may change while that
 * screen does.
 */
export const getApiKeyAbilities = privateToSession(
  withErrorHandler(async (req: Request): Promise<Response> => {
    const authResult = await requireKeyCreator(req);

    const params = new URL(req.url).searchParams;
    let query: z.infer<typeof ApiKeyAbilitiesQuerySchema>;
    try {
      query = ApiKeyAbilitiesQuerySchema.parse({
        tokenType: params.get("tokenType") ?? undefined,
        roleId: params.get("roleId") ?? undefined,
      });
    } catch (err) {
      if (err instanceof z.ZodError) throw nextlyValidationFromZod(err);
      throw err;
    }

    const service = await getApiKeyService();
    const grants = await service.previewApiKeyGrants(authResult.userId, query);
    const items = grants.map(({ slug, action, resource }) => ({
      slug,
      action,
      resource,
    }));

    return respondList(items, {
      total: items.length,
      page: 1,
      limit: items.length,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
    });
  })
);

export const createApiKey = withErrorHandler(
  async (req: Request): Promise<Response> => {
    const authResult = await requireKeyCreator(req);

    const body = await readJsonBody(req);

    let validated: z.infer<typeof CreateApiKeySchema>;
    try {
      validated = CreateApiKeySchema.parse(body);
    } catch (err) {
      if (err instanceof z.ZodError) throw nextlyValidationFromZod(err);
      throw err;
    }

    const service = await getApiKeyService();
    const { meta, key } = await service.createApiKey(
      authResult.userId,
      validated
    );

    // The composite `{ doc, key }` payload is the mutation `item` so the
    // one-time raw secret stays adjacent to its metadata.
    return respondMutation(
      "API key created.",
      { doc: meta, key },
      { status: 201 }
    );
  }
);

/**
 * Update an existing API key's name or description.
 *
 * Token type, role, and duration are immutable; revoke and recreate to
 * change them. Any key, the caller's or anyone else's: the permission to
 * update keys is the permission to update every key.
 *
 * Session-only; cannot be called via an API key.
 *
 * Auth: **session only** + `update-api-keys` permission.
 *
 * Response: `{ message, item: ApiKeyMeta }` via `respondMutation`.
 */
export function updateApiKey(req: Request, id: string): Promise<Response> {
  return withErrorHandler(async (request: Request) => {
    const authResult = await requireApiKeyPermission(request, "update");
    if (isErrorResponse(authResult)) throw toNextlyAuthError(authResult);

    if (authResult.authMethod !== "session") denySessionOnly("update");

    const body = await readJsonBody(request);

    let validated: z.infer<typeof UpdateApiKeySchema>;
    try {
      validated = UpdateApiKeySchema.parse(body);
    } catch (err) {
      if (err instanceof z.ZodError) throw nextlyValidationFromZod(err);
      throw err;
    }

    const service = await getApiKeyService();
    const updated = await service.updateApiKey(
      id,
      authResult.userId,
      validated,
      { allUsers: true }
    );

    // Answered as the list shows this caller the key, owner included.
    return respondMutation(
      "API key updated.",
      (await apiKeyViewer(authResult))(updated)
    );
  })(req);
}

/**
 * Revoke (soft-delete) an API key.
 *
 * Sets `isActive = false` on the key. The row is preserved for audit trail
 * purposes. Any key, the caller's or anyone else's: the permission to
 * revoke keys is the permission to revoke every key.
 *
 * Session-only; cannot be called via an API key.
 *
 * Auth: **session only** + `delete-api-keys` (or `update-api-keys`).
 *
 * Response: `{ message, id }` via `respondAction`. Revoke is non-CRUD
 * (the row is preserved with `isActive = false`), so the action shape
 * applies rather than `respondMutation`.
 */
export function revokeApiKey(req: Request, id: string): Promise<Response> {
  return withErrorHandler(async (request: Request) => {
    const authResult = await requireApiKeyPermission(request, "delete");
    if (isErrorResponse(authResult)) throw toNextlyAuthError(authResult);

    if (authResult.authMethod !== "session") denySessionOnly("delete");

    const service = await getApiKeyService();
    await service.revokeApiKey(id, authResult.userId, { allUsers: true });

    // Revocation is a state transition rather than a row mutation; surface
    // the affected id alongside the toast.
    return respondAction("API key revoked.", { id });
  })(req);
}
