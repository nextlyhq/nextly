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

/** One Ogg page carrying `codec` as its first payload bytes. */
function oggPage(codec: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from("OggS", "ascii"),
    // Stream structure version, then the begin-of-stream header type.
    Buffer.from([0x00, 0x02]),
    // Granule position, bitstream serial, page sequence, CRC.
    Buffer.alloc(20),
    // One segment, 19 bytes long.
    Buffer.from([0x01, 0x13]),
    codec,
    Buffer.alloc(11),
  ]);
}

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

/** The same header for WOFF, whose magic differs from WOFF2's. */
export const WOFF_HEADER: Buffer = Buffer.concat([
  Buffer.from("wOFF", "ascii"),
  Buffer.from([0x00, 0x01, 0x00, 0x00]),
  Buffer.alloc(44),
]);

/**
 * One Ogg page whose codec identifier sits where the container puts it: the
 * 27-byte page header plus a one-entry segment table, then `OpusHead`.
 *
 * A sniffer names this `audio/ogg; codecs=opus` — the same media type an
 * `.ogg` upload claims, carrying a parameter that says which codec is inside.
 */
export const OGG_OPUS: Buffer = oggPage(Buffer.from("OpusHead", "ascii"));

/**
 * The same container holding Vorbis, which a sniffer names `audio/ogg` with no
 * parameter. The control for the case above: it passes a whole-string
 * comparison, so only the Opus page can show one being wrong.
 */
export const OGG_VORBIS: Buffer = oggPage(
  Buffer.from([0x01, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73])
);

/**
 * A PDF, complete enough to be recognised as one: the header carries the
 * signature, and a trailing comment makes each copy distinguishable without
 * making it a different format.
 *
 * `%` opens a comment in PDF syntax, so `marker` can be anything a caller
 * needs to tell two uploads apart.
 *
 * @param marker - Text distinguishing this copy from another
 */
export function pdfDocument(marker = ""): Buffer {
  return Buffer.from(`%PDF-1.4\n%${marker}\n%%EOF\n`, "ascii");
}

/**
 * HTML, which carries no signature at all — so a sniffer cannot identify it
 * under any claim, and it is the shape that reaches storage when silence from
 * the sniffer is read as agreement.
 */
export const HTML_DOCUMENT: Buffer = Buffer.from(
  "<!DOCTYPE html><html><body><script>alert(1)</script></body></html>",
  "utf8"
);
