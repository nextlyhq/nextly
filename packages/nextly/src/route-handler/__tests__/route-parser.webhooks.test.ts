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
    expect(parseRestRoute(["webhooks", "wh_1", "deliveries"], "GET")).toEqual(
      {}
    );
  });

  it("does not route an unsupported method on the collection", () => {
    expect(parseRestRoute(["webhooks"], "DELETE")).toEqual({});
  });
});
