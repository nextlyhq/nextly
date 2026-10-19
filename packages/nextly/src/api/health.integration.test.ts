/**
 * `/api/health` against a real database, on in-memory SQLite.
 *
 * The route is re-exported by a project as its own `app/api/health/route.ts`
 * and is handed no config, so it can only report on a Nextly something else
 * started. These cases pin what it answers before that start, right after it
 * with no other request first, and when the database cannot be reached, and
 * that each unhealthy answer carries only the generic public error.
 */
import { afterEach, describe, expect, it } from "vitest";

import { clearServices, shutdownServices } from "../di/register";
import { createTestNextly, type TestNextly } from "../plugins/test-nextly";

import { GET, HEAD } from "./health";

/** The whole body a client gets for an unhealthy answer, with the request id set aside. */
async function unhealthyBody(response: Response): Promise<unknown> {
  const body = (await response.json()) as { error: { requestId: string } };
  expect(body.error.requestId).toMatch(/^req_/);
  return { ...body, error: { ...body.error, requestId: "<id>" } };
}

const GENERIC = {
  error: {
    code: "SERVICE_UNAVAILABLE",
    message: "Service unavailable. Please try again later.",
    requestId: "<id>",
  },
};

const ask = (method: "GET" | "HEAD") =>
  (method === "GET" ? GET : HEAD)(
    new Request("http://localhost:3000/api/health", { method })
  );

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describe("/api/health", () => {
  it("answers 503 before Nextly has started in the process, and 200 as soon as it has", async () => {
    // A process where nothing has started Nextly: a server whose first
    // request is this probe, with no start-up hook.
    await shutdownServices();
    clearServices();

    const before = await ask("GET");
    expect(before.status).toBe(503);
    expect(await unhealthyBody(before)).toEqual(GENERIC);
    expect((await ask("HEAD")).status).toBe(503);

    // What a project's instrumentation.ts does before the server takes
    // traffic. The next request is the probe itself.
    current = await createTestNextly();

    const after = await ask("GET");
    expect(after.status).toBe(200);
    expect(await after.json()).toMatchObject({
      ok: true,
      database: { connected: true, dialect: "sqlite" },
    });
    expect((await ask("HEAD")).status).toBe(200);
  });

  it("answers 503 with only the generic error when the database cannot be reached", async () => {
    current = await createTestNextly();
    // The connection is gone under a started Nextly, as when a database
    // server goes away.
    await current.adapter.disconnect();

    const response = await ask("GET");

    expect(response.status).toBe(503);
    expect(await unhealthyBody(response)).toEqual(GENERIC);
    expect((await ask("HEAD")).status).toBe(503);
  });
});
