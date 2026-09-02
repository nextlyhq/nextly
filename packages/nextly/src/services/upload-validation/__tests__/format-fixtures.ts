/**
 * Upload Validation — Byte Fixtures That Are Actually Their Format
 *
 * Each buffer below is a complete, minimal file that a magic-byte sniffer
 * identifies. That property is the reason this module exists: a fixture
 * stopping at the four-byte magic is not a file of that format, and validation
 * that requires content evidence refuses it — correctly, and for a reason
 * nothing about the test being written was meant to exercise.
 *
 * The failure without them is the quiet direction. An unidentifiable fixture
 * takes the "nothing was recognised" branch, so a test named for a matching
 * type passes without any comparison having happened, and goes on passing if
 * the comparison is removed.
 *
 * @module services/upload-validation/__tests__/format-fixtures
 */

/** A 1x1 PNG: signature, IHDR, IDAT and IEND. */
export const PNG_1X1: Buffer = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

/** A 1x1 JPEG, complete through its end-of-image marker. */
export const JPEG_1X1: Buffer = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEB/8AAEQgAAQABAwEiAAIRAQMRAf/EABUAAQEAAAAAAAAAAAAAAAAAAAAJ/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAAPwA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwA/",
  "base64"
);

/**
 * A WOFF2 header carrying the sfnt flavor at offset 4 that a real file has.
 * `wOF2` alone describes no font, and is identified as nothing.
 */
export const WOFF2_HEADER: Buffer = Buffer.concat([
  Buffer.from("wOF2", "ascii"),
  Buffer.from([0x00, 0x01, 0x00, 0x00]),
  Buffer.alloc(44),
]);

/**
 * HTML, which carries no signature at all — so a sniffer cannot identify it
 * under any claim, and it is the shape that reaches storage when silence from
 * the sniffer is read as agreement.
 */
export const HTML_DOCUMENT: Buffer = Buffer.from(
  "<!DOCTYPE html><html><body><script>alert(1)</script></body></html>",
  "utf8"
);
