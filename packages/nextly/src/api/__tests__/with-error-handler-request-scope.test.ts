/**
 * The route wrapper pins the request every handler under it inherits.
 *
 * This is the seam that covers the handlers exported directly from `nextly/api/*`
 * -- versions, media, singles detail and the rest -- which never pass through
 * the service dispatcher. Threading the request into each of them by hand is
 * what four rounds of review kept finding half-done; pinning it here is what
 * makes a hook several layers down see the caller without every layer between
 * naming it.
 *
 * @module api/__tests__/with-error-handler-request-scope
 */
import { describe, expect, it } from "vitest";

import { currentRequest } from "../../hooks/request-scope";
import { withErrorHandler } from "../with-error-handler";

describe("withErrorHandler pins the request", () => {
  it("hands the running request to code that was told nothing", async () => {
    let seen: Request | undefined;
    const handler = withErrorHandler(async (_req: Request) => {
      // Deliberately reads the ambient value rather than the argument: this is
      // what a service three layers down can reach.
      seen = currentRequest();
      return new Response("ok");
    });
    const request = new Request("https://example.test/api/versions", {
      method: "GET",
    });
    await handler(request);
    expect(seen).toBe(request);
  });

  it("pins nothing outside a request", () => {
    // The control. A scope that leaked would answer here too, and every job,
    // seed and CLI write would be judged as whichever request ran last.
    expect(currentRequest()).toBeUndefined();
  });

  it("closes when the handler returns", async () => {
    const handler = withErrorHandler(async (_req: Request) =>
      Promise.resolve(new Response("ok"))
    );
    await handler(new Request("https://example.test/api/versions"));
    // A scope that outlived its request would attribute the next caller's work
    // to this one.
    expect(currentRequest()).toBeUndefined();
  });
});
