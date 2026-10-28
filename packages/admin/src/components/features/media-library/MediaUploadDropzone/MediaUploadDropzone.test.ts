import { describe, it, expect } from "vitest";

import { DEFAULT_ACCEPTED_FORMATS, WEB_FONT_FORMATS } from "nextly/config";

import {
  describeFileError,
  parseAcceptString,
  DEFAULT_ACCEPTED_FILE_TYPES,
  getAcceptDescription,
} from "./upload-limits";
import { sortDroppedFiles } from "./useMediaFileDrop";

const MB = 1024 * 1024;

function makeFile(name: string, size: number): File {
  const file = new File(["x"], name, { type: "image/png" });
  // File size is read-only; tests only need the reported value, not content.
  Object.defineProperty(file, "size", { value: size });
  return file;
}

describe("describeFileError", () => {
  it("maps file-too-large to human copy with the formatted limit", () => {
    const message = describeFileError(
      { code: "file-too-large", message: "File is larger than 5242880 bytes" },
      5 * MB
    );
    expect(message).toBe("File is too large (max 5 MB)");
    expect(message).not.toContain("bytes");
  });

  it("maps file-invalid-type to human copy", () => {
    expect(
      describeFileError(
        { code: "file-invalid-type", message: "File type must be image/*" },
        5 * MB
      )
    ).toBe("File type is not supported");
  });

  it("falls through to the library message for unknown codes", () => {
    expect(
      describeFileError(
        { code: "custom-check", message: "Custom reason" },
        5 * MB
      )
    ).toBe("Custom reason");
  });
});

describe("sortDroppedFiles", () => {
  it("sends every accepted file and gives every refusal its reason", () => {
    const accepted = Array.from({ length: 9 }, (_, i) =>
      makeFile(`small-${i + 1}.png`, 100)
    );
    const rejections = [
      {
        file: makeFile("big.png", 7 * MB),
        errors: [
          {
            code: "file-too-large",
            message: "File is larger than 5242880 bytes",
          },
        ],
      },
    ];

    const { accepted: toSend, refused } = sortDroppedFiles(
      accepted,
      rejections,
      5 * MB
    );

    expect(toSend).toEqual(accepted);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({
      file: rejections[0].file,
      reason: "File is too large (max 5 MB)",
    });
  });

  // There is no cap on a drop: what used to be skipped past the tenth file
  // is sent, and the queue paces it.
  it("takes a drop of any size whole", () => {
    const accepted = Array.from({ length: 14 }, (_, i) =>
      makeFile(`file-${i + 1}.png`, 100)
    );

    const { accepted: toSend, refused } = sortDroppedFiles(
      accepted,
      [],
      5 * MB
    );

    expect(toSend).toHaveLength(14);
    expect(refused).toHaveLength(0);
  });

  it("sends nothing for an all-refused drop", () => {
    const rejections = [
      {
        file: makeFile("bad.exe", 100),
        errors: [{ code: "file-invalid-type", message: "" }],
      },
    ];

    const { accepted, refused } = sortDroppedFiles([], rejections, 5 * MB);

    expect(accepted).toHaveLength(0);
    expect(refused).toHaveLength(1);
    expect(refused[0].reason).toBe("File type is not supported");
  });

  it("joins multiple refusal reasons on one row", () => {
    const rejections = [
      {
        file: makeFile("bad.bmp", 20 * MB),
        errors: [
          { code: "file-invalid-type", message: "" },
          { code: "file-too-large", message: "" },
        ],
      },
    ];

    const { refused } = sortDroppedFiles([], rejections, 10 * MB);
    expect(refused[0].reason).toBe(
      "File type is not supported, File is too large (max 10 MB)"
    );
  });
});

describe("the default accept map", () => {
  /*
   * React Dropzone rejects a file whose type is absent from this map as
   * `file-invalid-type`, in the browser, before any request is made — so a
   * server allowlist that accepts a font is inert on its own. The upload an
   * author actually performs is the one gated here.
   */
  it("accepts the web font formats, by type AND by extension", () => {
    expect(DEFAULT_ACCEPTED_FILE_TYPES).toHaveProperty("font/woff2");
    expect(DEFAULT_ACCEPTED_FILE_TYPES).toHaveProperty("font/woff");
    // Both halves matter: some browsers report no type for a `.woff2` chosen
    // from disk, and Dropzone then matches on the extension instead.
    expect(DEFAULT_ACCEPTED_FILE_TYPES["font/woff2"]).toContain(".woff2");
    expect(DEFAULT_ACCEPTED_FILE_TYPES["font/woff"]).toContain(".woff");
  });

  it("does NOT accept a font format the server refuses", () => {
    /*
     * The control. A map that accepted every font would satisfy the case above
     * while letting an author drop a 4x larger TTF that the server then
     * refuses — a rejection they only see after the upload, explained by
     * nothing they can act on.
     */
    expect(DEFAULT_ACCEPTED_FILE_TYPES).not.toHaveProperty("font/ttf");
    expect(DEFAULT_ACCEPTED_FILE_TYPES).not.toHaveProperty("font/otf");
  });

  it("names EVERY accepted extension in the copy an author reads", () => {
    /*
     * Derived from the map rather than checked against a list written here,
     * which is the only version that cannot drift: an earlier form asserted
     * "WOFF2" alone and passed while the copy omitted WOFF, the very format
     * the map had just gained.
     *
     * So the assertion enumerates the MAP. A format added there and forgotten
     * in the description fails this without anyone editing the test.
     */
    const description = getAcceptDescription(undefined, 10 * MB).toLowerCase();
    const extensions = Object.values(DEFAULT_ACCEPTED_FILE_TYPES).flat();

    // The population, asserted before the verdict: an empty map would satisfy
    // a loop that never runs, and read as every format being named.
    expect(extensions.length).toBeGreaterThan(0);
    for (const extension of extensions) {
      // Case-insensitive, because the property is that the format is NAMED —
      // some carry their own spelling (WebP) rather than plain capitals.
      expect(description).toContain(extension.replace(/^\./, "").toLowerCase());
    }
  });

  it("names no format the map does not accept", () => {
    /*
     * The control. The case above is satisfied by a description listing every
     * format in existence, which would tell an author a TTF is welcome and let
     * the server refuse it after the upload.
     */
    const description = getAcceptDescription(undefined, 10 * MB).toLowerCase();
    expect(description).not.toContain("ttf");
    expect(description).not.toContain("otf");
  });
});

