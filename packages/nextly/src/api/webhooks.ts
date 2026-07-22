/**
 * Webhook endpoint REST handler functions.
 *
 * Named handlers for the six webhook endpoints. Each owns its full auth +
 * validation + service-call cycle, and the main route handler calls them when
 * it detects `service === "webhooks"` in the parsed route.
 *
 * Endpoints are global rather than per-user: `created_by` is
 * `onDelete: "set null"` attribution, not ownership, so there is no
 * owner-scoped filtering here and no super-admin widening. A caller who may
 * read webhooks may read all of them.
 *
 * Mutations are session-only. Registering an endpoint is both an SSRF
 * primitive (it names a URL the server will call) and an exfiltration
 * primitive (it names a URL the server will send content to), so it is not
 * something an API key should be able to do on its holder's behalf.
 *
 * Revealing a signing secret is treated as a write for the same reason it is a
 * separate service method: the secret is what proves a request came from this
 * install, so it requires the update permission rather than read. A read-only
 * role that could read secrets could forge traffic every receiver would trust.
 *
 * The list endpoint is not server-paginated, so it ships the same synthetic
 * single-page meta `api-keys` uses to stay on the canonical `respondList`
 * envelope.
 *
 * @module api/webhooks
 */

import { createHash, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { isErrorResponse, requireAnyPermission } from "../auth/middleware";
import { toNextlyAuthError } from "../auth/middleware/to-nextly-error";
import { container } from "../di";
import { offsetPaginationToMeta } from "../dispatcher/helpers/service-envelope";
import {
  runWebhookDrain,
  type WebhookDrainDatabase,
} from "../domains/webhooks/drain-runner";
import type { WebhookEndpointRegistry } from "../domains/webhooks/endpoint-registry";
import type { WebhookDeliveryQueryService } from "../domains/webhooks/services/webhook-delivery-query-service";
import type { WebhookEndpointService } from "../domains/webhooks/services/webhook-endpoint-service";
import { NextlyError } from "../errors/nextly-error";
import { getCachedNextly } from "../init";
import {
  CreateWebhookSchema,
  UpdateWebhookSchema,
} from "../schemas/_zod/webhooks";
import { SKIP_TIMEZONE_FORMAT_HEADER } from "../shared/lib/date-formatting";
import { env } from "../shared/lib/env";

import { readJsonBody } from "./read-json-body";
import {
  respondAction,
  respondData,
  respondDoc,
  respondList,
  respondMutation,
} from "./response-shapes";
import { withErrorHandler } from "./with-error-handler";
import { nextlyValidationFromZod } from "./zod-to-nextly-error";

/**
 * Applied to the secret response so it is never retained by a browser or a
 * shared intermediary that caches authenticated GETs. Matches the header set
 * the other secret-bearing reads in this package use.
 */
const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
} as const;

async function getWebhookService(): Promise<WebhookEndpointService> {
  await getCachedNextly();
  return container.get<WebhookEndpointService>("webhookEndpointService");
}

async function getWebhookDeliveryService(): Promise<WebhookDeliveryQueryService> {
  await getCachedNextly();
  return container.get<WebhookDeliveryQueryService>(
    "webhookDeliveryQueryService"
  );
}

/** Delivery statuses a caller may filter on; matches the drain's vocabulary. */
const DELIVERY_STATUSES = [
  "pending",
  "processing",
  "delivered",
  "retrying",
  "failed",
] as const;

/**
 * Query parameters for the delivery list. `page`/`limit` are coerced and
 * bounded (a huge limit would let one request read the whole ledger); an
 * unknown `status` is a client mistake rather than an empty result, so it is
 * rejected. `eventType` is passed through — an unknown type simply matches
 * nothing.
 */
const ListDeliveriesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).catch(1),
  limit: z.coerce.number().int().min(1).max(100).catch(20),
  status: z.enum(DELIVERY_STATUSES).optional(),
  eventType: z.string().min(1).max(100).optional(),
});

/**
 * `update` is accepted for every action, matching how `api-keys` treats its
 * update permission as the de-facto umbrella now that the explicit `manage-*`
 * entry has been removed.
 */
