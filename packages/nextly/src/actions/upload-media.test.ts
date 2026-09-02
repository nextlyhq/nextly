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
 * The cases below assert REFUSALS only, deliberately: a refusal returns before
 * any service is constructed or `next/cache` is resolved, so the harness needs
 * nothing but the container and stays honest about what it exercises.
 *
 * @module actions/upload-media.test
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { container } from "../di/container";

import { uploadMediaAction } from "./upload-media";

const TEST_USER_ID = "00000000-0000-4000-8000-000000000000";

/** A drop carrying bytes and whatever type the client claimed. */
function upload(name: string, type: string, bytes: Buffer): FormData {
  const form = new FormData();
  // A view rather than the Buffer itself: `BlobPart` admits `Uint8Array`, and
  // a Buffer is one — but its `ArrayBufferLike` generic does not narrow to it.
  form.append("file", new Blob([new Uint8Array(bytes)], { type }), name);
  return form;
}

/** Real WOFF2 bytes, so a refusal is never merely a signature mismatch. */
const WOFF2 = Buffer.concat([Buffer.from("wOF2", "ascii"), Buffer.alloc(48)]);

beforeEach(() => {
  container.clear();
});

afterEach(() => {
  container.clear();
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

  it("does not refuse a file the policy allows, for lack of a policy", async () => {
    /*
     * The control, and it has to be here: both cases above are satisfied by an
     * action that rejects everything — including by throwing before it reaches
     * the validator at all. This one gets PAST validation, so it fails on the
     * service the harness deliberately does not provide rather than on the
     * policy, which is the only way to tell "refused by policy" from "refused
     * because nothing works".
     */
    container.registerSingleton("config", () => ({
      security: { uploads: { allowedMimeTypes: ["font/woff2"] } },
    }));

    const result = await uploadMediaAction(upload("Inter.woff2", "", WOFF2), {
      uploadedBy: TEST_USER_ID,
    });

    // Not the validator's 400 — it got past the policy and fell over further in.
    expect(result.statusCode).not.toBe(400);
  });
});