describe("the browser boundary", () => {
  it("offers every format the server accepts, and none it refuses", () => {
    /*
     * The two lists disagreed each way and neither side could see it. The map
     * offered AVI and MOV, which the allowlist refuses — so an author read that
     * AVI was supported, dragged one, and the upload was rejected. It withheld
     * AVIF, SVG, WebM and every audio format, which the allowlist accepts — so
     * files the server wanted could not be dragged at all.
     *
     * A format counts as offered by its exact type OR by its family wildcard,
     * because the wildcard is deliberate: an install adding `image/heic`
     * through `additionalMimeTypes` is accepted by the server, and an
     * exact-only map built from this build's defaults would refuse it in the
     * browser before a request existed. What the wildcard must still carry is
     * the SUFFIX, since a browser reporting no type has nothing else to match.
     */
    expect(DEFAULT_ACCEPTED_FORMATS.length).toBeGreaterThan(0);

    for (const format of DEFAULT_ACCEPTED_FORMATS) {
      const family = `${format.mimeType.split("/")[0] ?? ""}/*`;
      const offered =
        DEFAULT_ACCEPTED_FILE_TYPES[format.mimeType] ??
        DEFAULT_ACCEPTED_FILE_TYPES[family];

      expect(offered).toBeDefined();
      for (const extension of format.extensions) {
        expect(offered).toContain(extension);
      }
    }

    /*
     * And nothing offered that the server refuses. A family wildcard passes
     * because the server is the authority on what that family contains; an
     * EXACT type must be one the allowlist names, which is what caught AVI.
     */
    for (const [offered, extensions] of Object.entries(
      DEFAULT_ACCEPTED_FILE_TYPES
    )) {
      if (offered.endsWith("/*")) {
        const family = offered.slice(0, -1);
        for (const extension of extensions) {
          expect(
            DEFAULT_ACCEPTED_FORMATS.some(
              format =>
                format.mimeType.startsWith(family) &&
                format.extensions.includes(extension)
            )
          ).toBe(true);
        }
        continue;
      }
      expect(
        DEFAULT_ACCEPTED_FORMATS.some(format => format.mimeType === offered)
      ).toBe(true);
    }
  });

  it("lets a person drag every format the server accepts", () => {
    /*
     * The map decides in the BROWSER, before any request exists, so a format
     * the server accepts and this map omits is one nobody can upload — and no
     * server-side test can see it. Enumerated from the shared table rather than
     * from a list written here, which is what makes it fail when the table
     * gains a format and this map is forgotten.
     */
    expect(WEB_FONT_FORMATS.length).toBeGreaterThan(0);
    for (const format of WEB_FONT_FORMATS) {
      expect(DEFAULT_ACCEPTED_FILE_TYPES).toHaveProperty(format.mimeType);
      expect(DEFAULT_ACCEPTED_FILE_TYPES[format.mimeType]).toContain(
        format.extension
      );
    }
  });
});

describe("an explicit accept filter", () => {
  it("carries the extension for a font type it names", () => {
    /*
     * An upload field or picker can pass `accept="font/woff2"`. Without the
     * extension the entry is `{ "font/woff2": [] }`, and a browser reporting an
     * empty `type` for that same file then matches neither the type nor a
     * suffix — so the explicit filter refuses the very format it names, while
     * the default map accepts it.
     */
    for (const format of WEB_FONT_FORMATS) {
      const parsed = parseAcceptString(format.mimeType);
      expect(parsed?.[format.mimeType]).toContain(format.extension);
    }
  });

  it("carries every font extension for a WILDCARD font filter", () => {
    /*
     * `accept="font/*"` names every format this product serves, and the
     * exact-type lookup cannot match it — so it fell to the generic branch with
     * an empty list, and a browser reporting no type matched neither the type
     * nor a suffix.
     */
    const parsed = parseAcceptString("font/*");
    for (const format of WEB_FONT_FORMATS) {
      expect(parsed?.["font/*"]).toContain(format.extension);
    }
  });

  it("still leaves an unknown type without invented extensions", () => {
    // The control: a parser attaching a suffix to everything would satisfy the
    // case above while telling Dropzone to accept files nothing asked for.
    expect(parseAcceptString("application/zip")?.["application/zip"]).toEqual(
      []
    );
  });
});
