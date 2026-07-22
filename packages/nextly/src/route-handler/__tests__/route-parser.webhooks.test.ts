/**
 * Webhook endpoint routes.
 *
 * The reveal-secret route is the one worth pinning: it nests under the endpoint
 * so it can require a stronger permission than reading the endpoint itself, and
 * an unmatched sub-path must NOT fall through to the endpoint route. Falling
 * through would serve the endpoint document at a URL that asked for something
 * else.
 */
import { describe, it, expect } from "vitest";

import { parseRestRoute } from "../route-parser";

describe("webhook routes", () => {
  it("parses the endpoint list", () => {
    expect(parseRestRoute(["webhooks"], "GET")).toMatchObject({
      service: "webhooks",
      operation: "list",
      method: "listWebhooks",
    });
  });

  it("parses endpoint registration", () => {
    expect(parseRestRoute(["webhooks"], "POST")).toMatchObject({
      service: "webhooks",
      operation: "create",
      method: "createWebhook",
    });
  });

  it("parses a single endpoint", () => {
    expect(parseRestRoute(["webhooks", "wh_1"], "GET")).toMatchObject({
      service: "webhooks",
      operation: "single",
      method: "getWebhookById",
      routeParams: { webhookId: "wh_1" },
    });
  });

  it("parses an endpoint update", () => {
    expect(parseRestRoute(["webhooks", "wh_1"], "PATCH")).toMatchObject({
      service: "webhooks",
      operation: "update",
      method: "updateWebhook",
      routeParams: { webhookId: "wh_1" },
    });
  });

  it("parses an endpoint deletion", () => {
    expect(parseRestRoute(["webhooks", "wh_1"], "DELETE")).toMatchObject({
      service: "webhooks",
      operation: "delete",
      method: "deleteWebhook",
      routeParams: { webhookId: "wh_1" },
    });
  });

  it("parses the secret reveal", () => {
    expect(parseRestRoute(["webhooks", "wh_1", "secret"], "GET")).toMatchObject(
      {
        service: "webhooks",
        method: "revealWebhookSecret",
        routeParams: { webhookId: "wh_1" },
      }
    );
  });

  it("does not route a write to the secret path", () => {
    // Secrets are generated, never submitted. A POST here must not be mistaken
    // for anything, least of all fall through to another handler.
    for (const method of ["POST", "PATCH", "DELETE"]) {
      expect(parseRestRoute(["webhooks", "wh_1", "secret"], method)).toEqual(
        {}
      );
    }
  });

  it("does not match a path nested deeper than the secret route", () => {
    // `parseRestRoute` puts the extra segment in `subId`, which the branch used
    // to ignore, so this returned live signing secrets for an invalid URL.
    expect(
      parseRestRoute(["webhooks", "wh_1", "secret", "anything"], "GET")
    ).toEqual({});
    expect(
      parseRestRoute(["webhooks", "wh_1", "secret", "a", "b"], "GET")
    ).toEqual({});
  });

  it("does not match a path nested deeper than an endpoint", () => {
    expect(parseRestRoute(["webhooks", "wh_1", "a", "b"], "GET")).toEqual({});
  });

  it("does not fall through an unknown sub-path to the endpoint itself", () => {
    // Without the sub-resource guard this would parse as GET /webhooks/wh_1
    // and serve the endpoint document.
    expect(parseRestRoute(["webhooks", "wh_1", "unknown"], "GET")).toEqual({});
  });

  it("parses the delivery list", () => {
    // The list operation drives the paginated `respondList` dispatch, so pin
    // `operation` alongside the method and the endpoint-scoping param.
    expect(
      parseRestRoute(["webhooks", "wh_1", "deliveries"], "GET")
    ).toMatchObject({
      service: "webhooks",
      operation: "list",
      method: "listWebhookDeliveries",
      routeParams: { webhookId: "wh_1" },
    });
  });

  it("parses a single delivery", () => {
    // The two-segment case carries both ids; `operation: single` routes it to
    // the document (`respondDoc`) dispatch rather than the list.
    expect(
      parseRestRoute(["webhooks", "wh_1", "deliveries", "del_1"], "GET")
    ).toMatchObject({
      service: "webhooks",
      operation: "single",
      method: "getWebhookDelivery",
      routeParams: { webhookId: "wh_1", deliveryId: "del_1" },
    });
  });

  it("does not route a write to a delivery path", () => {
    // Deliveries are read-only over REST; the drain owns every write, so a
    // mutating method on either delivery path must not resolve to a route.
    for (const method of ["POST", "PATCH", "DELETE"] as const) {
      expect(
        parseRestRoute(["webhooks", "wh_1", "deliveries"], method)
      ).toEqual({});
      expect(
        parseRestRoute(["webhooks", "wh_1", "deliveries", "del_1"], method)
      ).toEqual({});
    }
  });

  it("does not match a path nested deeper than a single delivery", () => {
    // A segment past the deliveryId is not a route; without the depth guard it
    // could fall through and mis-resolve to the single-delivery handler.
    expect(
      parseRestRoute(["webhooks", "wh_1", "deliveries", "del_1", "x"], "GET")
    ).toEqual({});
  });

  it("parses the drain trigger on GET and POST", () => {
    // Vercel Cron triggers with a GET; a manual/admin call may POST. Both must
    // resolve to the drain, and with a truthy `operation` so the pre-dispatch
    // guard (which rejects a falsy operation) lets it reach the handler.
    for (const method of ["GET", "POST"] as const) {
      expect(parseRestRoute(["webhooks", "drain"], method)).toMatchObject({
        service: "webhooks",
        operation: "single",
        method: "drainWebhooks",
      });
    }
  });

  it("does not route a non-GET/POST method to the drain", () => {
    for (const method of ["PATCH", "DELETE", "PUT"] as const) {
      expect(parseRestRoute(["webhooks", "drain"], method)).toEqual({});
    }
  });

  it("does not route an unsupported method on the collection", () => {
    expect(parseRestRoute(["webhooks"], "DELETE")).toEqual({});
  });
});
