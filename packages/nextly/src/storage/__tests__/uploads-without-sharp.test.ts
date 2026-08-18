/**
 * An install without sharp still accepts uploads.
 *
 * Image processing is optional; storing what a user uploaded is not. The real
 * upload gate is magic-byte based (`services/upload-validation/`) and never
 * used sharp, so degrading here weakens no security control.
 *
 * The defect this pins: `isValidImage` was `catch { return false }`, and the
 * upload route rejects on `false` with "Invalid image file". A missing library
 * therefore produced a verdict about the USER'S FILE. Two states cannot carry
 * three outcomes, so "could not check" needs its own value.
 */
import { describe, expect, it } from "vitest";

import { ImageProcessor, refusesUpload } from "../image-processor";

/** An ImageProcessor whose loader can never find the library. */
function withoutSharp() {
  return new ImageProcessor({ loader: () => Promise.resolve(null) });
}

/** The same class with the real library, as the control. */
function withSharp() {
  return new ImageProcessor();
}

const NOT_AN_IMAGE = Buffer.from("this is plainly not an image");

describe("image processing when sharp is absent", () => {
  it("reports that it cannot process", async () => {
    await expect(withoutSharp().canProcess()).resolves.toBe(false);
  });

  it("answers 'unknown' for validity rather than 'invalid'", async () => {
    // The separating property. `invalid` is a claim about the file and makes
    // the upload route refuse it; `unknown` says the check did not run.
    await expect(withoutSharp().isValidImage(NOT_AN_IMAGE)).resolves.toBe(
      "unknown"
    );
  });

  it("returns no dimensions instead of throwing", async () => {
    await expect(
      withoutSharp().getDimensions(NOT_AN_IMAGE)
    ).resolves.toBeNull();
  });

  it("skips the thumbnail instead of throwing", async () => {
    await expect(
      withoutSharp().generateThumbnail(NOT_AN_IMAGE)
    ).resolves.toBeNull();
  });

  it("skips a configured resize instead of throwing", async () => {
    await expect(
      withoutSharp().resize(NOT_AN_IMAGE, 100, 100)
    ).resolves.toBeNull();
  });
});

describe("image processing when sharp is present", () => {
  // The CONTROL. Without it, every assertion above is satisfied by a class
  // that can never process anything, and the degraded path would look correct
  // while the real one was broken.
  it("reports that it can process", async () => {
    await expect(withSharp().canProcess()).resolves.toBe(true);
  });

  it("still calls a non-image 'invalid' rather than 'unknown'", async () => {
    // This is what proves the three states are distinguished by the LIBRARY's
    // verdict rather than by its absence.
    await expect(withSharp().isValidImage(NOT_AN_IMAGE)).resolves.toBe(
      "invalid"
    );
  });
});

describe("what may refuse an upload", () => {
  it("refuses only a positive finding that the file is not an image", () => {
    expect(refusesUpload("invalid")).toBe(true);
  });

  it("does not refuse when this install could not check", () => {
    // The defect this whole three-state type exists for. Refusing here returns
    // a 400 blaming the user's file for a package missing from the server,
    // and the magic-byte gate has already accepted the upload.
    expect(refusesUpload("unknown")).toBe(false);
  });

  it("does not refuse a valid image", () => {
    expect(refusesUpload("valid")).toBe(false);
  });
});
