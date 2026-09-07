import { describe, expect, it, vi, beforeEach } from "vitest";

const service = {
  read: vi.fn(),
  acquire: vi.fn(),
  renew: vi.fn(),
  release: vi.fn(),
};
const auth = { userId: "u1", userName: "Ada", userEmail: "ada@example.com" };
const requireAuthentication = vi.fn();

vi.mock("../../init", () => ({
  getCachedNextly: vi.fn().mockResolvedValue({}),
}));
vi.mock("../../di/container", () => ({ container: { get: () => service } }));
vi.mock("../../auth/middleware", () => ({
  requireAuthentication: (req: Request) => requireAuthentication(req),
  isErrorResponse: (value: unknown) => value instanceof Response,
}));

const { readLock, acquireLock, renewLock, releaseLock } = await import(
  "../document-lock"
);

const ref = { scopeKind: "collection", slug: "posts", entryId: "42" };
const post = (body: unknown, method = "POST") =>
  new Request("https://x.test/api/document-lock", {
    method,
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  requireAuthentication.mockResolvedValue(auth);
});

describe("document lock route", () => {
  it("takes the claimant from the session, never from the body", async () => {
    // A caller that could name its own owner id would claim a document as a
    // colleague, and the name the next editor is shown would be evidence of
    // something that did not happen.
    service.acquire.mockResolvedValue({ status: "acquired", claimToken: "t" });

    await acquireLock(
      post({ ...ref, ownerId: "someone-else", ownerLabel: "Bob" })
    );

    expect(service.acquire).toHaveBeenCalledWith(
      ref,
      { ownerId: "u1", ownerLabel: "Ada" },
      { takeover: false }
    );
  });

  it("forwards takeover only when it is actually asked for", async () => {
    service.acquire.mockResolvedValue({ status: "acquired", claimToken: "t" });

    await acquireLock(post({ ...ref, takeover: true }));
    expect(service.acquire).toHaveBeenLastCalledWith(ref, expect.anything(), {
      takeover: true,
    });

    // Anything other than the boolean is not a request to displace a colleague.
    await acquireLock(post({ ...ref, takeover: "yes" }));
    expect(service.acquire).toHaveBeenLastCalledWith(ref, expect.anything(), {
      takeover: false,
    });
  });

  it("reports a held document rather than refusing", async () => {
    // Advisory: the second editor is told and not stopped.
    service.acquire.mockResolvedValue({
      status: "held",
      holder: { ownerId: "u2", ownerLabel: "Bob", expiresInSeconds: 90 },
    });

    const response = await acquireLock(post(ref));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "held" });
  });

  it("answers an unheld document with an explicit null", async () => {
    // Not an omitted key: "nobody holds this" is the answer, and a missing
    // field reads as a response that failed to say.
    service.read.mockResolvedValue(undefined);

    const response = await readLock(
      new Request(
        "https://x.test/api/document-lock?scopeKind=collection&slug=posts&entryId=42"
      )
    );

    expect(await response.json()).toEqual({ holder: null });
  });

  it("refuses a reference the repository could not key", async () => {
    // Validated through the same function that keys the row, so a reference
    // this accepted but the repository could not address is impossible.
    for (const bad of [
      { ...ref, slug: "" },
      { ...ref, slug: "with:colon" },
      { ...ref, scopeKind: "component" },
      { ...ref, entryId: "x".repeat(300) },
    ]) {
      const response = await acquireLock(post(bad));
      expect(response.status).toBe(400);
    }
    expect(service.acquire).not.toHaveBeenCalled();
  });

  it("requires a claim token to renew or release", async () => {
    // Proving it is the same claim, not merely the same person: a second tab
    // belonging to one editor must not extend the first tab's claim.
    expect((await renewLock(post(ref, "PATCH"))).status).toBe(400);
    expect((await releaseLock(post(ref, "DELETE"))).status).toBe(400);
    expect(service.renew).not.toHaveBeenCalled();
    expect(service.release).not.toHaveBeenCalled();
  });

  it("refuses every operation without a session", async () => {
    requireAuthentication.mockResolvedValue(
      new Response(null, { status: 401 })
    );

    for (const call of [
      () => readLock(new Request("https://x.test/api/document-lock")),
      () => acquireLock(post(ref)),
      () => renewLock(post({ ...ref, claimToken: "t" }, "PATCH")),
      () => releaseLock(post({ ...ref, claimToken: "t" }, "DELETE")),
    ]) {
      const response = await call();
      expect(response.status).toBeGreaterThanOrEqual(400);
    }
    expect(service.read).not.toHaveBeenCalled();
    expect(service.acquire).not.toHaveBeenCalled();
  });
});
