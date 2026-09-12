import { describe, expect, it, vi, beforeEach } from "vitest";

import { NextlyError } from "../../errors/nextly-error";

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
  // The real predicate, not a stand-in. It keys on `statusCode`, and a mock
  // recognising a `Response` instead sends the fixture down the wrong branch:
  // `toNextlyAuthError` sees no status, produces a 500, and a loose `>= 400`
  // assertion calls that a pass.
  isErrorResponse: (value: unknown) =>
    typeof value === "object" && value !== null && "statusCode" in value,
}));

// Every operation is authorized against the document it names.
const canReadEntity = vi.fn();
const callerHoldsPermission = vi.fn();
vi.mock("../../auth/entity-read-access", () => ({
  readAccessCaller: (caller: { user: unknown }) => caller.user,
  canReadEntity: (slug: string, caller: unknown) =>
    canReadEntity(slug, caller) as unknown,
  callerHoldsPermission: (slug: string, caller: unknown) =>
    callerHoldsPermission(slug, caller) as unknown,
}));
// The stored per-document update rules, which the coarse permission above does
// not run. Spied rather than executed: what this file establishes is that the
// route asks, and with which document.
const assertDocumentUpdatable = vi.fn();
vi.mock("../versions-access", () => ({
  assertDocumentUpdatable: (...args: unknown[]) =>
    assertDocumentUpdatable(...args) as unknown,
}));

vi.mock("../authenticated-read", () => ({
  readCaller: (auth: unknown) => Promise.resolve({ user: auth }),
  PRIVATE_NO_STORE_HEADERS: {
    "Cache-Control": "private, no-store",
    Vary: "Cookie",
  },
}));

const { readLock, acquireLock, renewLock, releaseLock } = await import(
  "../document-lock"
);

