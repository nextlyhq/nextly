// Pins the canonical respondX wire shapes for all six webhook endpoints
// (list / get / create / update / delete / reveal-secret), plus the two access
// rules that are not visible in the response shape: mutations are session-only,
// and revealing a signing secret requires update rather than read.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../auth/middleware", () => ({
  requireAnyPermission: vi.fn(),
  isErrorResponse: vi.fn(),
}));

vi.mock("../auth/middleware/to-nextly-error", () => ({
  toNextlyAuthError: vi.fn((errResponse: unknown) => {
    return new Error(`auth error: ${JSON.stringify(errResponse)}`);
  }),
}));

vi.mock("../init", () => ({
  getCachedNextly: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../di", () => ({
  container: {
    get: vi.fn(),
    has: vi.fn().mockReturnValue(false),
  },
}));

import { isErrorResponse, requireAnyPermission } from "../auth/middleware";
import { container } from "../di";

import {
  createWebhook,
  deleteWebhook,
  getWebhookById,
  listWebhooks,
  redeliverWebhookDelivery,
  revealWebhookSecret,
  testWebhookEndpoint,
  updateWebhook,
} from "./webhooks";

const ENDPOINT = {
  id: "wh_1",
  name: "Orders",
  url: "https://example.com/hooks",
  enabled: true,
  eventTypes: ["entry.created"],
  headers: null,
  secretPrefix: "whsec_abcdefgh",
  createdBy: "user-1",
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
};

/** Authorise the next permission check as an interactive session. */
const asSession = (): void => {
  (requireAnyPermission as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    userId: "user-1",
    authMethod: "session",
  });
};

/** Authorise the next permission check as an API key rather than a session. */
const asApiKey = (): void => {
  (requireAnyPermission as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    userId: "user-1",
    authMethod: "api-key",
  });
};

const withService = (impl: Record<string, unknown>): void => {
  (container.get as ReturnType<typeof vi.fn>).mockReturnValue(impl);
};

const jsonBody = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  (isErrorResponse as ReturnType<typeof vi.fn>).mockReturnValue(false);
});

describe("listWebhooks", () => {
  it("emits respondList with synthetic single-page meta", async () => {
    asSession();
    withService({
      listEndpoints: vi.fn().mockResolvedValue([ENDPOINT, ENDPOINT]),
    });

    const res = await listWebhooks(new Request("http://x/api/webhooks"));

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      items: unknown[];
      meta: { total: number; page: number; totalPages: number };
    };
    expect(json).not.toHaveProperty("data");
    expect(json.items).toHaveLength(2);
    expect(json.meta).toMatchObject({
      total: 2,
      page: 1,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
    });
  });

  it("never leaks a secret through the list", async () => {
    asSession();
    withService({ listEndpoints: vi.fn().mockResolvedValue([ENDPOINT]) });

    const res = await listWebhooks(new Request("http://x/api/webhooks"));

    const body = await res.text();
    expect(body).not.toContain("secretHash");
    expect(body).not.toContain("whsec_abcdefghijklmnop");
  });
});

describe("getWebhookById", () => {
  it("emits respondDoc (bare doc body)", async () => {
    asSession();
    withService({ getEndpoint: vi.fn().mockResolvedValue(ENDPOINT) });

    const res = await getWebhookById(
      new Request("http://x/api/webhooks/wh_1"),
      "wh_1"
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).not.toHaveProperty("data");
    expect(json).not.toHaveProperty("item");
    expect(json).toEqual(ENDPOINT);
  });

  it("is a 404 when the endpoint does not exist", async () => {
    asSession();
    withService({ getEndpoint: vi.fn().mockResolvedValue(null) });

    const res = await getWebhookById(
      new Request("http://x/api/webhooks/missing"),
      "missing"
    );

    expect(res.status).toBe(404);
  });
});

