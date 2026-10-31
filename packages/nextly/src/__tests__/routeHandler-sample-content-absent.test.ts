/**
 * The admin API's answer at `/admin/api/seed` where the project ships no
 * sample-content route of its own (the blank template, the playground).
 *
 * The admin's setup card probes that path with a HEAD on every dashboard load
 * and reads only 401, 403 and 404 as "no". Next.js answers a HEAD through the
 * catch-all's GET, so the request reaches the built-in router, whose answer
 * for a path it does not serve is a 400: the card read that as "not known",
 * kept the step open as unreadable, and asked again on every read. Driven
 * through the real handler, because the property is what the catch-all
 * answers, not what a helper returns.
 *
 * No database is involved: the answer comes before any service is reached.
 */
import { afterAll, describe, expect, it } from "vitest";

import { createDynamicHandlers } from "../routeHandler";
import { sanitizeConfig } from "../shared/types/config";

const ORIGINAL_DB_DIALECT = process.env.DB_DIALECT;
// sqlite is the one dialect that needs no connection string, and this request is answered
// before any connection is opened.
process.env.DB_DIALECT = "sqlite";

afterAll(() => {
  if (ORIGINAL_DB_DIALECT === undefined) delete process.env.DB_DIALECT;
  else process.env.DB_DIALECT = ORIGINAL_DB_DIALECT;
});

function handlers() {
  return createDynamicHandlers({
    config: sanitizeConfig({ collections: [] }),
  });
}

/** Next.js hands route segments in as a promise; mirror that shape. */
const ctx = (params: string[]) => ({
  params: Promise.resolve({ params }),
});

const SEED_URL = "http://localhost/admin/api/seed";

describe("the sample-content route, where the project ships none", () => {
  it("answers the setup card's HEAD probe 404 with no body", async () => {
    // Next.js serves a HEAD through the route's GET when it exports no HEAD,
    // with the request's own method, as here.
    const response = await handlers().GET(
      new Request(SEED_URL, { method: "HEAD" }),
      ctx(["seed"])
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });

  it("answers a GET or a POST 404 in the canonical error envelope", async () => {
    for (const response of [
      await handlers().GET(new Request(SEED_URL), ctx(["seed"])),
      await handlers().POST(
        new Request(SEED_URL, { method: "POST", body: "{}" }),
        ctx(["seed"])
      ),
    ]) {
      expect(response.status).toBe(404);
      expect(response.headers.get("content-type")).toBe(
        "application/problem+json"
      );
      const body = (await response.json()) as {
        error?: { code?: string; requestId?: string };
      };
      expect(body.error?.code).toBe("NOT_FOUND");
      expect(body.error?.requestId).toBeTruthy();
    }
  });

  it("leaves every other path the built-in router does not serve as it was", async () => {
    // The control: only the sample-content path is a missing route. Paths
    // beneath it, and other unknown paths, keep the invalid-route answer.
    for (const params of [["seedx"], ["seed", "extra"]]) {
      const response = await handlers().GET(
        new Request(`http://localhost/admin/api/${params.join("/")}`, {
          method: "HEAD",
        }),
        ctx(params)
      );
      expect(response.status).toBe(400);
    }
  });
});
