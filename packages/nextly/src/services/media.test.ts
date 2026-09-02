/**
 * That the media writer refuses by the installation's cap, not by its own.
 *
 * This service performs the size check before it touches the adapter or the
 * storage backend, so the cases below construct it with neither: what is being
 * asserted is which NUMBER it refuses against, and reaching a database would
 * only add ways for the test to fail for other reasons.
 *
 * It matters because this writer sits UNDER the validator on every path — the
 * unified service wraps it, and the published server action calls it directly.
 * A cap of its own therefore refuses, from the inside, a file the configured
 * policy has already allowed, and reports a limit the install never set.
 *
 * @module services/media.test
 */
import { describe, expect, it } from "vitest";

import { PNG_1X1 } from "./upload-validation/__tests__/format-fixtures";

import { MediaService as LegacyMediaService } from "./media";

const silentLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const TWELVE_MB = 12 * 1024 * 1024;
const TWENTY_MB = 20 * 1024 * 1024;

/** The writer as its constructors build it, carrying a configured cap. */
function writerWithCap(maxUploadBytes: number | undefined) {
  return new LegacyMediaService(
    {} as never,
    silentLogger as never,
    undefined,
    undefined,
    maxUploadBytes
  );
}

describe("LegacyMediaService.uploadMedia and the configured size cap", () => {
  it("accepts a file the installation's cap allows", async () => {
    const result = await writerWithCap(TWENTY_MB).uploadMedia({
      file: PNG_1X1,
      filename: "big.png",
      mimeType: "image/png",
      size: TWELVE_MB,
      uploadedBy: null,
    });

    /*
     * Past the size gate. What it fails on afterwards is the storage this
     * harness deliberately does not provide — which is the only way to tell
     * "allowed by the cap" from "refused by something else", since a service
     * that refused everything would satisfy a bare `not 400`.
     */
    expect(result.statusCode).not.toBe(400);
  });

  it("refuses a file past that cap, naming the configured limit", async () => {
    const result = await writerWithCap(TWENTY_MB).uploadMedia({
      file: PNG_1X1,
      filename: "huge.png",
      mimeType: "image/png",
      size: 21 * 1024 * 1024,
      uploadedBy: null,
    });

    expect(result.statusCode).toBe(400);
    // The install's number, not this module's default.
    expect(result.message).toContain("20MB");
  });

  it("falls back to the built-in cap when none was supplied", async () => {
    /*
     * The control for both cases above: without it they are also satisfied by
     * a writer that stopped checking sizes altogether.
     */
    const result = await writerWithCap(undefined).uploadMedia({
      file: PNG_1X1,
      filename: "big.png",
      mimeType: "image/png",
      size: TWELVE_MB,
      uploadedBy: null,
    });

    expect(result.statusCode).toBe(400);
    expect(result.message).toContain("10MB");
  });
});
