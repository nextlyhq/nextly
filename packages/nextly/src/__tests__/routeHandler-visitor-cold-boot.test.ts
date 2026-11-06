/**
 * A visitor's request boots the app before it is judged.
 *
 * A request carrying no credential to a route that serves visitors is judged
 * by the Public role, which is read from the database through the app's
 * services. The ordinary REST path initialises those services in
 * `getDispatcher()`, after authorization, so a cold handler (`createDynamic
 * Handlers({ config })` with no instrumentation) must initialise them before
 * the visitor's verdict is asked, or the first anonymous request fails rather
 * than being answered.
 *
 * A request with no credential to a route that serves no visitor is still
 * refused before anything boots: being turned away needs no services.
 *
 * Both requests end at the route, so what serves an admitted one is mocked
 * empty, keeping this file under the module budget's heavy line: the service
 * graph, the dispatcher, the auth routes and their bridge, the plugins'
 * contexts, and the version, dashboard, webhook, release and Single routes
 * with the Direct API. An empty mock has no exports, so a request that reached
 * any of them would fail on Vitest's missing-export error, not answer 401.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const order = vi.hoisted(() => [] as string[]);

vi.mock("../route-handler", async importOriginal => ({
  ...(await importOriginal<typeof import("../route-handler")>()),
  ensureServicesInitialized: vi.fn(async () => {
    order.push("boot");
  }),
}));

vi.mock("../auth/access/route-gate-adapters", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../auth/access/route-gate-adapters")
  >()),
  // Refused as Public lacking the read, so the request ends at the route:
  // what is asserted is only that it was asked after the boot.
  routeVisitorVerdict: vi.fn(async () => {
    order.push("verdict");
    return { allowed: false, refusal: "unauthenticated" };
  }),
}));

vi.mock("../services/index", () => ({}));
vi.mock("../dispatcher/dispatcher", () => ({}));
vi.mock("../auth/handlers/deps-bridge", () => ({}));
vi.mock("../plugins/plugin-context", () => ({}));
vi.mock("../auth/handlers/router", () => ({}));
vi.mock("../api/versions-access", () => ({}));
vi.mock("../api/dashboard-summary", () => ({}));
vi.mock("../services/dashboard/attention-source", () => ({}));
vi.mock("../api/webhooks", () => ({}));
vi.mock("../direct-api/nextly", () => ({}));
vi.mock("../api/dashboard", () => ({}));
vi.mock("../api/releases", () => ({}));
vi.mock("../domains/singles/services/single-query-service", () => ({}));
vi.mock("../domains/singles/services/single-document-access", () => ({}));

import { createDynamicHandlers } from "../routeHandler";
import { sanitizeConfig } from "../shared/types/config";

// Set before the handler validates the environment.
process.env.DB_DIALECT = process.env.DB_DIALECT ?? "sqlite";
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

function visit(path: string[], method: "GET" | "POST", body?: unknown) {
  const handlers = createDynamicHandlers({
    config: sanitizeConfig({ collections: [] }),
  });
  const req = new Request(`http://localhost/api/${path.join("/")}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return handlers[method](req, { params: Promise.resolve({ params: path }) });
}

beforeEach(() => {
  order.length = 0;
});

describe("a visitor on a cold handler", () => {
  it("boots the app before the visitor's verdict is asked", async () => {
    const res = await visit(["collections", "posts", "entries"], "GET");
    expect(order).toEqual(["boot", "verdict"]);
    expect(res.status).toBe(401);
  });

  it("boots nothing for a route that serves no visitor", async () => {
    // A bulk delete admits no visitor, so it is refused at authentication.
    const res = await visit(
      ["collections", "posts", "entries", "bulk-delete"],
      "POST",
      { ids: ["1"] }
    );
    expect(order).toEqual([]);
    expect(res.status).toBe(401);
  });
});
