import { describe, expect, it } from "vitest";

import {
  acceptPatternsOf,
  fileMatchesAccept,
  mediaIdsOf,
  safeUploadName,
  uploadLimitOf,
} from "./upload-rules";

const SETTINGS = {
  maxFileSize: 10 * 1024 * 1024,
  allowedMimeTypes: ["image/*", "application/pdf"],
};

describe("acceptPatternsOf", () => {
  it("reads the field's accept, trimmed and in lower case", () => {
    expect(acceptPatternsOf({ accept: " .PDF, Image/* ,," }, SETTINGS)).toEqual(
      [".pdf", "image/*"]
    );
  });

  it("falls back to the plugin's types when the field names none", () => {
    expect(acceptPatternsOf({ accept: " " }, SETTINGS)).toEqual([
      "image/*",
      "application/pdf",
    ]);
    expect(acceptPatternsOf({}, SETTINGS)).toEqual([
      "image/*",
      "application/pdf",
    ]);
  });
});

describe("fileMatchesAccept", () => {
  it("matches an extension against the name, whatever its case", () => {
    expect(fileMatchesAccept({ name: "CV.PDF", type: "" }, [".pdf"])).toBe(
      true
    );
    expect(fileMatchesAccept({ name: "cv.pdf.exe", type: "" }, [".pdf"])).toBe(
      false
    );
  });

  it("matches a type, and a type family, against the media type", () => {
    expect(
      fileMatchesAccept({ name: "a", type: "Application/PDF; x=1" }, [
        "application/pdf",
      ])
    ).toBe(true);
    expect(
      fileMatchesAccept({ name: "a", type: "image/png" }, ["image/*"])
    ).toBe(true);
    // A family is its own prefix: `image/*` does not take `imagery/x` or a
    // bare `image/`.
    expect(
      fileMatchesAccept({ name: "a", type: "imagery/png" }, ["image/*"])
    ).toBe(false);
    expect(fileMatchesAccept({ name: "a", type: "image/" }, ["image/*"])).toBe(
      false
    );
    expect(
      fileMatchesAccept({ name: "a", type: "text/html" }, [
        "image/*",
        "application/pdf",
      ])
    ).toBe(false);
  });
});

describe("uploadLimitOf", () => {
  it("is the field's limit, never above the plugin's", () => {
    expect(uploadLimitOf({ maxFileSize: 1024 }, SETTINGS)).toBe(1024);
    expect(uploadLimitOf({ maxFileSize: 50 * 1024 * 1024 }, SETTINGS)).toBe(
      SETTINGS.maxFileSize
    );
  });

  it("is the plugin's when the field sets none, or nothing usable", () => {
    expect(uploadLimitOf({}, SETTINGS)).toBe(SETTINGS.maxFileSize);
    expect(uploadLimitOf({ maxFileSize: -1 }, SETTINGS)).toBe(
      SETTINGS.maxFileSize
    );
    expect(uploadLimitOf({ maxFileSize: "5" }, SETTINGS)).toBe(
      SETTINGS.maxFileSize
    );
  });
});

describe("safeUploadName", () => {
  it("keeps only the last path segment", () => {
    expect(safeUploadName("C:\\fakepath\\cv.pdf")).toBe("cv.pdf");
    expect(safeUploadName("../../etc/passwd")).toBe("passwd");
  });

  it("drops control characters and names an empty result", () => {
    expect(safeUploadName("c\u0000v\u001f.pdf")).toBe("cv.pdf");
    expect(safeUploadName("..")).toBe("upload");
    expect(safeUploadName("dir/")).toBe("upload");
  });

  it("shortens a long name, keeping its extension", () => {
    const named = safeUploadName(`${"a".repeat(300)}.pdf`);
    expect(named).toHaveLength(200);
    expect(named.endsWith(".pdf")).toBe(true);
  });
});

describe("mediaIdsOf", () => {
  it("reads one id or a list, skipping what is not an id", () => {
    expect(mediaIdsOf("m1")).toEqual(["m1"]);
    expect(mediaIdsOf(["m1", "", 3, null, "m2"])).toEqual(["m1", "m2"]);
    expect(mediaIdsOf("")).toEqual([]);
    expect(mediaIdsOf({ id: "m1" })).toEqual([]);
  });
});
