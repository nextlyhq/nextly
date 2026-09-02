/**
 * That the published server action enforces the installation's upload policy.
 *
 * It reaches `ServiceContainer.media`, the LEGACY service, which never runs the
 * configured `UploadValidator` — so this entry point enforced no allowlist, no
 * magic-byte comparison and no sanitisation while the mounted REST handler
 * enforced all three. An install excluding a format through `security.uploads`
 * had that policy apply to one door and not the other, and what lands here is
 * retrievable through the anonymous byte route.
 *
 * A refusal returns before any service is constructed, so those cases need
 * nothing but the container. The cases that get PAST validation assert what
 * the media service was handed, since that is where storing the validator's
 * input rather than its output becomes observable.
 *
 * @module actions/upload-media.test
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { container } from "../di/container";
import { ServiceContainer } from "../services";

import type { UploadMediaInput } from "../types/media";

import { uploadMediaAction } from "./upload-media";

const TEST_USER_ID = "00000000-0000-4000-8000-000000000000";

/**
 * Replace the media service the action reaches, so what it was HANDED can be
 * asserted. The double is narrower than `LegacyMediaService` and answers the
 * one method the action calls, with the shape that method returns.
 *
 * It refuses, deliberately. A success sends the action on to `revalidatePath`,
 * which resolves `next/cache` through `createRequire` and is not available
 * here — so the refusal keeps the subject of these tests the arguments the
 * service received rather than a module the harness cannot supply.
 */
function stubMediaService() {
  // Typed from the real input, so what the assertions read is the shape the
  // service is actually handed rather than a literal restating it.
  const uploadMedia = vi.fn(async (_input: UploadMediaInput) => ({
    success: false as const,
    statusCode: 503,
    code: "STORAGE_UNAVAILABLE",
    message: "No storage in this harness.",
    data: null,
  }));
  container.registerSingleton("adapter", () => ({
    getCapabilities: () => ({ dialect: "sqlite" }),
  }));
  vi.spyOn(ServiceContainer.prototype, "media", "get").mockReturnValue({
    uploadMedia,
  } as unknown as ServiceContainer["media"]);
  return uploadMedia;
}

/** A drop carrying bytes and whatever type the client claimed. */
function upload(name: string, type: string, bytes: Buffer): FormData {
  const form = new FormData();
  // A view rather than the Buffer itself: `BlobPart` admits `Uint8Array`, and
  // a Buffer is one — but its `ArrayBufferLike` generic does not narrow to it.
  form.append("file", new Blob([new Uint8Array(bytes)], { type }), name);
  return form;
}

/**
 * A WOFF2 header a sniffer will actually identify: the magic, then the sfnt
 * flavor at offset 4 that a real file carries. Stopping at the four magic
 * bytes describes no font, and is refused for that reason — which would make
 * every refusal below ambiguous between the policy and the fixture.
 */
const WOFF2 = Buffer.concat([
  Buffer.from("wOF2", "ascii"),
  Buffer.from([0x00, 0x01, 0x00, 0x00]),
  Buffer.alloc(44),
]);

beforeEach(() => {
  container.clear();
});

afterEach(() => {
  container.clear();
  vi.restoreAllMocks();
});

