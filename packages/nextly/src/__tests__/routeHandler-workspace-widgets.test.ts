/**
 * The registry reaching the admin over the wire.
 *
 * `publishableWidgets` has its own unit tests; what those cannot see is whether
 * anything CALLS it, and an unwired projection is indistinguishable from an app
 * that registered nothing. So this drives the real handler and reads the real
 * response body.
 *
 * The session is the one precondition replaced, because it needs a signed
 * cookie and a database and has nothing to do with the property under test.
 * Service initialisation is deliberately NOT replaced: it runs
 * `resetWidgetRegistries()`, which both clears the registry and writes core's
 * own dashboard cards into it -- so a widget registered before the first
 * request would be cleared by the boot that request triggers, and a test that
 * mocked boot away would pass while the real dashboard showed nothing. Warming boot
 * first and registering after it is the order a plugin's own registration
 * happens in.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { CORE_WIDGETS } from "../domains/widgets/core-widgets";
import { clearWidgets, registerWidget } from "../domains/widgets/registry";
import { createDynamicHandlers } from "../routeHandler";
import { sanitizeConfig } from "../shared/types/config";

// By the module's own path rather than by the `@nextly/auth/middleware` alias
// the handler imports it under. `vi.mock` keys on a resolved id and the alias is
// rewritten by a Vite plugin rather than by the mock registry, so a factory
// registered against the alias string is never consulted -- the route then
// answers 401 with the real middleware, which reads as the test being wrong
// about authentication rather than about the mock.
vi.mock("../auth/middleware", async importOriginal => {
  const actual = await importOriginal<typeof import("../auth/middleware")>();
  return {
    ...actual,
    // A caller with a session, expressed as the shape `isErrorResponse` reads:
    // no `statusCode` means "authenticated".
    requireAuthentication: vi.fn(async () => ({ user: { id: "u1" } })),
  };
});

const ORIGINAL_DB_DIALECT = process.env.DB_DIALECT;
// sqlite is the one dialect that needs no connection string.
process.env.DB_DIALECT = "sqlite";

const handlers = createDynamicHandlers({
  config: sanitizeConfig({ collections: [] }),
});

async function workspaceBody(): Promise<Record<string, unknown>> {
  const response = await handlers.GET(
    new Request("http://localhost/api/admin-meta/workspace", { method: "GET" }),
    { params: Promise.resolve({ params: ["admin-meta", "workspace"] }) }
  );
  expect(response.status).toBe(200);
  return (await response.json()) as Record<string, unknown>;
}

beforeAll(async () => {
  // The first request boots, and boot empties the registries. Every
  // registration below therefore happens after it, exactly as a plugin's does.
  await workspaceBody();
});

afterEach(() => clearWidgets());

describe("the widget registry over /api/admin-meta/workspace", () => {
  it("carries a widget the app registered through the public API", async () => {
    registerWidget(
      {
        id: "acme/revenue",
        title: "Revenue",
        archetype: "metric",
        defaultSize: "sm",
        query: { source: "collection:orders", op: "count" },
      },
      { source: "@acme/stripe" }
    );

    const body = await workspaceBody();
    const widgets = body.widgets as { id: string }[];

    // By MEMBERSHIP, not by whole-array equality. Boot registers core's own
    // dashboard cards into the same registry, so the payload legitimately
    // carries those too and an exact-array assertion would break every time
    // core adds or removes one -- while saying nothing about the property under
    // test, which is that an app's own registration survives to the wire.
    expect(widgets).toContainEqual(
      expect.objectContaining({
        id: "acme/revenue",
        title: "Revenue",
        archetype: "metric",
        defaultSize: "sm",
        query: { source: "collection:orders", op: "count" },
      })
    );

    // And core's cards travel by the same route, which is what makes the
    // dashboard's own sections manageable rather than hardcoded above the grid.
    expect(widgets.map(widget => widget.id)).toEqual(
      expect.arrayContaining(CORE_WIDGETS.map(widget => widget.id))
    );
  });

  it("omits the key entirely when nothing is registered", async () => {
    // Reachable only through the `afterEach` clear above, now that boot
    // registers core's cards -- a running app always has those. Kept because
    // the omit-when-empty branch is still the right behaviour and nothing else
    // covers it; noted so the next reader does not take it as evidence that a
    // real workspace response can arrive without widgets.
    expect(await workspaceBody()).not.toHaveProperty("widgets");
  });
});

afterAll(() => {
  if (ORIGINAL_DB_DIALECT === undefined) delete process.env.DB_DIALECT;
  else process.env.DB_DIALECT = ORIGINAL_DB_DIALECT;
});
