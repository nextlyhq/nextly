import { describe, expect, it } from "vitest";

import { MOST_IMPORTED_ROWS, readImportFile } from "../import";

describe("reading a file of redirects", () => {
  it("reads From, To and an optional type, past a first line naming the columns", () => {
    expect(
      readImportFile(
        "From,To,Type\r\n/old,/new\r\n\r\n/soon,/later,temporary\n/x,/y,302\n"
      )
    ).toEqual([
      { line: 2, from: "/old", to: "/new", type: "permanent" },
      { line: 4, from: "/soon", to: "/later", type: "temporary" },
      { line: 5, from: "/x", to: "/y", type: "temporary" },
    ]);
  });

  it("reads an address gone for good, its To cell left empty", () => {
    expect(
      readImportFile("/retired,,gone\n/old-post,,410\n/legacy,,410 Gone\n")
    ).toEqual([
      { line: 1, from: "/retired", to: "", type: "gone" },
      { line: 2, from: "/old-post", to: "", type: "gone" },
      { line: 3, from: "/legacy", to: "", type: "gone" },
    ]);
  });

  it("reads quoted cells, a comma or a doubled quote inside them included", () => {
    expect(readImportFile('"/a,b","https://example.com/?q=""x"""')).toEqual([
      {
        line: 1,
        from: "/a,b",
        to: 'https://example.com/?q="x"',
        type: "permanent",
      },
    ]);
  });

  it("keeps a first line that is a redirect, not column names", () => {
    expect(readImportFile("/from-here,/to-there")).toHaveLength(1);
  });

  it("refuses a file longer than one import takes", () => {
    const file = Array.from(
      { length: MOST_IMPORTED_ROWS + 1 },
      (_, n) => `/a${n},/b`
    ).join("\n");
    expect(() => readImportFile(file)).toThrow(
      expect.objectContaining({
        publicMessage: `A file can hold up to ${MOST_IMPORTED_ROWS} redirects. Split it, and import each part.`,
      })
    );
  });
});