async function requireWebhookPermission(
  req: Request,
  action: "create" | "read" | "update" | "delete"
) {
  return requireAnyPermission(req, [
    { action, resource: "webhooks" },
    { action: "update", resource: "webhooks" },
  ]);
}

/**
 * Throw the canonical FORBIDDEN error for session-only operations. Every 403
 * across the API ships the same sentence; the reason and the attempted action
 * live in `logContext` for operator triage.
 */
function denySessionOnly(
  action: "create" | "update" | "delete" | "reveal"
): never {
  throw NextlyError.forbidden({
    logContext: { reason: "session-only", action },
  });
}

/** The bearer token on the request, or null when there is no bearer header. */
function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token : null;
}

/**
 * Constant-time string compare. Both sides are hashed to a fixed length first so
 * `timingSafeEqual` never throws on a length mismatch and the comparison leaks
 * neither the secret's length nor its content through timing.
 */
function constantTimeEqual(a: string, b: string): boolean {
  const ah = createHash("sha256").update(a).digest();
  const bh = createHash("sha256").update(b).digest();
  return timingSafeEqual(ah, bh);
}

/**
 * Authorize a drain trigger. The cron path matches the shared drain secret
 * presented as a bearer token (Vercel Cron sends `Authorization: Bearer
 * <CRON_SECRET>`); constant-time so it leaks nothing. Anything else must be an
 * authenticated caller able to manage webhooks — a non-matching bearer simply
 * falls through to be tried as an API key by the permission check.
 */
async function authorizeDrain(request: Request): Promise<void> {
  const presented = bearerToken(request);
  if (presented) {
    // A scheduler presents a shared secret as a bearer token — either Nextly's
    // NEXTLY_DRAIN_SECRET or Vercel Cron's CRON_SECRET (what Vercel actually
    // sends). Constant-time against each configured value.
    for (const secret of [env.NEXTLY_DRAIN_SECRET, env.CRON_SECRET]) {
      if (secret && constantTimeEqual(presented, secret)) return;
    }
  }
  const authResult = await requireWebhookPermission(request, "update");
  if (isErrorResponse(authResult)) throw toNextlyAuthError(authResult);
}

/**
 * Run one webhook drain: fan out due events into deliveries and attempt the due
 * deliveries. Idempotent and safe to call repeatedly — a scheduler (e.g. Vercel
 * Cron, which triggers with a GET) hits this on an interval; retries are
 * advanced on later calls. Accepts GET or POST.
 *
 * Auth: a shared `NEXTLY_DRAIN_SECRET` or Vercel's `CRON_SECRET` (bearer,
 * constant-time) OR an authenticated admin/API-key caller with
 * `update-webhooks`. Not session-only: a scheduler has no session.
 *
 * Response: the canonical mutation envelope `{ message, item }`, where `item` is
 * the drain summary (rounds, events processed, deliveries created,
 * attempted/delivered/retried/failed).
 */
export const drainWebhooks = withErrorHandler(
  async (request: Request): Promise<Response> => {
    await authorizeDrain(request);

    await getCachedNextly();
    // The runtime adapter satisfies the fan-out + delivery database surfaces;
    // resolve it as exactly that from the container.
    const adapter = container.get<WebhookDrainDatabase>("adapter");
    const registry = container.get<WebhookEndpointRegistry>(
      "webhookEndpointRegistry"
    );

    const result = await runWebhookDrain(adapter, registry);
    // A POST/GET trigger with fan-out + delivery side effects: return the
    // canonical mutation envelope with the drain summary as the item.
    return respondMutation("Webhook drain completed.", result);
  }
);

/**
 * List every registered webhook endpoint.
 *
 * Auth: session or API key + `read-webhooks` (or `update-webhooks`).
 *
 * Response: `{ items: WebhookEndpointSummary[], meta: PaginationMeta }`. No
 * summary carries a secret or its ciphertext.
 */
export const listWebhooks = withErrorHandler(
  async (req: Request): Promise<Response> => {
    const authResult = await requireWebhookPermission(req, "read");
    if (isErrorResponse(authResult)) throw toNextlyAuthError(authResult);

    const service = await getWebhookService();
    const endpoints = await service.listEndpoints();

    // Synthetic single-page meta keeps the canonical list shape even though
    // the underlying service does not paginate.
    return respondList(endpoints, {
      total: endpoints.length,
      page: 1,
      limit: endpoints.length,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
    });
  }
);

