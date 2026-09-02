/**
 * Fixtures shared by the media suites, following the `*-test-helpers.ts`
 * convention collections, field-groups and singles already use.
 *
 * @module domains/media/__tests__/media-test-helpers
 */

/**
 * Bytes that really are a PDF, with `marker` appended so fixtures stay distinct.
 *
 * 🔴 The configured upload policy compares a DECLARED type against the file's
 * own signature, and it now does so on every upload path rather than only the
 * mounted handler. Arbitrary text under a `.pdf` name is therefore refused as
 * `MAGIC_BYTE_MISMATCH` before anything is stored -- so a suite about cache
 * invalidation, or about webhook payloads, stopped reaching the behaviour it
 * asserts and failed on the upload that merely sets it up.
 *
 * A real signature rather than a looser declared type: the point of each
 * fixture is to get a row written, and naming a format whose signature the
 * policy knows is the cheapest way to do that without the suite taking a view
 * on validation it is not about.
 *
 * Shared rather than copied into each suite, because the next test to upload a
 * file needs the same thing and a second copy is a second answer to drift from.
 */
export function pdfBytes(marker: string): Buffer {
  return Buffer.from(`%PDF-1.4\n${marker}`, "utf8");
}
