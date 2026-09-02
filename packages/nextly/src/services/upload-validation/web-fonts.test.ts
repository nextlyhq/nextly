/**
 * That the boundaries agree, rather than that each one lists what it lists.
 *
 * Three places need the same answer — what may be uploaded, what the public
 * route will serve, what the browser lets a person drag — and a test per list
 * asserting its own literals passes happily while they disagree. What matters
 * is the relation between them, so that is what these assert.
 *
 * @module services/upload-validation/web-fonts.test
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_ALLOWED_MIME_TYPES } from "./mime";
import { resolveClaimedMimeType } from "./mime";
import {
  matchesWebFontSignature,
  WEB_FONT_FORMATS,
  WEB_FONT_MIME_TYPES,
  webFontMimeFromFilename,
} from "./web-fonts";

describe("the canonical web font table", () => {
  it("is not empty, and every entry carries both vocabularies", () => {
    // The population, asserted before anything is derived from it: an empty
    // table satisfies every "each entry is..." loop below by never running one.
    expect(WEB_FONT_FORMATS.length).toBeGreaterThan(0);
    for (const format of WEB_FONT_FORMATS) {
      expect(format.mimeType).toMatch(/^font\//);
      expect(format.extension.startsWith(".")).toBe(true);
    }
  });

  it("offers only formats that need no conversion", () => {
    /*
     * The control on the table itself. Nothing here converts TTF or OTF, so
     * admitting one would store and serve several times the bytes of the same
     * face with nothing reporting it.
     */
    expect(WEB_FONT_MIME_TYPES).not.toContain("font/ttf");
    expect(WEB_FONT_MIME_TYPES).not.toContain("font/otf");
    expect(WEB_FONT_MIME_TYPES).not.toContain("application/font-sfnt");
  });
});

describe("the upload boundary", () => {
  it("accepts every format the table declares", () => {
    /*
     * A format the serving route hands out but the allowlist refuses is one an
     * author can never put there; the reverse leaves an upload nothing will
     * serve. Neither shows up in a test that reads one list on its own.
     */
    for (const mimeType of WEB_FONT_MIME_TYPES) {
      expect(DEFAULT_ALLOWED_MIME_TYPES).toContain(mimeType);
    }
  });

  it("does not accept a font format the table withholds", () => {
    // The control: an allowlist containing every font would satisfy the case
    // above while admitting the formats the table exists to exclude.
    expect(DEFAULT_ALLOWED_MIME_TYPES).not.toContain("font/ttf");
    expect(DEFAULT_ALLOWED_MIME_TYPES).not.toContain("font/otf");
  });
});

describe("inferring a font type from a filename", () => {
  it("names the canonical type for each format, whatever the case", () => {
    // Browsers report no type at all for a font chosen from disk, which is the
    // case this exists for — and the name they send keeps the author's casing.
    expect(webFontMimeFromFilename("Inter.woff2")).toBe("font/woff2");
    expect(webFontMimeFromFilename("Inter.WOFF2")).toBe("font/woff2");
    expect(webFontMimeFromFilename("Inter.woff")).toBe("font/woff");
  });

  it("names nothing for anything else", () => {
    /*
     * The control, and the security-relevant half: this fills in a claim the
     * caller did not make, so it must resolve for font names ONLY. Everything
     * else keeps whatever the caller sent, and the magic-byte check downstream
     * still compares that claim against the bytes.
     */
    expect(webFontMimeFromFilename("payload.ttf")).toBeUndefined();
    expect(webFontMimeFromFilename("archive.zip")).toBeUndefined();
    expect(webFontMimeFromFilename("woff2")).toBeUndefined();
    expect(webFontMimeFromFilename("")).toBeUndefined();
  });
});

/** Bytes that genuinely begin as the format they are named for. */
function fontBytes(signature: string): Buffer {
  return Buffer.concat([Buffer.from(signature, "ascii"), Buffer.alloc(32)]);
}

describe("resolving the type an upload claims", () => {
  it("keeps a real type the client sent, even for a font name", () => {
    /*
     * The control, and the fixture has to be a FONT name: with a name that
     * infers nothing, dropping the guard still returns what the caller sent, so
     * the case would pass against a resolver that overwrites every claim.
     *
     * A client that says `font/woff` about `Inter.woff2` is telling us
     * something the filename cannot — the extension is not the format, and the
     * BYTES here are a WOFF, so the claim is the true one.
     */
    expect(
      resolveClaimedMimeType("Inter.woff2", "font/woff", fontBytes("wOFF"))
    ).toBe("font/woff");
    expect(
      resolveClaimedMimeType("photo.png", "image/png", Buffer.from("png"))
    ).toBe("image/png");
  });

  it("fills in from the name when the client sent nothing", () => {
    expect(resolveClaimedMimeType("Inter.woff2", "", fontBytes("wOF2"))).toBe(
      "font/woff2"
    );
    expect(
      resolveClaimedMimeType("Inter.woff2", "   ", fontBytes("wOF2"))
    ).toBe("font/woff2");
  });

  it("fills in for the generic type, however it is spelled", () => {
    /*
     * Multipart clients send `application/octet-stream` for a format they
     * cannot name, and mime tokens are case-insensitive — an exact comparison
     * skips the fallback and the allowlist then refuses a font the name could
     * have identified.
     */
    expect(
      resolveClaimedMimeType(
        "Inter.woff2",
        "application/octet-stream",
        fontBytes("wOF2")
      )
    ).toBe("font/woff2");
    expect(
      resolveClaimedMimeType(
        "Inter.woff2",
        "Application/Octet-Stream",
        fontBytes("wOF2")
      )
    ).toBe("font/woff2");
  });

  it("leaves a generic type alone when the name says nothing", () => {
    // Absence of a font name is not licence to invent one; the value the caller
    // sent survives and the allowlist judges it as before.
    expect(
      resolveClaimedMimeType(
        "payload.bin",
        "application/octet-stream",
        Buffer.from("bin")
      )
    ).toBe("application/octet-stream");
  });
});

