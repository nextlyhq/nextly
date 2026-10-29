/**
 * An upload keeps the alt text it is given.
 *
 * `nextly.media.upload({ file, altText })` stored every file with no alt text:
 * the unified media service passed the upload on without it, and the insert
 * wrote `null` whatever it was handed. Anything that needs alt text on a new
 * file — the blog template's posts refuse a featured image without one — had
 * nothing to read. These read the stored row back.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";
import { pdfDocument } from "../../services/upload-validation/__tests__/format-fixtures";
import { Nextly } from "../nextly";

const PDF = pdfDocument("alt-text");

function file(name: string) {
  return { data: PDF, name, mimetype: "application/pdf", size: PDF.length };
}

describe.each(getConfiguredTestDialects())(
  "an upload's alt text (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let nextly: Nextly;

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
      });
      nextly = new Nextly();
    });

    afterAll(async () => {
      await t?.destroy();
    });

    it("is stored with the file and read back from it", async () => {
      const uploaded = await nextly.media.upload({
        file: file("described.pdf"),
        altText: "A lighthouse at dusk",
      });

      expect(uploaded.altText).toBe("A lighthouse at dusk");
      // From the row, not only from what the upload answered.
      expect((await nextly.media.findByID({ id: uploaded.id }))?.altText).toBe(
        "A lighthouse at dusk"
      );
    });

    it("is stored as the sanitizer leaves it, without markup", async () => {
      const uploaded = await nextly.media.upload({
        file: file("marked-up.pdf"),
        altText: "<b>A lighthouse</b> at dusk",
      });

      expect((await nextly.media.findByID({ id: uploaded.id }))?.altText).toBe(
        "A lighthouse at dusk"
      );
    });

    it("is empty when the upload gives none", async () => {
      const uploaded = await nextly.media.upload({ file: file("plain.pdf") });

      expect(
        (await nextly.media.findByID({ id: uploaded.id }))?.altText ?? null
      ).toBeNull();
    });
  }
);