const ref = { scopeKind: "collection", slug: "posts", entryId: "42" };
const holder = { ownerId: "u2", ownerLabel: "Bob", expiresInSeconds: 90 };
const post = (body: unknown, method = "POST") =>
  new Request("https://x.test/api/document-lock", {
    method,
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  requireAuthentication.mockResolvedValue(auth);
  canReadEntity.mockResolvedValue(true);
  callerHoldsPermission.mockResolvedValue(true);
  assertDocumentUpdatable.mockResolvedValue(undefined);
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
      { takeover: false, requestAccess: false }
    );
  });

  it("forwards takeover only when it is actually asked for", async () => {
    service.acquire.mockResolvedValue({ status: "acquired", claimToken: "t" });

    await acquireLock(post({ ...ref, takeover: true }));
    expect(service.acquire).toHaveBeenLastCalledWith(ref, expect.anything(), {
      takeover: true,
      requestAccess: false,
    });

    // Anything other than the boolean is not a request to displace a colleague.
    await acquireLock(post({ ...ref, takeover: "yes" }));
    expect(service.acquire).toHaveBeenLastCalledWith(ref, expect.anything(), {
      takeover: false,
      requestAccess: false,
    });
  });

  it("forwards a request to edit, and never mistakes it for a takeover", async () => {
    // The two intents share a call and are opposites: one displaces a
    // colleague, the other leaves word and changes nothing. Read from separate
    // keys so neither can be produced by asking for the other -- a body that
    // asked to wait must not come out the far side as a steal.
    service.acquire.mockResolvedValue({
      status: "held",
      holder,
      waiting: true,
    });

    await acquireLock(post({ ...ref, requestAccess: true }));
    expect(service.acquire).toHaveBeenLastCalledWith(ref, expect.anything(), {
      takeover: false,
      requestAccess: true,
    });

    // And the same reading rule: a truthy string is not a person asking.
    await acquireLock(post({ ...ref, requestAccess: "yes" }));
    expect(service.acquire).toHaveBeenLastCalledWith(ref, expect.anything(), {
      takeover: false,
      requestAccess: false,
    });
  });

  it("hands the refused editor back the fact that its ask is on record", async () => {
    // A control that silently does nothing is worse than no control: the
    // interface can only confirm the ask if the answer carries it, and it must
    // read the SERVER's answer rather than the click it just handled.
    service.acquire.mockResolvedValue({
      status: "held",
      holder,
      waiting: true,
    });

    const response = await acquireLock(post({ ...ref, requestAccess: true }));

    expect(await response.json()).toMatchObject({
      item: { status: "held", waiting: true },
    });
  });

  it("reports a held document rather than refusing", async () => {
    // Advisory: the second editor is told and not stopped.
    service.acquire.mockResolvedValue({
      status: "held",
      holder,
      waiting: false,
    });

    const response = await acquireLock(post(ref));

    expect(response.status).toBe(200);
    // In the canonical envelope: "held" is an answer about the document, not a
    // failure of the request, so it is the item rather than an error.
    expect(await response.json()).toMatchObject({ item: { status: "held" } });
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

  it("answers 401, not 500, without a session", async () => {
    // The middleware reports a failure as this object, not a Response.
    // Asserting the exact status is what separates a refusal from a crash: a
    // fixture of the wrong shape produces an internal error, and a loose
    // `>= 400` calls that a pass.
    requireAuthentication.mockResolvedValue({
      statusCode: 401,
      error: "Unauthorized",
      message: "Authentication required",
      data: null,
    });

    for (const call of [
      () => readLock(new Request("https://x.test/api/document-lock")),
      () => acquireLock(post(ref)),
      () => renewLock(post({ ...ref, claimToken: "t" }, "PATCH")),
      () => releaseLock(post({ ...ref, claimToken: "t" }, "DELETE")),
    ]) {
      expect((await call()).status).toBe(401);
    }
    expect(service.read).not.toHaveBeenCalled();
    expect(service.acquire).not.toHaveBeenCalled();
  });

  it("refuses a document the caller cannot read", async () => {
    // Authentication is not authorization. This route is direct-dispatched, so
    // it never reaches the central path, and without its own gate any signed-in
    // account could read who is editing a collection it cannot open.
    canReadEntity.mockResolvedValue(false);

    const response = await readLock(
      new Request(
        "https://x.test/api/document-lock?scopeKind=collection&slug=posts&entryId=42"
      )
    );

    expect(response.status).toBe(403);
    expect(service.read).not.toHaveBeenCalled();
  });

  it("requires UPDATE to claim, renew or release, not merely read", async () => {
    // A lock is a statement that you are editing. Someone who may read a
    // document but not change it is not editing it, and must not be able to
    // displace a colleague with `takeover`.
    callerHoldsPermission.mockResolvedValue(false);

    for (const call of [
      () => acquireLock(post({ ...ref, takeover: true })),
      () => renewLock(post({ ...ref, claimToken: "t" }, "PATCH")),
      () => releaseLock(post({ ...ref, claimToken: "t" }, "DELETE")),
    ]) {
      expect((await call()).status).toBe(403);
    }
    expect(service.acquire).not.toHaveBeenCalled();
    expect(service.renew).not.toHaveBeenCalled();
    expect(service.release).not.toHaveBeenCalled();
  });

  it("asks about the document it was given, not a fixed one", async () => {
    // A gate that always asked about the same slug would pass every case above
    // while authorizing the wrong thing.
    service.acquire.mockResolvedValue({ status: "acquired", claimToken: "t" });

    await acquireLock(post({ ...ref, slug: "invoices" }));

    expect(callerHoldsPermission).toHaveBeenCalledWith(
      "update-invoices",
      expect.anything()
    );
  });

  it("keeps a lock read out of every cache", async () => {
    // Shaped by who asked, and it names a colleague and what they are doing.
    service.read.mockResolvedValue(undefined);

    const response = await readLock(
      new Request(
        "https://x.test/api/document-lock?scopeKind=collection&slug=posts&entryId=42"
      )
    );

    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Vary")).toBe("Cookie");
  });

  it("returns mutations in the canonical envelope", async () => {
    // `{ message, item }`, so a client reads these with the same handling as
    // every other write rather than a shape invented here.
    service.acquire.mockResolvedValue({ status: "acquired", claimToken: "t" });

    const body = (await (await acquireLock(post(ref))).json()) as Record<
      string,
      unknown
    >;

    expect(body).toHaveProperty("message");
    expect(body.item).toMatchObject({ status: "acquired" });
  });

  it("asks whether THIS document may be updated, not documents of its kind", async () => {
    // 🔴 `update-<slug>` is the coarse route permission and says only the latter.
    // A document the caller cannot load - a draft they may not see, a row that
    // is gone - is refused while that permission still stands, so without this a
    // caller claims a document every real update denies them, and the real
    // editor is shown a false holder and pushed to take over their own row.
    service.acquire.mockResolvedValue({ status: "acquired", claimToken: "t" });

    await acquireLock(post({ ...ref }));

    expect(assertDocumentUpdatable).toHaveBeenCalledWith(
      ref.scopeKind,
      ref.slug,
      ref.entryId,
      auth,
      undefined
    );
  });

  it("refuses the claim when the document gate refuses the row", async () => {
    // The real refusal, not a stand-in: the handler branches on what a
    // `NextlyError` is, and a look-alike is reported as a 500 while the
    // assertion below still reads "the claim did not happen".
    assertDocumentUpdatable.mockRejectedValue(
      NextlyError.forbidden({
        logContext: { reason: "document-not-updatable" },
      })
    );

    const response = await acquireLock(post({ ...ref }));

    expect(response.status).toBe(403);
    expect(service.acquire).not.toHaveBeenCalled();
  });

  it("asks it of a renewal too, which restates the same claim", async () => {
    // A renewal says the holder is STILL editing, so it has to answer the same
    // question a claim does. Gating only the claim would let a lock outlive the
    // rules that permitted it, for as long as the holder kept renewing.
    service.renew.mockResolvedValue({ status: "renewed" });

    await renewLock(post({ ...ref, claimToken: "t" }, "PATCH"));

    expect(assertDocumentUpdatable).toHaveBeenCalledWith(
      ref.scopeKind,
      ref.slug,
      ref.entryId,
      auth,
      undefined
    );
  });

  it("does not ask it of a release, so a refused row can still be given up", async () => {
    // Releasing is the opposite statement: this editor has STOPPED editing. The
    // document gate reads the row, so the holder's own save can flip its answer
    // mid-claim, and asking it here would refuse the departing editor's own
    // DELETE and strand the claim until its lease lapsed - leaving colleagues a
    // holder who has already left. The claim token names the one acquisition
    // being given up, and the DELETE is fenced on it.
    assertDocumentUpdatable.mockRejectedValue(
      NextlyError.forbidden({
        logContext: { reason: "document-not-updatable" },
      })
    );

    const response = await releaseLock(
      post({ ...ref, claimToken: "t" }, "DELETE")
    );

    expect(response.status).toBe(200);
    expect(assertDocumentUpdatable).not.toHaveBeenCalled();
    expect(service.release).toHaveBeenCalledWith(ref, "t");
  });

  it("does not ask it of a read", async () => {
    // Reading who holds a document is not updating it, and running an update
    // gate here would hide the holder from everyone who may only read.
    service.read.mockResolvedValue(null);

    await readLock(
      new Request(
        "https://x.test/api/document-lock?scopeKind=collection&slug=posts&entryId=42"
      )
    );

    expect(assertDocumentUpdatable).not.toHaveBeenCalled();
  });
});