/**
 * Fetch a single webhook endpoint by id.
 *
 * Auth: session or API key + `read-webhooks` (or `update-webhooks`).
 *
 * Response: bare `WebhookEndpointSummary` document body via `respondDoc`.
 */
export function getWebhookById(req: Request, id: string): Promise<Response> {
  return withErrorHandler(async (request: Request) => {
    const authResult = await requireWebhookPermission(request, "read");
    if (isErrorResponse(authResult)) throw toNextlyAuthError(authResult);

    const service = await getWebhookService();
    const endpoint = await service.getEndpoint(id);

    if (!endpoint) {
      throw NextlyError.notFound({
        logContext: { entity: "webhook-endpoint", id },
      });
    }

    return respondDoc(endpoint);
  })(req);
}

/**
 * List an endpoint's deliveries, newest first, with paging and optional
 * status/event-type filters.
 *
 * Auth: session or API key + `read-webhooks` (or `update-webhooks`).
 *
 * Scoped by webhook id alone, so deliveries remain readable after an endpoint
 * is retired (its history is kept deliberately). A delivery row carries no
 * credential, so this is a plain read.
 *
 * Response: `{ items: WebhookDeliverySummary[], meta: PaginationMeta }`.
 */
export function listWebhookDeliveries(
  req: Request,
  webhookId: string
): Promise<Response> {
  return withErrorHandler(async (request: Request) => {
    const authResult = await requireWebhookPermission(request, "read");
    if (isErrorResponse(authResult)) throw toNextlyAuthError(authResult);

    const url = new URL(request.url);
    const parsed = ListDeliveriesQuerySchema.safeParse({
      page: url.searchParams.get("page") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      eventType: url.searchParams.get("eventType") ?? undefined,
    });
    if (!parsed.success) throw nextlyValidationFromZod(parsed.error);
    const { page, limit, status, eventType } = parsed.data;

    const service = await getWebhookDeliveryService();
    const { items, total } = await service.listDeliveries(webhookId, {
      page,
      limit,
      status,
      eventType,
    });

    // Opt this response out of timezone rewriting: a delivery's lastError and
    // response snippet are opaque captured text that must survive verbatim.
    return respondList(
      items,
      offsetPaginationToMeta({ total, limit, offset: (page - 1) * limit }),
      { headers: { [SKIP_TIMEZONE_FORMAT_HEADER]: "1" } }
    );
  })(req);
}

/**
 * Fetch one delivery (with its attempt history and response snippet) for an
 * endpoint.
 *
 * Auth: session or API key + `read-webhooks` (or `update-webhooks`).
 *
 * Response: bare `WebhookDeliveryDetail` via `respondDoc`. 404 when no delivery
 * with this id belongs to this endpoint.
 */
export function getWebhookDelivery(
  req: Request,
  webhookId: string,
  deliveryId: string
): Promise<Response> {
  return withErrorHandler(async (request: Request) => {
    const authResult = await requireWebhookPermission(request, "read");
    if (isErrorResponse(authResult)) throw toNextlyAuthError(authResult);

    const service = await getWebhookDeliveryService();
    const delivery = await service.getDelivery(webhookId, deliveryId);

    if (!delivery) {
      throw NextlyError.notFound({
        logContext: { entity: "webhook-delivery", webhookId, deliveryId },
      });
    }

    // Opt out of timezone rewriting so the raw response snippet and attempt
    // errors are returned exactly as the receiver sent them.
    return respondDoc(delivery, {
      headers: { [SKIP_TIMEZONE_FORMAT_HEADER]: "1" },
    });
  })(req);
}

/**
 * Register a webhook endpoint.
 *
 * The URL is resolved and checked by the service before it is stored, so a
 * private, loopback or cloud-metadata target is refused here rather than
 * failing silently on every later delivery.
 *
 * Auth: **session only** + `create-webhooks` (or `update-webhooks`).
 *
 * Response: `{ message, item: { doc: WebhookEndpointSummary, secret } }` via
 * `respondMutation`, status 201. The secret is returned here so it can be
 * copied into the receiver; it remains retrievable afterwards through the
 * secret endpoint.
 */
