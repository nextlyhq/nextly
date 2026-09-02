/**
 * What the public byte route will and will not hand to an anonymous caller.
 *
 * Driven through `createMediaHandlers` rather than by calling the handler
 * directly, because the property worth protecting is not "the handler checks a
 * mime type" — it is that the request reaches that check WITHOUT passing the
 * auth gate. Calling the handler on its own would pass while the route was
 * wired behind the gate, which is the arrangement that breaks fonts on exactly
 * the installs that lock media down.
 *
 * @module api/media-raw.test
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NextlyError } from "../errors/nextly-error";

import { createMediaHandlers } from "./media-handlers";

const mocks = vi.hoisted(() => ({
  mediaService: { findById: vi.fn() },
  storage: { read: vi.fn(), getPublicUrl: vi.fn() },
  requirePermission: vi.fn(),
}));

vi.mock("../init", () => ({
  getNextly: vi.fn(async () => ({})),
  getCachedNextly: vi.fn(async () => ({})),
}));

vi.mock("../di", () => ({
  getService: vi.fn(() => mocks.mediaService),
}));

vi.mock("../storage/storage", () => ({
  getMediaStorage: vi.fn(() => mocks.storage),
}));

vi.mock("../auth/middleware", async importOriginal => {
  const actual = await importOriginal<typeof import("../auth/middleware")>();
  return { ...actual, requirePermission: mocks.requirePermission };
});

/** A GET through the real route table, as a browser would address it. */
async function getRaw(
  mediaId: string,
  options?: { requireAuth?: boolean }
): Promise<Response> {
  const handlers = createMediaHandlers({ requireAuth: options?.requireAuth });
  return await handlers.GET(
    new Request(`https://site.test/api/media/${mediaId}/raw`),
    { params: Promise.resolve({ path: [mediaId, "raw"] }) }
  );
}

function storedAs(mimeType: string): void {
  mocks.mediaService.findById.mockResolvedValue({
    id: "m1",
    filename: "2026/04/face.woff2",
    mimeType,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.storage.read.mockResolvedValue(Buffer.from("OTTO-bytes"));
});

describe("the public byte route", () => {
  it("serves a woff2 with its own content type", async () => {
    storedAs("font/woff2");
    const response = await getRaw("m1");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("font/woff2");
    expect(await response.text()).toBe("OTTO-bytes");
  });

  it("REFUSES a type outside the servable set, and says nothing about it", async () => {
    /*
     * The security property the whole design rests on. The route is reachable
     * with no session, so if the mime gate stopped working, every stored
     * object — a private PDF among them — would be readable by id.
     *
     * 404 rather than 403, because 403 answers the question "is there a record
     * here?", which is the question an anonymous caller must not be able to ask.
     * And the storage read must not happen at all: a route that fetched the
     * bytes and then declined to send them would still have paid for them.
     */
    storedAs("application/pdf");
    const response = await getRaw("m1");

    expect(response.status).toBe(404);
    expect(response.status).not.toBe(403);
    expect(mocks.storage.read).not.toHaveBeenCalled();
    expect(await response.text()).toBe("");
  });

  it("serves the font on a GATED mount, with no session", async () => {
    /*
     * The reason this route sits before the gate. A browser fetching a font
     * sends no credentials, so a gated font route answers 401 and the page
     * silently renders in a fallback face — a failure nobody sees in review,
     * on exactly the installs that locked media down on purpose.
     *
     * Asserted on `requirePermission` never being consulted, because a 200
     * alone would also be produced by a permission mock that happened to allow.
     */
    storedAs("font/woff2");
    const response = await getRaw("m1", { requireAuth: true });

    expect(response.status).toBe(200);
    expect(mocks.requirePermission).not.toHaveBeenCalled();
  });

  it("answers 404 for a record that is not there", async () => {
    mocks.mediaService.findById.mockRejectedValue(
      NextlyError.notFound({ logContext: { entity: "media" } })
    );
    expect((await getRaw("gone")).status).toBe(404);
  });

  it("does NOT turn a lookup failure into 404", async () => {
    /*
     * An unreachable database has said nothing about whether the font exists,
     * and this response is cacheable for a year. Folding the two together lets
     * an outage be cached as a permanent absence long after it ended.
     *
     * Its control is the case above, which fails if absence stops reporting 404
     * at all; this one fails only when absence and failure are being folded.
     */
    mocks.mediaService.findById.mockRejectedValue(
      new Error("connection refused")
    );

    const outcome = await getRaw("m1").then(
      value => value,
      (error: unknown) => error
    );
    const status = outcome instanceof Response ? outcome.status : 500;
    expect(status).not.toBe(404);
  });
});