describe("checking a font claim against the bytes", () => {
  it("accepts each format's own signature", () => {
    for (const format of WEB_FONT_FORMATS) {
      const bytes = Buffer.concat([
        Buffer.from(format.signature, "ascii"),
        Buffer.alloc(32),
      ]);
      expect(matchesWebFontSignature(bytes, format.mimeType)).toBe(true);
    }
  });

  it("refuses content that is not the font it claims to be", () => {
    expect(
      matchesWebFontSignature(Buffer.from("not-a-font"), "font/woff2")
    ).toBe(false);
    // And a WOFF is not a WOFF2: the signatures differ, and serving one as the
    // other hands a browser a file it cannot parse.
    const woff = Buffer.concat([
      Buffer.from("wOFF", "ascii"),
      Buffer.alloc(32),
    ]);
    expect(matchesWebFontSignature(woff, "font/woff2")).toBe(false);
    expect(matchesWebFontSignature(woff, "font/woff")).toBe(true);
  });

  it("says nothing about a type that is not a web font", () => {
    // The control: a checker refusing everything would satisfy the case above
    // while rejecting every image in the product.
    expect(
      matchesWebFontSignature(Buffer.from("<svg/>"), "image/svg+xml")
    ).toBe(true);
  });
});

describe("a font claim under an older spelling", () => {
  it("comes back canonical, so the allowlist recognises it", () => {
    /*
     * Some operating systems and multipart libraries still report the pre-IANA
     * names. Such a claim is not generic, so nothing falls back to the
     * filename, and the allowlist — which knows one name per format — refuses a
     * font this product accepts under its other spelling.
     */
    for (const format of WEB_FONT_FORMATS) {
      expect(format.aliases.length).toBeGreaterThan(0);
      for (const alias of format.aliases) {
        expect(
          resolveClaimedMimeType(
            `Inter${format.extension}`,
            alias,
            fontBytes(format.signature)
          )
        ).toBe(format.mimeType);
      }
    }
  });

  it("still answers to the bytes under the older spelling", () => {
    /*
     * The control. Canonicalising a name must not become a way to launder
     * content: an alias is a claim like any other and the signature decides.
     */
    expect(
      resolveClaimedMimeType(
        "Evil.woff",
        "application/x-font-woff",
        Buffer.from("not-a-font")
      )
    ).toBe("");
  });

  it("leaves a type that is not a font alias alone", () => {
    // A second control: a canonicaliser that rewrote everything would satisfy
    // both cases above while renaming every upload in the product.
    expect(
      resolveClaimedMimeType("photo.png", "image/png", Buffer.from("png"))
    ).toBe("image/png");
  });
});

describe("the inference answers to the bytes", () => {
  it("refuses an EXPLICIT font claim the bytes do not support", () => {
    /*
     * Platforms that register these formats send `font/woff2` themselves, so an
     * explicit claim reaches the same anonymous route with the same bytes — the
     * only difference being who typed the string. The caller that most needs
     * this has no validator behind it: the published server action reaches the
     * legacy service, which persists the type it is handed.
     */
    expect(
      resolveClaimedMimeType("Evil.woff2", "font/woff2", Buffer.from("nope"))
    ).toBe("");
    // A real font sent with its real type is untouched — the control, since a
    // rule refusing every font claim would satisfy the case above.
    expect(
      resolveClaimedMimeType("Inter.woff2", "font/woff2", fontBytes("wOF2"))
    ).toBe("font/woff2");
  });

  it("leaves a NON-font claim alone whatever the bytes are", () => {
    // The bytes are only this module's business for the formats it declares;
    // an image claim is somebody else's check and must pass through untouched.
    expect(
      resolveClaimedMimeType("photo.png", "image/png", Buffer.from("nope"))
    ).toBe("image/png");
  });

  it("refuses to name a font when the content is not one", () => {
    /*
     * The inference invents a claim nobody made, and not every upload path runs
     * a magic-byte comparison afterwards — the published server action reaches
     * the legacy service, which does not. So a name alone would let anything
     * called `.woff2` acquire a type the public route serves to anonymous
     * callers as an immutable asset. The proof travels with the inference.
     */
    expect(
      resolveClaimedMimeType("Evil.woff2", "", Buffer.from("not-a-font"))
    ).toBe("");
    expect(
      resolveClaimedMimeType(
        "Evil.woff2",
        "application/octet-stream",
        Buffer.from("not-a-font")
      )
    ).toBe("application/octet-stream");
  });

  it("still names a real font", () => {
    // The control: a resolver refusing everything would satisfy the case above
    // while making font uploads impossible.
    expect(resolveClaimedMimeType("Inter.woff2", "", fontBytes("wOF2"))).toBe(
      "font/woff2"
    );
    expect(resolveClaimedMimeType("Inter.woff", "", fontBytes("wOFF"))).toBe(
      "font/woff"
    );
  });
});