export const createWebhook = withErrorHandler(
  async (req: Request): Promise<Response> => {
    const authResult = await requireWebhookPermission(req, "create");
    if (isErrorResponse(authResult)) throw toNextlyAuthError(authResult);

    if (authResult.authMethod !== "session") denySessionOnly("create");

    const body = await readJsonBody(req);

    let validated: z.infer<typeof CreateWebhookSchema>;
    try {
      validated = CreateWebhookSchema.parse(body);
    } catch (err) {
      if (err instanceof z.ZodError) throw nextlyValidationFromZod(err);
      throw err;
    }

    const service = await getWebhookService();
    const { endpoint, secret } = await service.createEndpoint(
      validated,
      authResult.userId
    );

    return respondMutation(
      "Webhook endpoint created.",
      { doc: endpoint, secret },
      { status: 201 }
    );
  }
);

/**
 * Change a webhook endpoint. Only the named fields move.
 *
 * A URL is re-validated on the way in, since an update is how an endpoint that
 * passed at registration would be re-pointed. Setting `enabled` to false also
 * ends the endpoint's outstanding deliveries, which is why disabling does not
 * need its own route.
 *
 * Auth: **session only** + `update-webhooks`.
 *
 * Response: `{ message, item: WebhookEndpointSummary }` via `respondMutation`.
 */
export function updateWebhook(req: Request, id: string): Promise<Response> {
  return withErrorHandler(async (request: Request) => {
    const authResult = await requireWebhookPermission(request, "update");
    if (isErrorResponse(authResult)) throw toNextlyAuthError(authResult);

    if (authResult.authMethod !== "session") denySessionOnly("update");

    const body = await readJsonBody(request);

    let validated: z.infer<typeof UpdateWebhookSchema>;
    try {
      validated = UpdateWebhookSchema.parse(body);
    } catch (err) {
      if (err instanceof z.ZodError) throw nextlyValidationFromZod(err);
      throw err;
    }

    const service = await getWebhookService();
    const updated = await service.updateEndpoint(id, validated);

    return respondMutation("Webhook endpoint updated.", updated);
  })(req);
}

/**
 * Remove a webhook endpoint.
 *
 * This also discards its delivery history, because the delivery table's
 * webhook foreign key cascades. Disabling is the reversible option and the one
 * to reach for when the record of what was sent still matters.
 *
 * Auth: **session only** + `delete-webhooks` (or `update-webhooks`).
 *
 * Response: `{ message, id }` via `respondAction`. Deletion returns no
 * document, so the action shape applies rather than `respondMutation`.
 */
export function deleteWebhook(req: Request, id: string): Promise<Response> {
  return withErrorHandler(async (request: Request) => {
    const authResult = await requireWebhookPermission(request, "delete");
    if (isErrorResponse(authResult)) throw toNextlyAuthError(authResult);

    if (authResult.authMethod !== "session") denySessionOnly("delete");

    const service = await getWebhookService();
    await service.deleteEndpoint(id);

    return respondAction("Webhook endpoint deleted.", { id });
  })(req);
}

/**
 * Reveal an endpoint's active signing secrets.
 *
 * Separate from every other read so it can carry a stronger requirement: this
 * asks for `update` rather than `read`, because the secret is what proves a
 * request came from this install. More than one secret can be active at once
 * during a rotation, and a caller reconciling their configuration needs to see
 * all of them.
 *
 * Auth: **session only** + `update-webhooks`.
 *
 * Response: `{ secrets: string[] }` via `respondData`.
 */
export function revealWebhookSecret(
  req: Request,
  id: string
): Promise<Response> {
  return withErrorHandler(async (request: Request) => {
    // Deliberately not `requireWebhookPermission`, which would also accept the
    // read permission for a read action. Reading a signing secret is a
    // privileged act and must not come with a read-only role.
    const authResult = await requireAnyPermission(request, [
      { action: "update", resource: "webhooks" },
    ]);
    if (isErrorResponse(authResult)) throw toNextlyAuthError(authResult);

    if (authResult.authMethod !== "session") denySessionOnly("reveal");

    const service = await getWebhookService();
    const secrets = await service.revealSecrets(id);

    return respondData({ secrets }, { headers: PRIVATE_NO_STORE_HEADERS });
  })(req);
}
