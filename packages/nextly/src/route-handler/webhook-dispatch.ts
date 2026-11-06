/**
 * Webhook routes: a parsed operation's method name to its handler.
 *
 * Its own module so the table can be read, and tested, apart from the request
 * path around it. The handlers own their auth and body parsing, so this only
 * maps the method name.
 *
 * @module route-handler/webhook-dispatch
 */
import {
  listWebhooks,
  listWebhookEventTypes,
  getWebhookById,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  revealWebhookSecret,
  rotateWebhookSecret,
  expireWebhookOldSecrets,
  listWebhookDeliveries,
  getWebhookDelivery,
  testWebhookEndpoint,
  redeliverWebhookDelivery,
  drainWebhooks,
} from "../api/webhooks";

/** A webhook operation's handler, given the ids the route parsed. */
type WebhookRouteHandler = (
  req: Request,
  webhookId: string,
  deliveryId: string
) => Promise<Response>;

/**
 * Each parsed webhook operation's handler, by method name. A table rather than
 * a switch, so a new route is one entry here and one in the parser.
 */
const WEBHOOK_HANDLERS: Readonly<Record<string, WebhookRouteHandler>> = {
  listWebhooks: req => listWebhooks(req),
  listWebhookEventTypes: req => listWebhookEventTypes(req),
  getWebhookById: (req, id) => getWebhookById(req, id),
  createWebhook: req => createWebhook(req),
  updateWebhook: (req, id) => updateWebhook(req, id),
  deleteWebhook: (req, id) => deleteWebhook(req, id),
  revealWebhookSecret: (req, id) => revealWebhookSecret(req, id),
  rotateWebhookSecret: (req, id) => rotateWebhookSecret(req, id),
  expireWebhookOldSecrets: (req, id) => expireWebhookOldSecrets(req, id),
  listWebhookDeliveries: (req, id) => listWebhookDeliveries(req, id),
  getWebhookDelivery: (req, id, deliveryId) =>
    getWebhookDelivery(req, id, deliveryId),
  testWebhookEndpoint: (req, id) => testWebhookEndpoint(req, id),
  redeliverWebhookDelivery: (req, id, deliveryId) =>
    redeliverWebhookDelivery(req, id, deliveryId),
  drainWebhooks: req => drainWebhooks(req),
};

/**
 * Route a parsed webhook operation to its handler.
 *
 * Mirrors the API-key dispatch: the handlers own their own auth and body
 * parsing, so this only maps the method name. Looked up as an own property, so
 * a name such as `constructor` reaches no handler.
 */
export async function handleWebhookRequest(
  req: Request,
  method: string,
  routeParams: Record<string, string> | undefined
): Promise<Response> {
  const handler = Object.hasOwn(WEBHOOK_HANDLERS, method)
    ? WEBHOOK_HANDLERS[method]
    : undefined;
  if (handler === undefined) {
    return new Response(
      JSON.stringify({ error: "Unknown webhook operation" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }
  return handler(
    req,
    routeParams?.webhookId ?? "",
    routeParams?.deliveryId ?? ""
  );
}
