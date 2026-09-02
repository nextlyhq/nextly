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

import { WEB_FONT_MIME_TYPES } from "../services/upload-validation/web-fonts";

import { createMediaHandlers } from "./media-handlers";
import { PUBLIC_SERVE_MIME_TYPES } from "./media-raw";

const mocks = vi.hoisted(() => ({
  mediaService: { findById: vi.fn() },
  /*
   * The ADAPTER is the thing that can read. Kept separate from the manager
   * below, and the manager deliberately has NO `read` and NO `getPublicUrl`,
   * because the real one has neither — an earlier double carried both and so
   * passed while the route handed the manager over and could not serve a byte
   * on any backend.
   */
  adapter: { read: vi.fn(), getPublicUrl: vi.fn() },
  manager: { getAdapterForCollection: vi.fn() },
  safeFetch: vi.fn(),
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
  getMediaStorage: vi.fn(() => mocks.manager),
}));

/*
 * The URL fallback is only reached when the adapter cannot answer, which is one
 * case below. Partial, so `SafeFetchError` stays real — the classifier the
 * fallback runs keys on `instanceof`.
 */
vi.mock("../utils/validate-external-url", async importOriginal => {
  const actual =
    await importOriginal<typeof import("../utils/validate-external-url")>();
  return { ...actual, safeFetch: mocks.safeFetch };
});

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

/** Bytes that genuinely begin as a WOFF2, which the route now requires. */
const WOFF2_BYTES = Buffer.concat([
  Buffer.from("wOF2", "ascii"),
  Buffer.alloc(48),
]);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.manager.getAdapterForCollection.mockReturnValue(mocks.adapter);
  mocks.adapter.read.mockResolvedValue(WOFF2_BYTES);
});

describe("the public byte route", () => {
  it("serves a woff2 with its own content type", async () => {
    storedAs("font/woff2");
    const response = await getRaw("m1");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("font/woff2");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array(WOFF2_BYTES)
    );
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
    expect(mocks.adapter.read).not.toHaveBeenCalled();
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

  it("reads through the media collection's ADAPTER, not the manager", async () => {
    /*
     * The manager routes to an adapter and cannot read; it also needs the
     * collection to choose one, so `getPublicUrl` called without it answers
     * from the local default and yields a relative path `safeFetch` refuses.
     * Handing the manager over therefore fails on EVERY backend — which the
     * previous double concealed by implementing `read` itself.
     *
     * Asserted on the collection as well as on the bytes: an install routing
     * media to S3 while everything else stays local gets the wrong backend
     * from an omitted argument, and the bytes alone cannot show that.
     */
    storedAs("font/woff2");
    const response = await getRaw("m1");

    expect(response.status).toBe(200);
    expect(mocks.manager.getAdapterForCollection).toHaveBeenCalledWith("media");
    expect(mocks.adapter.read).toHaveBeenCalled();
  });

  it("serves a font whose stored type is spelled in another case", async () => {
    /*
     * `validateMimeType` lowercases what it compares and the record keeps what
     * the client sent, so `Font/WOFF2` is accepted on upload and stored with
     * that spelling. An exact lookup here would refuse to serve a font this
     * same product had just approved.
     */
    storedAs("Font/WOFF2");
    expect((await getRaw("m1")).status).toBe(200);
  });

  it("answers 404 when the row outlived its stored object", async () => {
    /*
     * The adapter says the object is gone while the record remains. From
     * outside these are the same thing — there is no font here — and the
     * alternative is a 502 telling a visitor to retry a file that will never
     * return, cached for a year by the header this route sets.
     */
    storedAs("font/woff2");
    mocks.adapter.read.mockResolvedValue(null);
    mocks.adapter.getPublicUrl.mockReturnValue("https://cdn.test/f.woff2");
    mocks.safeFetch.mockResolvedValue(new Response("gone", { status: 404 }));

    const response = await getRaw("m1");
    expect(response.status).toBe(404);
    // NOT 502: an outage tells a visitor to retry, and this response is
    // cacheable for a year.
    expect(response.status).not.toBe(502);
  });

  it("REFUSES a row whose stored type is not what its bytes are", async () => {
    /*
     * The row's MIME type is the whole of this route's access control, and that
     * metadata was not always trustworthy: the published server action reaches
     * the legacy service, which persisted whatever type a client sent without
     * comparing it to the content. An installation upgrading into this feature
     * can already hold a row labelled `font/woff2` carrying anything, and the
     * upload-side check does not reach back and rewrite it.
     *
     * Its control is the serving case above, which fails if the route stops
     * serving fonts at all; this one fails only when the label is trusted.
     */
    storedAs("font/woff2");
    mocks.adapter.read.mockResolvedValue(Buffer.from("not-a-font", "utf8"));

    const response = await getRaw("m1");
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });

  it("serves a row stored under a LEGACY font type", async () => {
    /*
     * Rows predating the upload-side canonicalisation carry the older spelling,
     * and nothing rewrites them — an exact lookup refuses a font this product
     * has served since before it knew the canonical name.
     */
    storedAs("application/font-woff");
    mocks.adapter.read.mockResolvedValue(
      Buffer.concat([Buffer.from("wOFF", "ascii"), Buffer.alloc(48)])
    );

    const response = await getRaw("m1");
    expect(response.status).toBe(200);
    // Served under the name a browser expects, not the one the row happens to
    // carry.
    expect(response.headers.get("Content-Type")).toBe("font/woff");
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

describe("the serving boundary", () => {
  it("serves exactly what the canonical table declares", () => {
    /*
     * Both directions, because they fail differently. A format in the table but
     * not here is one an author can upload and never serve; one here but not in
     * the table makes every stored object of that type world readable by id,
     * which is the direction nobody notices.
     */
    expect([...PUBLIC_SERVE_MIME_TYPES].sort()).toEqual(
      [...WEB_FONT_MIME_TYPES].sort()
    );
    expect(PUBLIC_SERVE_MIME_TYPES.size).toBeGreaterThan(0);
  });
});