describe("uploadMediaAction and the configured allowlist", () => {
  it("REFUSES a format the installation excluded", async () => {
    /*
     * The policy names images only. A font would previously have been inferred
     * from its name, stored by the legacy service without the allowlist being
     * consulted, and then served to any anonymous caller who knew its id.
     */
    container.registerSingleton("config", () => ({
      security: { uploads: { allowedMimeTypes: ["image/png"] } },
    }));

    const result = await uploadMediaAction(upload("Inter.woff2", "", WOFF2), {
      uploadedBy: TEST_USER_ID,
    });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  it("REFUSES content that is not the type it claims", async () => {
    /*
     * The magic-byte comparison this path also lacked. Both types are allowed
     * by the policy below, so only the BYTES can reject this.
     *
     * Real GIF magic under a PNG claim, and the fixture is chosen by
     * MEASUREMENT rather than by what looks like a mismatch:
     * `detectAndCompareMime` trusts whatever `file-type` cannot identify, and
     * `file-type` reads `GIF89a` but not a bare PNG signature. Text claiming
     * `image/png` therefore passes — a property of the sniffer, not of this
     * path, and a case built on it would prove nothing about the validation
     * being added here.
     */
    container.registerSingleton("config", () => ({
      security: { uploads: { allowedMimeTypes: ["image/png", "image/gif"] } },
    }));
    const gif = Buffer.concat([
      Buffer.from("GIF89a", "ascii"),
      Buffer.alloc(64),
    ]);

    const result = await uploadMediaAction(
      upload("photo.png", "image/png", gif),
      { uploadedBy: TEST_USER_ID }
    );

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  it("hands an allowed file to the media service", async () => {
    /*
     * The control, and it asserts an OUTCOME rather than the absence of one.
     * Both cases above are satisfied by an action that rejects everything,
     * including one that throws on its way to the validator — and a throw
     * returns 500, so "not 400" is a condition a broken allowed-file path
     * meets. What separates the two is the service being REACHED, which only
     * happens past validation.
     */
    container.registerSingleton("config", () => ({
      security: { uploads: { allowedMimeTypes: ["font/woff2"] } },
    }));
    const uploadMedia = stubMediaService();

    const result = await uploadMediaAction(upload("Inter.woff2", "", WOFF2), {
      uploadedBy: TEST_USER_ID,
    });

    expect(uploadMedia).toHaveBeenCalledTimes(1);
    // The stub's own refusal, so a 400 could only have come from the policy.
    expect(result.statusCode).toBe(503);
  });

  it("stores the SANITIZED bytes, not the ones that were uploaded", async () => {
    /*
     * `ValidatedFile.buffer` is the sanitized document for an SVG, so passing
     * the original to the service computes the safe copy and discards it —
     * leaving scripted markup in storage, reachable by URL.
     *
     * The script survives in the INPUT, which is what makes the assertion
     * about sanitisation rather than about an empty file: the same bytes are
     * asserted present on the way in and absent on the way out.
     */
    container.registerSingleton("config", () => ({
      security: { uploads: { allowedMimeTypes: ["image/svg+xml"] } },
    }));
    const uploadMedia = stubMediaService();
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      "utf8"
    );
    expect(svg.toString("utf8")).toContain("<script>");

    await uploadMediaAction(upload("logo.svg", "image/svg+xml", svg), {
      uploadedBy: TEST_USER_ID,
    });

    expect(uploadMedia).toHaveBeenCalledTimes(1);
    const stored = uploadMedia.mock.calls[0]?.[0];
    expect(stored?.file.toString("utf8")).not.toContain("<script>");
    // The row has to describe the bytes that were written, and sanitisation
    // changes their length.
    expect(stored?.size).toBe(stored?.file.length);
    expect(stored?.contentDisposition).toBe("attachment");
  });

  it("leaves the disposition alone when the install turned svgCsp off", async () => {
    /*
     * The other spelling of the same decision. `attachment` is conditional on
     * the flag the unified service reads, so an install that turned it off
     * must not have it applied here — a hard-coded disposition would satisfy
     * the case above and silently override the setting.
     */
    container.registerSingleton("config", () => ({
      security: {
        uploads: { allowedMimeTypes: ["image/svg+xml"], svgCsp: false },
      },
    }));
    const uploadMedia = stubMediaService();

    await uploadMediaAction(
      upload(
        "logo.svg",
        "image/svg+xml",
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', "utf8")
      ),
      { uploadedBy: TEST_USER_ID }
    );

    const stored = uploadMedia.mock.calls[0]?.[0];
    expect(stored?.contentDisposition).toBeUndefined();
  });
});
