// What the shared fetcher makes of each response shape.
//
// This boundary had no tests, and the defect it shipped is the reason the file
// exists: a `200 application/json` body of `null` — which is what a read
// answers when the thing legitimately does not exist — came back as `undefined`,
// so react-query rejected it with "Query data cannot be undefined" on every
// editor load. The query had answered correctly; the client threw the answer
// away.
//
// The cases below are the ones that must stay TOLD APART, which is the property
// a single falsy check cannot hold.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetcher } from "./fetcher";

/** A response with a JSON content-type and the given raw body text. */
function jsonResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "application/json" },
  });
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.fetch = originalFetch;
});

function respondWith(res: Response) {
  (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
    res
  );
}

describe("fetcher response shapes", () => {
  it("returns a null DOCUMENT as null, not undefined", () => {
    // The regression. `GET .../versions/autosave` answers exactly this when an
    // author has no recovery point.
    respondWith(jsonResponse("null"));
    return expect(fetcher("/anything")).resolves.toBeNull();
  });

  it("POSITIVE CONTROL: an ordinary object still comes back whole", async () => {
    // Without this, "returns null" would pass on a fetcher that returned null
    // for everything.
    respondWith(jsonResponse('{"id":"a","title":"t"}'));
    await expect(fetcher("/anything")).resolves.toEqual({
      id: "a",
      title: "t",
    });
  });

  it("returns an array body whole", async () => {
    respondWith(jsonResponse('[{"id":"a"}]'));
    await expect(fetcher("/anything")).resolves.toEqual([{ id: "a" }]);
  });

  it("returns undefined when the body cannot be parsed", async () => {
    // The case `null` used to be indistinguishable from. The server claimed
    // JSON and did not send it, which is not an answer of `null` — and a caller
    // that treats the two the same reports a broken endpoint as an empty one.
    respondWith(jsonResponse("<!DOCTYPE html><html>"));
    await expect(fetcher("/anything")).resolves.toBeUndefined();
  });

  it("returns undefined for a body that is not JSON at all", async () => {
    respondWith(
      new Response("hello", {
        status: 200,
        headers: { "content-type": "text/plain" },
      })
    );
    await expect(fetcher("/anything")).resolves.toBeUndefined();
  });

  it("returns undefined for a no-content status", async () => {
    // Asserts the OUTCOME callers depend on, and does NOT isolate the 204
    // branch: an empty body fails to parse anyway, so this stays green with
    // that branch disabled — verified. Said here rather than left to read as
    // coverage it does not provide. The branch cannot be isolated from the test
    // side, because the Response constructor refuses a 204 carrying a body.
    respondWith(new Response(null, { status: 204 }));
    await expect(fetcher("/anything")).resolves.toBeUndefined();
  });

  it("returns undefined for a bare scalar body", async () => {
    // Unchanged behaviour, asserted so the null fix is not read as licence to
    // start returning scalars. Nothing in this admin answers with one.
    respondWith(jsonResponse("42"));
    await expect(fetcher("/anything")).resolves.toBeUndefined();
  });
});
