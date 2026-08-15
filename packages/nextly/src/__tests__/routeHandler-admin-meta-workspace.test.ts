/**
 * The admin-meta split at the HTTP boundary.
 *
 * `/api/admin-meta` answers before a session exists, because the sign-in
 * screen draws with it. `/api/admin-meta/workspace` describes the installation
 * — mounted plugins and what they contribute, locales, sidebar groups — and
 * requires a session.
 *
 * The property worth pinning is the DISPATCH, not the payload. Both paths
 * begin `admin-meta`, so a handler that matches on the first segment alone
 * answers for the second as well: the authenticated URL then returns the
 * public payload with a 200, which reads exactly like a working route. Only a
 * real Request through the real handler can see that, so these assert the
 * wire.
 *
 * No database is involved — an unauthenticated request is refused before any
 * connection is opened, which is itself part of what these lock in.
 */

import { afterAll, describe, expect, it } from "vitest";

import { createDynamicHandlers } from "../routeHandler";
import { sanitizeConfig } from "../shared/types/config";

const ORIGINAL_DB_DIALECT = process.env.DB_DIALECT;

// sqlite is the one dialect that needs no connection string.
process.env.DB_DIALECT = "sqlite";

afterAll(() => {
  if (ORIGINAL_DB_DIALECT === undefined) delete process.env.DB_DIALECT;
  else process.env.DB_DIALECT = ORIGINAL_DB_DIALECT;
});

function handlers() {
  return createDynamicHandlers({
    config: sanitizeConfig({
      collections: [],
      admin: { branding: { logoText: "Acme" } },
    }),
  });
}

/** Next.js hands route segments in as a promise; mirror that shape. */
function ctx(params: string[]) {
  return { params: Promise.resolve({ params }) };
}

function request(path: string) {
  return new Request(`http://localhost/api/${path}`, { method: "GET" });
}

describe("admin-meta split over HTTP", () => {
  it("serves branding without a session", async () => {
    const response = await handlers().GET(
      request("admin-meta"),
      ctx(["admin-meta"])
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ logoText: "Acme" });
  });

  it("refuses the workspace route without a session", async () => {
    const response = await handlers().GET(
      request("admin-meta/workspace"),
      ctx(["admin-meta", "workspace"])
    );

    expect(response.status).toBe(401);
  });

  it("does not answer the workspace route from the public handler", async () => {
    // The separating assertion. A first-segment match would return 200 with
    // the branding payload, so status alone cannot tell a working gate from a
    // route that quietly fell through: `logoText` is present in exactly the
    // response that should never be produced here.
    const response = await handlers().GET(
      request("admin-meta/workspace"),
      ctx(["admin-meta", "workspace"])
    );

    expect(response.status).not.toBe(200);
    expect(await response.text()).not.toContain("Acme");
  });

  it("keeps the workspace fields on the public route for now", async () => {
    // The admin still reads these from the public payload. Removing them
    // before it is migrated would blank the sidebar rather than close
    // anything, so this asserts the duplication is intact and is expected to
    // be inverted once the client reads the authenticated route.
    const response = await handlers().GET(
      request("admin-meta"),
      ctx(["admin-meta"])
    );

    expect(await response.json()).toMatchObject({ showBuilder: true });
  });
});
