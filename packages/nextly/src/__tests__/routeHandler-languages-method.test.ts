/**
 * The languages route's answer to a verb it does not serve.
 *
 * On the wire rather than in the switch: the branch sits outside the dispatcher's
 * NextlyError-to-response mapping, so a refusal written the obvious way escapes with a
 * hand-built body — a status and a sentence, with no code and no request id — which Nextly's
 * own error parser cannot read. Only a real Request through the real handler sees that.
 *
 * No database is involved: the refusal answers before any service is reached.
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
const ctx = () => ({ params: Promise.resolve({ params: ["languages"] }) });

describe("a verb the languages route does not serve", () => {
  it("answers with the canonical error envelope, not a hand-built body", async () => {
    const response = await handlers().PATCH(
      new Request("http://localhost/api/languages", { method: "PATCH" }),
      ctx()
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("content-type")).toBe(
      "application/problem+json"
    );
    expect(response.headers.get("x-request-id")).toBeTruthy();
    const body = (await response.json()) as {
      error?: { code?: string; message?: string; requestId?: string };
    };
    expect(body.error?.code).toBe("METHOD_NOT_ALLOWED");
    expect(body.error?.message).toBeTruthy();
    expect(body.error?.requestId).toBeTruthy();
  });

  it("says which verbs it does serve", async () => {
    const response = await handlers().DELETE(
      new Request("http://localhost/api/languages", { method: "DELETE" }),
      ctx()
    );

    expect(response.status).toBe(405);
    // Required of a 405 by HTTP, and the only machine-readable statement of what to send.
    expect(response.headers.get("allow")).toBe("GET, POST");
  });
});