describe("createWebhook", () => {
  it("emits respondMutation with status 201 and { doc, secret } as item", async () => {
    asSession();
    withService({
      createEndpoint: vi.fn().mockResolvedValue({
        endpoint: ENDPOINT,
        secret: "whsec_thesecret",
      }),
    });

    const res = await createWebhook(
      new Request(
        "http://x/api/webhooks",
        jsonBody({
          name: "Orders",
          url: "https://example.com/hooks",
          eventTypes: ["entry.created"],
        })
      )
    );

    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      message: string;
      item: { doc: unknown; secret: string };
    };
    expect(json).not.toHaveProperty("data");
    expect(json.item.doc).toEqual(ENDPOINT);
    expect(json.item.secret).toBe("whsec_thesecret");
  });

  it("rejects an API key, because registering an endpoint is an SSRF and exfiltration primitive", async () => {
    asApiKey();
    const createEndpoint = vi.fn();
    withService({ createEndpoint });

    const res = await createWebhook(
      new Request(
        "http://x/api/webhooks",
        jsonBody({
          name: "Orders",
          url: "https://example.com/hooks",
          eventTypes: ["entry.created"],
        })
      )
    );

    expect(res.status).toBe(403);
    expect(createEndpoint).not.toHaveBeenCalled();
  });

  it("is a 400 when the body fails validation, before the service is reached", async () => {
    asSession();
    const createEndpoint = vi.fn();
    withService({ createEndpoint });

    const res = await createWebhook(
      new Request(
        "http://x/api/webhooks",
        // No event types: a subscription to nothing would never fire.
        jsonBody({
          name: "Orders",
          url: "https://example.com/h",
          eventTypes: [],
        })
      )
    );

    expect(res.status).toBe(400);
    expect(createEndpoint).not.toHaveBeenCalled();
  });
});

describe("updateWebhook", () => {
  it("emits respondMutation with the updated document", async () => {
    asSession();
    withService({
      updateEndpoint: vi
        .fn()
        .mockResolvedValue({ ...ENDPOINT, name: "Renamed" }),
    });

    const res = await updateWebhook(
      new Request("http://x/api/webhooks/wh_1", {
        ...jsonBody({ name: "Renamed" }),
        method: "PATCH",
      }),
      "wh_1"
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      message: string;
      item: { name: string };
    };
    expect(json).not.toHaveProperty("data");
    expect(json.item.name).toBe("Renamed");
  });

  it("rejects an API key", async () => {
    asApiKey();
    const updateEndpoint = vi.fn();
    withService({ updateEndpoint });

    const res = await updateWebhook(
      new Request("http://x/api/webhooks/wh_1", {
        ...jsonBody({ name: "Renamed" }),
        method: "PATCH",
      }),
      "wh_1"
    );

    expect(res.status).toBe(403);
    expect(updateEndpoint).not.toHaveBeenCalled();
  });
});

describe("deleteWebhook", () => {
  it("emits respondAction with the affected id", async () => {
    asSession();
    withService({ deleteEndpoint: vi.fn().mockResolvedValue(undefined) });

    const res = await deleteWebhook(
      new Request("http://x/api/webhooks/wh_1", { method: "DELETE" }),
      "wh_1"
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as { message: string; id: string };
    expect(json).not.toHaveProperty("data");
    expect(json).not.toHaveProperty("item");
    expect(json.id).toBe("wh_1");
  });

  it("rejects an API key", async () => {
    asApiKey();
    const deleteEndpoint = vi.fn();
    withService({ deleteEndpoint });

    const res = await deleteWebhook(
      new Request("http://x/api/webhooks/wh_1", { method: "DELETE" }),
      "wh_1"
    );

    expect(res.status).toBe(403);
    expect(deleteEndpoint).not.toHaveBeenCalled();
  });
});

describe("revealWebhookSecret", () => {
  it("emits respondData carrying every active secret", async () => {
    // More than one is active during a rotation, and a caller reconciling
    // their configuration needs to see all of them.
    asSession();
    withService({
      revealSecrets: vi.fn().mockResolvedValue(["whsec_a", "whsec_b"]),
    });

    const res = await revealWebhookSecret(
      new Request("http://x/api/webhooks/wh_1/secret"),
      "wh_1"
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as { secrets: string[] };
    expect(json).not.toHaveProperty("data");
    expect(json.secrets).toEqual(["whsec_a", "whsec_b"]);
  });

  it("tells browsers and intermediaries not to store the response", async () => {
    // An authenticated GET carrying a signing key must not be retained or
    // replayed by a shared cache.
    asSession();
    withService({ revealSecrets: vi.fn().mockResolvedValue(["whsec_a"]) });

    const res = await revealWebhookSecret(
      new Request("http://x/api/webhooks/wh_1/secret"),
      "wh_1"
    );

    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("Vary")).toBe("Cookie");
  });

  it("asks for update rather than read, so a read-only role cannot forge traffic", async () => {
    asSession();
    withService({ revealSecrets: vi.fn().mockResolvedValue([]) });

    await revealWebhookSecret(
      new Request("http://x/api/webhooks/wh_1/secret"),
      "wh_1"
    );

    // The other reads accept `read` OR `update`; this one must accept only
    // `update`, so the permission list is asserted rather than the outcome.
    expect(requireAnyPermission).toHaveBeenCalledWith(expect.anything(), [
      { action: "update", resource: "webhooks" },
    ]);
  });

  it("rejects an API key", async () => {
    asApiKey();
    const revealSecrets = vi.fn();
    withService({ revealSecrets });

    const res = await revealWebhookSecret(
      new Request("http://x/api/webhooks/wh_1/secret"),
      "wh_1"
    );

    expect(res.status).toBe(403);
    expect(revealSecrets).not.toHaveBeenCalled();
  });
});

/** Route each container.get to a named service impl. */
const withServices = (map: Record<string, unknown>): void => {
  (container.get as ReturnType<typeof vi.fn>).mockImplementation(
    (key: string) => map[key]
  );
};

describe("testWebhookEndpoint", () => {
  it("sends a test and returns the probe result via respondAction", async () => {
    asSession();
    const testEndpoint = vi.fn().mockResolvedValue({
      delivered: true,
      statusCode: 200,
      latencyMs: 42,
    });
    withService({ testEndpoint });

    const res = await testWebhookEndpoint(
      new Request("http://x/api/webhooks/wh_1/test", { method: "POST" }),
      "wh_1"
    );

    expect(res.status).toBe(200);
    expect(testEndpoint).toHaveBeenCalledWith("wh_1");
    const json = (await res.json()) as {
      message: string;
      delivered: boolean;
      statusCode: number;
    };
    expect(json.message).toBe("Test event sent.");
    expect(json.delivered).toBe(true);
    expect(json.statusCode).toBe(200);
  });

  it("rejects an API key (session-only) without testing", async () => {
    asApiKey();
    const testEndpoint = vi.fn();
    withService({ testEndpoint });

    const res = await testWebhookEndpoint(
      new Request("http://x/api/webhooks/wh_1/test", { method: "POST" }),
      "wh_1"
    );

    expect(res.status).toBe(403);
    expect(testEndpoint).not.toHaveBeenCalled();
  });
});

describe("redeliverWebhookDelivery", () => {
  it("re-arms then returns the delivery via respondMutation", async () => {
    asSession();
    const redeliverDelivery = vi.fn().mockResolvedValue(undefined);
    const getDelivery = vi
      .fn()
      .mockResolvedValue({ id: "del_1", status: "pending", attemptCount: 0 });
    withServices({
      webhookEndpointService: { redeliverDelivery },
      webhookDeliveryQueryService: { getDelivery },
    });

    const res = await redeliverWebhookDelivery(
      new Request("http://x/api/webhooks/wh_1/deliveries/del_1/redeliver", {
        method: "POST",
      }),
      "wh_1",
      "del_1"
    );

    expect(res.status).toBe(200);
    expect(redeliverDelivery).toHaveBeenCalledWith("wh_1", "del_1");
    const json = (await res.json()) as {
      message: string;
      item: { id: string; status: string };
    };
    expect(json.message).toBe("Redelivery queued.");
    expect(json.item).toMatchObject({ id: "del_1", status: "pending" });
  });

  it("rejects an API key (session-only) without re-arming", async () => {
    asApiKey();
    const redeliverDelivery = vi.fn();
    withServices({ webhookEndpointService: { redeliverDelivery } });

    const res = await redeliverWebhookDelivery(
      new Request("http://x/api/webhooks/wh_1/deliveries/del_1/redeliver", {
        method: "POST",
      }),
      "wh_1",
      "del_1"
    );

    expect(res.status).toBe(403);
    expect(redeliverDelivery).not.toHaveBeenCalled();
  });
});
